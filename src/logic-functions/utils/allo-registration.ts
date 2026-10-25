import { createHash, randomUUID } from 'node:crypto';

import { kv } from 'twenty-sdk/logic-function';

import { ALLO_WEBHOOK_TOPICS } from 'src/constants/allo-api';
import {
  ALLO_REGISTRATION_KV_KEY,
  ALLO_REGISTRATION_QUERY_PARAMETER,
  getAlloRegistrationClaimKey,
} from 'src/constants/allo-registration';
import { ALLO_WEBHOOK_RESOLVER_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import {
  type AlloConnectionStatus,
  type AlloRegistrationClaim,
  type AlloWorkspaceRegistration,
} from 'src/types/allo-registration.type';
import {
  createAlloWebhook,
  deleteAlloWebhook,
  getAlloWebhook,
} from 'src/logic-functions/utils/allo-webhooks-api';

const SERVER_SCOPE = { scope: 'SERVER' } as const;

/** Detects a key change without keeping the key anywhere but its variable. */
export const fingerprintApiKey = (apiKey: string): string =>
  createHash('sha256').update(apiKey).digest('hex').slice(0, 16);

/**
 * Every official Twenty app builds its server-route URL from the resolver's
 * universalIdentifier. The server also accepts the resolver's metadata id, but
 * that id only exists in the owner workspace, so no installed copy can know it.
 */
export const buildAlloWebhookUrl = ({
  apiUrl,
  registrationId,
}: {
  apiUrl: string;
  registrationId: string;
}): string => {
  const url = new URL(apiUrl);

  // Allo refuses anything that is not public HTTPS.
  if (url.protocol !== 'https:') {
    throw new Error(
      `Allo only delivers to HTTPS URLs, and this Twenty server is ${url.origin}.`,
    );
  }

  url.pathname = `${url.pathname.replace(/\/+$/, '')}/webhooks/server/${ALLO_WEBHOOK_RESOLVER_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER}`;
  url.search = '';
  url.hash = '';
  url.searchParams.set(ALLO_REGISTRATION_QUERY_PARAMETER, registrationId);

  return url.toString();
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

export const readAlloRegistrationClaim = (
  registrationId: string,
): Promise<AlloRegistrationClaim | null> =>
  kv.get<AlloRegistrationClaim>(
    getAlloRegistrationClaimKey(registrationId),
    SERVER_SCOPE,
  );

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
  await kv.delete(getAlloRegistrationClaimKey(registrationId), SERVER_SCOPE);
  await kv.delete(ALLO_REGISTRATION_KV_KEY);
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
  apiUrl,
  workspaceId,
}: {
  apiKey: string;
  apiUrl: string;
  workspaceId: string;
}): Promise<ConnectAlloResult> => {
  const apiKeyFingerprint = fingerprintApiKey(apiKey);
  const existing = await readAlloRegistration();

  if (existing && existing.apiKeyFingerprint === apiKeyFingerprint) {
    const endpoint = await getAlloWebhook({
      apiKey,
      webhookId: existing.webhookId,
    });
    const claim = await readAlloRegistrationClaim(existing.registrationId);
    // Built from the current server URL, so a server that moved gets a new
    // webhook pointing at its new address.
    const expectedUrl = buildAlloWebhookUrl({
      apiUrl,
      registrationId: existing.registrationId,
    });

    if (
      endpoint?.enabled &&
      isSameWebhookTarget(endpoint.url, expectedUrl) &&
      claim
    ) {
      return { outcome: 'already-connected', webhookUrl: existing.webhookUrl };
    }
  }

  if (existing) {
    await disconnectAllo({ apiKey });
  }

  const registrationId = randomUUID();
  const webhookUrl = buildAlloWebhookUrl({ apiUrl, registrationId });

  const endpoint = await createAlloWebhook({
    apiKey,
    url: webhookUrl,
    topics: ALLO_WEBHOOK_TOPICS,
    description: 'Twenty CRM',
  });

  if (!endpoint.signingSecret) {
    await deleteAlloWebhook({ apiKey, webhookId: endpoint.id });

    throw new Error('Allo created the webhook but returned no signing secret.');
  }

  try {
    const claim: AlloRegistrationClaim = {
      workspaceId,
      signingSecret: endpoint.signingSecret,
    };
    const registration: AlloWorkspaceRegistration = {
      registrationId,
      webhookId: endpoint.id,
      webhookUrl,
      apiKeyFingerprint,
      connectedAt: new Date().toISOString(),
    };

    await kv.set(getAlloRegistrationClaimKey(registrationId), claim, SERVER_SCOPE);
    await kv.set(ALLO_REGISTRATION_KV_KEY, registration);
  } catch (error) {
    // Without the stored secret every delivery would be rejected, and Allo
    // would eventually disable the endpoint. Undo rather than leave it dangling.
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
