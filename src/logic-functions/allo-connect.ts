import { defineLogicFunction } from 'twenty-sdk/define';

import {
  ALLO_API_KEY_ENV_VAR_NAME,
  ALLO_CONNECT_ROUTE_PATH,
} from 'src/constants/allo-api';
import { ALLO_CONNECT_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { connectAllo } from 'src/logic-functions/utils/allo-registration';
import { currentUserCanManageApps } from 'src/logic-functions/utils/current-user-can-manage-apps';
import { describeAlloError } from 'src/logic-functions/utils/describe-allo-error';
import { readWorkspaceUrl } from 'src/logic-functions/utils/read-workspace-url';
import { resolveWebhookBaseUrl } from 'src/logic-functions/utils/resolve-webhook-base-url';

export type AlloConnectResponse =
  | {
      success: true;
      outcome: 'connected' | 'already-connected';
      webhookUrl: string;
    }
  | { success: false; error: string };

/**
 * Registers the Allo webhook that feeds this workspace, or repairs it. Called by
 * the settings tab right after it saves the API key, so the key is read from
 * the variable rather than taken from the request.
 */
export const alloConnectHandler = async (): Promise<AlloConnectResponse> => {
  if (!(await currentUserCanManageApps())) {
    return {
      success: false,
      error: 'Connecting Allo requires the permission to manage applications.',
    };
  }

  const apiKey = process.env[ALLO_API_KEY_ENV_VAR_NAME]?.trim();
  const apiUrl = process.env.TWENTY_API_URL;

  if (!apiKey) {
    return { success: false, error: 'Save an Allo API key first.' };
  }

  if (!apiUrl) {
    return { success: false, error: 'This Twenty server has no public URL.' };
  }

  try {
    const result = await connectAllo({
      apiKey,
      webhookBaseUrl: await resolveWebhookBaseUrl(apiUrl),
      workspaceUrl: await readWorkspaceUrl(),
    });

    return { success: true, ...result };
  } catch (error) {
    console.error('[allo] connect failed', error);

    return { success: false, error: describeAlloError(error) };
  }
};

export default defineLogicFunction({
  universalIdentifier: ALLO_CONNECT_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'allo-connect',
  description:
    'Registers the Allo webhook that sends this workspace its call events, or repairs it.',
  timeoutSeconds: 30,
  handler: alloConnectHandler,
  httpRouteTriggerSettings: {
    path: ALLO_CONNECT_ROUTE_PATH,
    httpMethod: 'POST',
    isAuthRequired: true,
  },
});
