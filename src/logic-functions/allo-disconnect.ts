import { defineLogicFunction } from 'twenty-sdk/define';

import {
  ALLO_API_KEY_ENV_VAR_NAME,
  ALLO_DISCONNECT_ROUTE_PATH,
} from 'src/constants/allo-api';
import { ALLO_DISCONNECT_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { disconnectAllo } from 'src/logic-functions/utils/allo-registration';
import { currentUserCanManageApps } from 'src/logic-functions/utils/current-user-can-manage-apps';

export type AlloDisconnectResponse =
  | { success: true; removedFromAllo: boolean }
  | { success: false; error: string };

/** Stops call sync: deletes the Allo webhook and forgets the registration. */
export const alloDisconnectHandler =
  async (): Promise<AlloDisconnectResponse> => {
    if (!(await currentUserCanManageApps())) {
      return {
        success: false,
        error:
          'Disconnecting Allo requires the permission to manage applications.',
      };
    }

    const result = await disconnectAllo({
      apiKey: process.env[ALLO_API_KEY_ENV_VAR_NAME]?.trim(),
    });

    return { success: true, ...result };
  };

export default defineLogicFunction({
  universalIdentifier: ALLO_DISCONNECT_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'allo-disconnect',
  description:
    'Deletes the Allo webhook of this workspace so calls stop syncing.',
  timeoutSeconds: 30,
  handler: alloDisconnectHandler,
  httpRouteTriggerSettings: {
    path: ALLO_DISCONNECT_ROUTE_PATH,
    httpMethod: 'POST',
    isAuthRequired: true,
  },
});
