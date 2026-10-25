// Workspace-scoped: what this workspace registered in Allo.
export const ALLO_REGISTRATION_KV_KEY = 'allo-webhook-registration';

// Workspace-scoped, short-lived: the nonce Connect sends to its own webhook URL
// to check that the URL reaches this workspace before handing it to Allo.
export const ALLO_WEBHOOK_PROBE_KV_KEY = 'allo-webhook-probe';
export const ALLO_WEBHOOK_PROBE_QUERY_PARAMETER = 'probe';

// The webhook URL carries `?registrationId=...` so a delivery from a webhook
// this workspace no longer holds is refused instead of written.
export const ALLO_REGISTRATION_QUERY_PARAMETER = 'registrationId';

// Server-scoped claim written by 0.2.0 pre-releases, which routed deliveries
// through a server route. Only deleted now, when its registration is replaced.
export const getAlloRegistrationClaimKey = (registrationId: string): string =>
  `allo-registration:${registrationId}`;
