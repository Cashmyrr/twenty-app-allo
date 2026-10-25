/** Stored in the workspace key-value store once the webhook exists in Allo. */
export type AlloWorkspaceRegistration = {
  registrationId: string;
  webhookId: string;
  webhookUrl: string;
  /** Lets a key change be detected without storing the key itself. */
  apiKeyFingerprint: string;
  connectedAt: string;
};

/** Stored in the server key-value store, read by the webhook resolver. */
export type AlloRegistrationClaim = {
  workspaceId: string;
  signingSecret: string;
};

export type AlloConnectionStatus =
  | { state: 'missing-api-key' }
  | { state: 'disconnected' }
  /** Registered with a key that has since been replaced. */
  | { state: 'api-key-changed' }
  /** Registered, but Allo no longer has the webhook, or disabled it. */
  | { state: 'webhook-missing'; webhookUrl: string }
  | { state: 'connected'; webhookUrl: string; connectedAt: string };
