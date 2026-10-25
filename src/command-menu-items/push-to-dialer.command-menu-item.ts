import {
  defineCommandMenuItem,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

import {
  PUSH_TO_DIALER_COMMAND_MENU_ITEM_UNIVERSAL_IDENTIFIER,
  PUSH_TO_DIALER_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

/**
 * Select people in any view, run this, and exactly that selection lands in the
 * caller's Power Dialer queue. The Allo browser extension reads the DOM instead,
 * so it picks up every number on screen, not the filtered selection.
 */
export default defineCommandMenuItem({
  universalIdentifier: PUSH_TO_DIALER_COMMAND_MENU_ITEM_UNIVERSAL_IDENTIFIER,
  label: 'Send to Power Dialer',
  shortLabel: 'Power Dialer',
  availabilityType: 'RECORD_SELECTION',
  availabilityObjectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  frontComponentUniversalIdentifier:
    PUSH_TO_DIALER_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  isPinned: false,
});
