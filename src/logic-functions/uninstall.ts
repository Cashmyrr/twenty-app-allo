import { defineUninstallLogicFunction } from 'twenty-sdk/define';

import { ALLO_API_KEY_ENV_VAR_NAME } from 'src/constants/allo-api';
import { UNINSTALL_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { disconnectAllo } from 'src/logic-functions/utils/allo-registration';

/** Leaves no webhook behind in Allo pointing at an app that is gone. */
export const uninstallHandler = async () =>
  disconnectAllo({ apiKey: process.env[ALLO_API_KEY_ENV_VAR_NAME]?.trim() });

export default defineUninstallLogicFunction({
  universalIdentifier: UNINSTALL_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'uninstall',
  description: 'Deletes the Allo webhook when the app is uninstalled.',
  timeoutSeconds: 30,
  handler: uninstallHandler,
});
