import {
  type ApplicationHealthCheckResult,
  defineHealthCheck,
} from 'twenty-sdk/define';

import { ALLO_API_KEY_ENV_VAR_NAME } from 'src/constants/allo-api';
import { HEALTH_CHECK_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { getAlloConnectionStatus } from 'src/logic-functions/utils/allo-registration';

// No `location` on the actions: Twenty then opens the app's configuration tab,
// which is the Allo settings tab.
/** Local only: no Allo request, so it stays cheap however often it runs. */
export const healthCheckHandler =
  async (): Promise<ApplicationHealthCheckResult> => {
    const status = await getAlloConnectionStatus(
      process.env[ALLO_API_KEY_ENV_VAR_NAME]?.trim(),
    );

    switch (status.state) {
      case 'connected':
      case 'webhook-missing':
        return { status: 'OK' };
      case 'missing-api-key':
        return {
          status: 'WARNING',
          title: 'Allo is not connected',
          description:
            'Calls are not syncing. Add an Allo API key with the WEBHOOKS_READ_WRITE scope and connect.',
          action: { label: 'Connect Allo' },
        };
      case 'disconnected':
        return {
          status: 'WARNING',
          title: 'Allo is not connected',
          description:
            'Calls are not syncing. Connect Allo to register the webhook that sends call events to Twenty.',
          action: { label: 'Connect Allo' },
        };
      case 'api-key-changed':
        return {
          status: 'ERROR',
          title: 'Allo API key changed',
          description:
            'The webhook was registered with a different API key. Connect again to use the current one.',
          action: { label: 'Reconnect' },
        };
      case 'secret-missing':
        return {
          status: 'ERROR',
          title: 'Allo deliveries cannot be verified',
          description:
            'The webhook signing secret is missing, so every call event is rejected. Connect again to re-create the webhook.',
          action: { label: 'Reconnect' },
        };
    }
  };

export default defineHealthCheck({
  universalIdentifier: HEALTH_CHECK_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'health-check',
  description:
    'Warns on the app settings page when Allo is not connected, since calls cannot sync without its webhook.',
  timeoutSeconds: 15,
  handler: healthCheckHandler,
});
