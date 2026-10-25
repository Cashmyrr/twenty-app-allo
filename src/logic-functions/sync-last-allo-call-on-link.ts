import { CoreApiClient } from 'twenty-client-sdk/core';
import { defineLogicFunction } from 'twenty-sdk/define';

import { SYNC_LAST_ALLO_CALL_ON_LINK_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { syncLastAlloCall } from 'src/logic-functions/utils/sync-last-allo-call';

type AlloCallRecord = {
  personId?: string | null;
  startedAt?: string | null;
};

/**
 * Same write, for the case the create trigger cannot cover: a call whose person
 * was not resolved when the record was created, and gets linked by a later
 * event. Without this the person would keep an empty date and stay in the
 * "never called" list forever.
 *
 * Narrowed to `personId` so it does not fire on every call event. Note that
 * `updatedFields` produces one invocation per matched field, so keeping a single
 * field here also keeps it to one invocation. The write itself is idempotent,
 * so a duplicate invocation would be harmless anyway.
 */
export default defineLogicFunction({
  universalIdentifier:
    SYNC_LAST_ALLO_CALL_ON_LINK_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'sync-last-allo-call-on-link',
  description:
    'Writes the call date onto person.lastAlloCallAt when a call is linked to a person after creation.',
  timeoutSeconds: 30,
  handler: async (event: { properties?: { after?: AlloCallRecord } }) => {
    const after = event?.properties?.after;

    return await syncLastAlloCall(new CoreApiClient({ runAs: 'application' }), {
      personId: after?.personId,
      startedAt: after?.startedAt,
    });
  },
  databaseEventTriggerSettings: {
    eventName: 'alloCall.updated',
    updatedFields: ['personId'],
  },
});
