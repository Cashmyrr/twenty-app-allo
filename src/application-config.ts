import { defineApplication, FieldType } from 'twenty-sdk/define';

import { ALLO_API_KEY_ENV_VAR_NAME } from 'src/constants/allo-api';
import {
  ALLO_API_KEY_VARIABLE_UNIVERSAL_IDENTIFIER,
  APP_DESCRIPTION,
  APP_DISPLAY_NAME,
  APPLICATION_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

// The default role is declared with defineApplicationRole() in
// src/roles/default-role.ts and picked up automatically.
export default defineApplication({
  universalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
  displayName: APP_DISPLAY_NAME,
  description: APP_DESCRIPTION,
  logo: 'public/logo.svg',
  author: 'Cashmyrr',
  category: 'Communication',
  websiteUrl: 'https://github.com/Cashmyrr/twenty-app-allo',
  issueReportUrl: 'https://github.com/Cashmyrr/twenty-app-allo/issues',
  applicationVariables: {
    // The only credential the app needs. The webhook signing secret is not a
    // variable: the app creates the webhook through this key and stores the
    // secret Allo returns, so nobody has to copy it by hand.
    [ALLO_API_KEY_ENV_VAR_NAME]: {
      universalIdentifier: ALLO_API_KEY_VARIABLE_UNIVERSAL_IDENTIFIER,
      label: 'Allo API key',
      description:
        'Allo API key (Allo > Settings > API). Needs the WEBHOOKS_READ_WRITE scope to sync calls, and DIALING_QUEUE_READ_WRITE for "Send to Power Dialer".',
      type: FieldType.TEXT,
      isSecret: true,
      isRequired: true,
    },
  },
});
