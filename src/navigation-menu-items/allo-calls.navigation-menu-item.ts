import {
  defineNavigationMenuItem,
  NavigationMenuItemType,
} from 'twenty-sdk/define';

import {
  ALLO_CALLS_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIER,
  ALLO_CALLS_VIEW_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineNavigationMenuItem({
  universalIdentifier: ALLO_CALLS_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIER,
  name: 'Allo Calls',
  icon: 'IconPhone',
  color: 'blue',
  position: 0,
  type: NavigationMenuItemType.VIEW,
  viewUniversalIdentifier: ALLO_CALLS_VIEW_UNIVERSAL_IDENTIFIER,
});
