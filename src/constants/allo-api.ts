export const ALLO_API_BASE_URL = 'https://api.withallo.com';

// Logic functions read application variables from `process.env`.
export const ALLO_API_KEY_ENV_VAR_NAME = 'ALLO_API_KEY';

// Topics the app subscribes its webhook to. Tags get their own events because a
// rep usually tags a call after hanging up, once call.completed has fired.
export const ALLO_WEBHOOK_TOPICS = [
  'call.received',
  'call.triggered',
  'call.answered',
  'call.completed',
  'tag.added',
  'tag.removed',
] as const;

// HTTP routes. The front components reach them under /s/<path>; Allo reaches
// the webhook route on the workspace's public function domain.
export const ALLO_WEBHOOK_ROUTE_PATH = '/allo/webhook';
export const ALLO_CONNECT_ROUTE_PATH = '/allo/connect';
export const ALLO_DISCONNECT_ROUTE_PATH = '/allo/disconnect';
export const ALLO_CONNECTION_STATUS_ROUTE_PATH = '/allo/connection-status';
export const PUSH_TO_DIALER_ROUTE_PATH = '/dialer';

// Once a delivery is dispatched Allo has its 200 and never retries it, and
// Twenty's queue spends its own retries within seconds. So a delivery that
// cannot be written yet (Twenty write failed, or a tag arrived before the
// call.completed that records its call) is re-queued with these delays.
export const ALLO_DELIVERY_RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  6 * 60 * 60_000,
] as const;
