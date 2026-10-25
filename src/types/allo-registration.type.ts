/** Stored in the workspace key-value store once the webhook exists in Allo. */
export type AlloWorkspaceRegistration = {
  registrationId: string;
  webhookId: string;
  webhookUrl: string;
  /**
   * Allo returns it on create only. `allo-webhook-receiver` checks every
   * delivery against it before queuing. Missing from registrations made by
   * 0.2.0 pre-releases, which must connect again.
   */
  signingSecret?: string;
  /** Lets a key change be detected without storing the key itself. */
  apiKeyFingerprint: string;
  connectedAt: string;
};

export type AlloConnectionStatus =
  | { state: 'missing-api-key' }
  | { state: 'disconnected' }
  /** Registered with a key that has since been replaced. */
  | { state: 'api-key-changed' }
  /** Registered without the signing secret, so no delivery can be verified. */
  | { state: 'secret-missing' }
  /** Registered, but Allo no longer has the webhook, or disabled it. */
  | { state: 'webhook-missing'; webhookUrl: string }
  | { state: 'connected'; webhookUrl: string; connectedAt: string };
