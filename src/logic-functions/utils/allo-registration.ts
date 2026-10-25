import { createHash, randomUUID } from 'node:crypto';

import { kv } from 'twenty-sdk/logic-function';

import {
  ALLO_WEBHOOK_ROUTE_PATH,
  ALLO_WEBHOOK_TOPICS,
} from 'src/constants/allo-api';
import {
  ALLO_REGISTRATION_KV_KEY,
  ALLO_REGISTRATION_QUERY_PARAMETER,
  ALLO_WEBHOOK_PROBE_KV_KEY,
  ALLO_WEBHOOK_PROBE_QUERY_PARAMETER,
  getAlloRegistrationClaimKey,
} from 'src/constants/allo-registration';
import {
  type AlloConnectionStatus,
  type AlloWorkspaceRegistration,
} from 'src/types/allo-registration.type';
import {
  createAlloWebhook,
  deleteAlloWebhook,
  getAlloWebhook,
} from 'src/logic-functions/utils/allo-webhooks-api';

/** Detects a key change without keeping the key anywhere but its variable. */
export const fingerprintApiKey = (apiKey: string): string =>
  createHash('sha256').update(apiKey).digest('hex').slice(0, 16);

/**
 * The receiver route on this workspace's public base URL (see
 * `pickWebhookBaseUrl`), tagged with the registration it belongs to.
 */
export const buildAlloWebhookUrl = ({
  baseUrl,
  registrationId,
}: {
  baseUrl: string;
  registrationId: string;
}): string => {
  const url = new URL(baseUrl);

  // Allo refuses anything that is not public HTTPS.
  if (url.protocol !== 'https:') {
    throw new Error(
      `Allo only delivers to HTTPS URLs, and this workspace is served at ${url.origin}.`,
    );
  }

  url.pathname = `${url.pathname.replace(/\/+$/, '')}${ALLO_WEBHOOK_ROUTE_PATH}`;
  url.search = '';
  url.hash = '';
  url.searchParams.set(ALLO_REGISTRATION_QUERY_PARAMETER, registrationId);

  return url.toString();
};

/**
 * The webhook's description in Allo > Settings > Webhooks. It names the
 * workspace so an Allo account that feeds several CRMs can tell them apart.
 */
export const describeAlloWebhook = (workspaceUrl?: string): string => {
  if (!workspaceUrl) {
    return 'Twenty CRM';
  }

  try {
    return `Twenty CRM (${new URL(workspaceUrl).host})`;
  } catch {
    return 'Twenty CRM';
  }
};

/**
 * Whether two webhook URLs deliver to the same registration. Compared parsed,
 * not as strings: if Allo echoes the URL back normalised, a string comparison
 * would re-create the webhook on every sync.
 */
export const isSameWebhookTarget = (left: string, right: string): boolean => {
  try {
    const a = new URL(left);
    const b = new URL(right);
    const path = (url: URL) => url.pathname.replace(/\/+$/, '');

    return (
      a.origin === b.origin &&
      path(a) === path(b) &&
      a.searchParams.get(ALLO_REGISTRATION_QUERY_PARAMETER) ===
        b.searchParams.get(ALLO_REGISTRATION_QUERY_PARAMETER)
    );
  } catch {
    return false;
  }
};

export const readAlloRegistration =
  (): Promise<AlloWorkspaceRegistration | null> =>
    kv.get<AlloWorkspaceRegistration>(ALLO_REGISTRATION_KV_KEY);

/**
 * Local only, no Allo request. With `checkAllo`, also asks Allo whether the
 * webhook still exists: one request, made when someone opens the settings tab.
 */
export const getAlloConnectionStatus = async (
  apiKey: string | undefined,
  { checkAllo = false }: { checkAllo?: boolean } = {},
): Promise<AlloConnectionStatus> => {
  if (!apiKey) {
    return { state: 'missing-api-key' };
  }

  const registration = await readAlloRegistration();

  if (!registration) {
    return { state: 'disconnected' };
  }

  if (registration.apiKeyFingerprint !== fingerprintApiKey(apiKey)) {
    return { state: 'api-key-changed' };
  }

  if (!registration.signingSecret) {
    return { state: 'secret-missing' };
  }

  if (checkAllo) {
    const endpoint = await getAlloWebhook({
      apiKey,
      webhookId: registration.webhookId,
    });

    if (!endpoint?.enabled) {
      return { state: 'webhook-missing', webhookUrl: registration.webhookUrl };
    }
  }

  return {
    state: 'connected',
    webhookUrl: registration.webhookUrl,
    connectedAt: registration.connectedAt,
  };
};

const forgetRegistration = async (registrationId: string): Promise<void> => {
  await kv.delete(ALLO_REGISTRATION_KV_KEY);
  // Registrations made by 0.2.0 pre-releases also claimed their id in the
  // server scope. Nothing reads that claim anymore; clean it up if it exists.
  await kv
    .delete(getAlloRegistrationClaimKey(registrationId), { scope: 'SERVER' })
    .catch(() => false);
};

/**
 * Posts a one-time nonce to the webhook URL and expects the receiver to echo
 * it, before the URL is handed to Allo. Only Twenty is called. A URL that does
 * not reach this workspace would otherwise become a webhook that fails every
 * delivery until Allo disables it.
 *
 * Only a definite wrong answer stops Connect. A server that cannot reach its
 * own public URL from inside (no hairpin NAT, internal DNS) may still be
 * reachable by Allo, so a network error is logged and Connect goes on.
 */
