import { CoreApiClient } from 'twenty-client-sdk/core';
import { defineLogicFunction } from 'twenty-sdk/define';
import {
  enqueueJobs,
  RetryableLogicFunctionError,
} from 'twenty-sdk/logic-function';

import { ALLO_DELIVERY_RETRY_DELAYS_MS } from 'src/constants/allo-api';
import { ALLO_WEBHOOK_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { type AlloVerifiedDeliveryPayload } from 'src/types/allo-webhook.type';
import { readAlloRegistration } from 'src/logic-functions/utils/allo-registration';
import {
  processAlloEvent,
  type ProcessAlloEventResult,
} from 'src/logic-functions/utils/process-allo-event';

/**
 * Runs this delivery again later. Resolves to the delay, or null once every
 * attempt is spent. Twenty's queue retries a failed run within seconds, which is
 * too soon for a Twenty outage or for a call.completed sent ~30s after hangup.
 */
const deferDelivery = async (
  payload: AlloVerifiedDeliveryPayload,
): Promise<number | null> => {
  const attempt = payload.deferredAttempt ?? 0;
  const delayMs = ALLO_DELIVERY_RETRY_DELAYS_MS[attempt];

  if (delayMs === undefined) {
    return null;
  }

  await enqueueJobs({
    logicFunctionUniversalIdentifier:
      ALLO_WEBHOOK_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
    payloads: [{ ...payload, deferredAttempt: attempt + 1 }],
    delayMs,
  });

  return delayMs;
};

/**
 * Writes one Allo delivery into this workspace. Queued only by
 * `allo-webhook-receiver`, once it has checked the signature, or by itself to
 * retry later. It has no trigger of its own, so no request reaches it directly.
 */
export const alloWebhookHandler = async (
  delivery: AlloVerifiedDeliveryPayload,
): Promise<
  | ProcessAlloEventResult
  | { kind: 'stale-registration' }
  | { kind: 'deferred'; alloCallId: string; delayMs: number }
  | { kind: 'retry-scheduled'; topic: string | null; delayMs: number }
> => {
  // A delivery queued just before a disconnect or a reconnect must not write
  // into a workspace that no longer holds its registration.
  const registration = await readAlloRegistration();

  if (!registration || registration.registrationId !== delivery?.registrationId) {
    console.warn(
      '[allo] delivery for a registration this workspace no longer holds, ignored',
    );

    return { kind: 'stale-registration' };
  }

  // Deliveries come from Allo, not from a person, so the app's own role is
  // what grants access to the workspace.
  const client = new CoreApiClient({ runAs: 'application' });

  let result: ProcessAlloEventResult;

  try {
    result = await processAlloEvent(client, delivery.event);
  } catch (error) {
    // The upsert is idempotent, so a retry converges on the same record.
    const message = `Failed to persist Allo ${delivery.event?.topic ?? 'event'}: ${error instanceof Error ? error.message : String(error)}`;

    console.error(`[allo] ${message}`, error);

    let delayMs: number | null;

    try {
      delayMs = await deferDelivery(delivery);
    } catch {
      // Twenty cannot even queue a job: let its own retries have a go.
      throw new RetryableLogicFunctionError(message);
    }

    if (delayMs === null) {
      throw new Error(`${message}. Giving up after every retry.`);
    }

    return { kind: 'retry-scheduled', topic: delivery.event?.topic ?? null, delayMs };
  }

  if (result.kind === 'tag' && result.outcome === 'call-not-found') {
    // Allo does not order deliveries: a tag can land before the call.completed
    // that creates the record. Try again later before concluding the call
    // predates the app.
    const delayMs = await deferDelivery(delivery);

    if (delayMs !== null) {
      return { kind: 'deferred', alloCallId: result.alloCallId, delayMs };
    }

    console.warn(
      `[allo] ${result.topic} for unknown call ${result.alloCallId}, ignored`,
    );
  }

  if (result.kind === 'call' && result.operation === 'skipped') {
    console.warn(
      `[allo] ${result.topic} skipped: payload has no usable correlation key`,
    );
  }

  if (result.kind === 'invalid') {
    console.warn(`[allo] invalid delivery: ${result.reason}`);
  }

  return result;
};

export default defineLogicFunction({
  universalIdentifier: ALLO_WEBHOOK_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'allo-webhook',
  description:
    'Upserts one Allo Call record per call from call.* events and keeps its tags in sync from tag.* events.',
  timeoutSeconds: 60,
  handler: alloWebhookHandler,
});
