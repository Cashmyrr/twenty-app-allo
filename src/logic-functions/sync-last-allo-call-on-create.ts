import { CoreApiClient } from 'twenty-client-sdk/core';
import { defineLogicFunction } from 'twenty-sdk/define';

import { SYNC_LAST_ALLO_CALL_ON_CREATE_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { syncLastAlloCall } from 'src/logic-functions/utils/sync-last-allo-call';

type AlloCallRecord = {
  personId?: string | null;
  startedAt?: string | null;
};

/**
 * Propagates a new call's date onto the person it belongs to.
 *
 * Twenty has no rollup and no computed field, so the only way to make "when was
 * this person last called" filterable is to write it. This is that write.
 */
export default defineLogicFunction({
  universalIdentifier:
    SYNC_LAST_ALLO_CALL_ON_CREATE_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'sync-last-allo-call-on-create',
  description: "Writes a new call's date onto person.lastAlloCallAt.",
  timeoutSeconds: 30,
  handler: async (event: { properties?: { after?: AlloCallRecord } }) => {
    const after = event?.properties?.after;

    const result = await syncLastAlloCall(
      new CoreApiClient({ runAs: 'application' }),
      { personId: after?.personId, startedAt: after?.startedAt },
    );

    if (result.outcome === 'person-not-found') {
      console.warn(`[allo] person ${result.personId} not found`);
    }

    return result;
  },
  databaseEventTriggerSettings: {
    eventName: 'alloCall.created',
  },
});