export const probeAlloWebhookUrl = async (webhookUrl: string): Promise<void> => {
  const nonce = randomUUID();
  const probeUrl = new URL(webhookUrl);

  probeUrl.search = '';
  probeUrl.searchParams.set(ALLO_WEBHOOK_PROBE_QUERY_PARAMETER, nonce);

  await kv.set(ALLO_WEBHOOK_PROBE_KV_KEY, nonce);

  let status: number | null = null;
  let echoed = false;

  try {
    const response = await fetch(probeUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'webhook-id': nonce },
      body: JSON.stringify({ probe: nonce }),
    });

    status = response.status;
    echoed =
      response.ok &&
      ((await response.json().catch(() => null)) as { probe?: string } | null)
        ?.probe === 'ok';
  } catch (error) {
    console.warn(
      `[allo] could not reach ${probeUrl.origin} from this server to check it; registering it anyway`,
      error,
    );
  } finally {
    await kv.delete(ALLO_WEBHOOK_PROBE_KV_KEY).catch(() => false);
  }

  if (status !== null && !echoed) {
    throw new Error(
      `${new URL(webhookUrl).origin} does not reach this workspace (HTTP ${status}), so Allo could not deliver calls to it. Nothing was created in Allo.`,
    );
  }
};

/**
 * Removes the webhook from Allo, then forgets it locally. Allo is cleaned up on a
 * best-effort basis: a webhook created with a key that has since been replaced
 * belongs to another key and may not be deletable, and that must not leave the
 * workspace stuck in a connected state.
 */
export const disconnectAllo = async ({
  apiKey,
}: {
  apiKey: string | undefined;
}): Promise<{ removedFromAllo: boolean }> => {
  const registration = await readAlloRegistration();

  if (!registration) {
    return { removedFromAllo: false };
  }

  let removedFromAllo = false;

  if (apiKey) {
    try {
      await deleteAlloWebhook({ apiKey, webhookId: registration.webhookId });
      removedFromAllo = true;
    } catch (error) {
      console.error(
        `[allo] could not delete webhook ${registration.webhookId} in Allo; remove it in Allo > Settings > Webhooks`,
        error,
      );
    }
  }

  await forgetRegistration(registration.registrationId);

  return { removedFromAllo };
};

export type ConnectAlloResult =
  | { outcome: 'already-connected'; webhookUrl: string }
  | { outcome: 'connected'; webhookUrl: string };

/**
 * Makes sure Allo delivers this workspace's call events to Twenty.
 *
 * Idempotent: a workspace that is already connected with the current key, and
 * whose webhook still exists and is enabled in Allo, is left untouched. Anything
 * else (no registration, a replaced key, a webhook deleted or disabled in Allo,
 * a server that moved) gets a fresh webhook, so "Connect" is also the repair.
 */
export const connectAllo = async ({
  apiKey,
  webhookBaseUrl,
  workspaceUrl,
}: {
  apiKey: string;
  /** Where Twenty serves this workspace's public routes. */
  webhookBaseUrl: string;
  /** The workspace's own URL, shown in the webhook description. */
  workspaceUrl?: string;
}): Promise<ConnectAlloResult> => {
  const apiKeyFingerprint = fingerprintApiKey(apiKey);
  const existing = await readAlloRegistration();

  if (existing && existing.apiKeyFingerprint === apiKeyFingerprint) {
    const endpoint = await getAlloWebhook({
      apiKey,
      webhookId: existing.webhookId,
    });
    // Built from the current base URL, so a workspace that moved gets a new
    // webhook pointing at its new address.
    const expectedUrl = buildAlloWebhookUrl({
      baseUrl: webhookBaseUrl,
      registrationId: existing.registrationId,
    });

    if (
      endpoint?.enabled &&
      isSameWebhookTarget(endpoint.url, expectedUrl) &&
      existing.signingSecret
    ) {
      return { outcome: 'already-connected', webhookUrl: existing.webhookUrl };
    }
  }

  const registrationId = randomUUID();
  const webhookUrl = buildAlloWebhookUrl({
    baseUrl: webhookBaseUrl,
    registrationId,
  });

  // Before touching Allo, so a URL that cannot work leaves the current
  // webhook in place.
  await probeAlloWebhookUrl(webhookUrl);

  if (existing) {
    await disconnectAllo({ apiKey });
  }

  const endpoint = await createAlloWebhook({
    apiKey,
    url: webhookUrl,
    topics: ALLO_WEBHOOK_TOPICS,
    description: describeAlloWebhook(workspaceUrl),
  });

  if (!endpoint.signingSecret) {
    await deleteAlloWebhook({ apiKey, webhookId: endpoint.id });

    throw new Error('Allo created the webhook but returned no signing secret.');
  }

  try {
    const registration: AlloWorkspaceRegistration = {
      registrationId,
      webhookId: endpoint.id,
      webhookUrl,
      signingSecret: endpoint.signingSecret,
      apiKeyFingerprint,
      connectedAt: new Date().toISOString(),
    };

    await kv.set(ALLO_REGISTRATION_KV_KEY, registration);
  } catch (error) {
    // Without the stored registration every delivery would be dropped, and
    // Allo would keep sending them. Undo rather than leave it dangling.
    await deleteAlloWebhook({ apiKey, webhookId: endpoint.id }).catch(
      (rollbackError: unknown) =>
        console.error(
          `[allo] could not roll back webhook ${endpoint.id}; remove it in Allo > Settings > Webhooks`,
          rollbackError,
        ),
    );
    await forgetRegistration(registrationId).catch(() => {});

    throw error;
  }

  return { outcome: 'connected', webhookUrl };
};
