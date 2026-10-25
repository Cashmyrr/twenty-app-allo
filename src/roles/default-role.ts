import { defineApplicationRole, SystemPermissionFlag } from 'twenty-sdk/define';

import {
  APP_DISPLAY_NAME,
  DEFAULT_ROLE_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

// The role the app's functions and front components run as. It creates and
// updates Allo call records and person.lastAlloCallAt, and reads people,
// companies and workspace members to resolve links. It never deletes anything.
//
// APPLICATIONS lets the settings tab save the Allo API key: front components act
// as the viewer narrowed to this role, so the viewer needs the permission too.
export default defineApplicationRole({
  universalIdentifier: DEFAULT_ROLE_UNIVERSAL_IDENTIFIER,
  label: `${APP_DISPLAY_NAME} default role`,
  description: `${APP_DISPLAY_NAME} default role`,
  canReadAllObjectRecords: true,
  canUpdateAllObjectRecords: true,
  canSoftDeleteAllObjectRecords: false,
  canDestroyAllObjectRecords: false,
  permissionFlagUniversalIdentifiers: [SystemPermissionFlag.APPLICATIONS],
});
