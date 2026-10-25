import { defineFrontComponent } from 'twenty-sdk/define';

import { PUSH_TO_DIALER_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import PushToDialer from 'src/front-components/push-to-dialer';

/**
 * Headless: it renders no surface of its own, it opens a confirmation modal and
 * runs. The command menu item is what puts it in front of the user.
 *
 * The `.tsx` extension is load-bearing. The SDK build plugin only wraps the
 * declaration in a mount function for `.tsx` files; declared in a `.ts` file the
 * bundle default-exports the config object instead, the host calls it as a
 * function and the component dies at load time with
 * "(intermediate value).default is not a function". Nothing catches this: the
 * manifest, typecheck, lint, the tests and `plan` are all happy.
 */
export default defineFrontComponent({
  universalIdentifier: PUSH_TO_DIALER_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  name: 'push-to-dialer',
  description:
    "Confirms and pushes the selected people into the caller's Allo Power Dialer queue.",
  component: PushToDialer,
  isHeadless: true,
});
