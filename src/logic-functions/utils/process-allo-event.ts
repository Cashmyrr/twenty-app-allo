import { type CoreApiClient } from 'twenty-client-sdk/core';

import { ALLO_COMPANY_PHONE_FIELD_ENV_VAR_NAME } from 'src/constants/allo-api';

import {
  type AlloCallCompletedData,
  type AlloCallLifecycleData,
  type AlloTagData,
  type AlloWebhookEvent,
  isAlloCallTopic,
  isAlloTagTopic,
} from 'src/types/allo-webhook.type';
import { applyAlloTag } from 'src/logic-functions/utils/apply-allo-tag';
import { mapAlloCall } from 'src/logic-functions/utils/map-allo-call';
import {
  readCompanyPhoneField,
  resolveLinks,
} from 'src/logic-functions/utils/resolve-links';
import { upsertAlloCall } from 'src/logic-functions/utils/upsert-allo-call';

export type ProcessAlloEventResult =
  | { kind: 'ignored'; topic: string | null }
  | { kind: 'invalid'; reason: string }
  | {
      kind: 'call';
      topic: string;
      operation: 'created' | 'updated' | 'skipped';
      recordId: string | null;
      linked: { member: boolean; person: boolean; company: boolean };
    }
  | {
      kind: 'tag';
      topic: string;
      outcome: 'updated' | 'unchanged' | 'call-not-found';
      recordId: string | null;
      alloCallId: string;
      tag: string;
    };

/**
 * tag.added / tag.removed. The payload carries only the call id, so the tag is
 * written onto the existing Allo Call record. `tag_key` is stored rather than
 * `tag_name`, to stay consistent with the `tags` array call.completed already
 * fills with keys.
 */
const processTagEvent = async (
  client: CoreApiClient,
  topic: 'tag.added' | 'tag.removed',
  data: AlloTagData,
): Promise<ProcessAlloEventResult> => {
  const alloCallId =
    typeof data.call_id === 'string' && data.call_id.length > 0
      ? data.call_id
      : null;
  const tag =
    typeof data.tag_key === 'string' && data.tag_key.trim().length > 0
      ? data.tag_key.trim()
      : null;

  if (!alloCallId || !tag) {
    return { kind: 'invalid', reason: 'Tag event missing call_id or tag_key' };
  }

  const result = await applyAlloTag(client, {
    alloCallId,
    tag,
    operation: topic === 'tag.added' ? 'add' : 'remove',
  });

  return {
    kind: 'tag',
    topic,
    outcome: result.outcome,
    recordId: result.recordId,
    alloCallId,
    tag,
  };
};

/**
 * Writes one verified Allo event into the workspace. Throws when Twenty refuses
 * the write; the caller decides whether that is worth a retry.
 */
export const processAlloEvent = async (
  client: CoreApiClient,
  event: AlloWebhookEvent,
): Promise<ProcessAlloEventResult> => {
  const { topic, data } = event;

  if (!isAlloTagTopic(topic) && !isAlloCallTopic(topic)) {
    return { kind: 'ignored', topic: topic ?? null };
  }

  if (!data || typeof data !== 'object') {
    return { kind: 'invalid', reason: 'Event has no data payload' };
  }

  if (isAlloTagTopic(topic)) {
    return processTagEvent(client, topic, data as AlloTagData);
  }

  const mapped = mapAlloCall(
    topic,
    data as AlloCallLifecycleData | AlloCallCompletedData,
  );

  const links = await resolveLinks(client, {
    userEmail: mapped.userEmail,
    alloPerson: mapped.alloPerson,
    contactNumber: mapped.contactNumber,
    companyPhoneField: readCompanyPhoneField(
      process.env[ALLO_COMPANY_PHONE_FIELD_ENV_VAR_NAME],
    ),
  });

  const result = await upsertAlloCall(client, {
    alloCallId: mapped.alloCallId,
    correlationKey: mapped.correlationKey,
    nearbyMatch: mapped.nearbyMatch,
    keepExistingFields: mapped.keepExistingFields,
    fields: {
      ...mapped.fields,
      ...(links.memberId ? { memberId: links.memberId } : {}),
      ...(links.personId ? { personId: links.personId } : {}),
      ...(links.companyId ? { companyId: links.companyId } : {}),
    },
    // Without a correlation key a new record could never be matched to the
    // rest of the call, so only call.completed (which carries Allo's own id)
    // may create one blind.
    shouldCreateIfMissing:
      topic === 'call.completed' || mapped.correlationKey !== null,
  });

  return {
    kind: 'call',
    topic,
    operation: result.operation,
    recordId: result.recordId,
    linked: {
      member: links.memberId !== null,
      person: links.personId !== null,
      company: links.companyId !== null,
    },
  };
};
