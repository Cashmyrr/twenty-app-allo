import { defineLogicFunction } from 'twenty-sdk/define';

import {
  ALLO_API_KEY_ENV_VAR_NAME,
  ALLO_CONNECTION_STATUS_ROUTE_PATH,
} from 'src/constants/allo-api';
import { ALLO_CONNECTION_STATUS_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { type AlloConnectionStatus } from 'src/types/allo-registration.type';
import { getAlloConnectionStatus } from 'src/logic-functions/utils/allo-registration';
import { describeAlloError } from 'src/logic-functions/utils/describe-allo-error';

export type AlloConnectionStatusResponse =
  | AlloConnectionStatus
  | { state: 'unknown'; error: string };

/**
 * What the settings tab shows. Asks Allo whether the webhook still exists, so a
 * webhook deleted or disabled in Allo shows up when someone looks, without any
 * background polling.
 */
export const alloConnectionStatusHandler =
  async (): Promise<AlloConnectionStatusResponse> => {
    try {
      return await getAlloConnectionStatus(
        process.env[ALLO_API_KEY_ENV_VAR_NAME]?.trim(),
        { checkAllo: true },
      );
    } catch (error) {
      return { state: 'unknown', error: describeAlloError(error) };
    }
  };

export default defineLogicFunction({
  universalIdentifier:
    ALLO_CONNECTION_STATUS_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'allo-connection-status',
  description: 'Reports whether this workspace receives Allo call events.',
  timeoutSeconds: 15,
  handler: alloConnectionStatusHandler,
  httpRouteTriggerSettings: {
    path: ALLO_CONNECTION_STATUS_ROUTE_PATH,
    httpMethod: 'GET',
    isAuthRequired: true,
  },
});
