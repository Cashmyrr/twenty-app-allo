// Workspace-scoped: what this workspace registered in Allo.
export const ALLO_REGISTRATION_KV_KEY = 'allo-webhook-registration';

// The webhook URL carries `?registrationId=...` so the public server route can
// find the workspace a delivery belongs to.
export const ALLO_REGISTRATION_QUERY_PARAMETER = 'registrationId';

// Server-scoped, so the resolver (which runs outside the target workspace) can
// read it. Holds the workspace id and the signing secret for one registration.
export const getAlloRegistrationClaimKey = (registrationId: string): string =>
  `allo-registration:${registrationId}`;
