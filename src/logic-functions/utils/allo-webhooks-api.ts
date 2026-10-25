import { ALLO_API_BASE_URL } from 'src/constants/allo-api';

export type AlloWebhookEndpoint = {
  id: string;
  url: string;
  topics: string[];
  enabled: boolean;
  /** Returned by create only. */
  signingSecret: string | null;
};

/** A non-2xx answer from Allo, kept with its status so callers can branch on it. */
export class AlloApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'AlloApiError';
    this.status = status;
  }
}

type RequestInput = {
  apiKey: string;
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  body?: unknown;
  baseUrl?: string;
};

const requestAllo = async ({
  apiKey,
  method,
  path,
  body,
  baseUrl = ALLO_API_BASE_URL,
}: RequestInput): Promise<unknown> => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      // The scheme is `Api-Key`, not `Bearer`.
      authorization: `Api-Key ${apiKey}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();

  if (!response.ok) {
    // 401/403 almost always mean a revoked key or a missing scope.
    throw new AlloApiError(
      `Allo ${method} ${path} answered ${response.status}: ${text.slice(0, 300)}`,
      response.status,
    );
  }

  if (text.length === 0) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new AlloApiError(`Allo ${method} ${path} returned a non-JSON body`, 502);
  }
};

const toEndpoint = (payload: unknown): AlloWebhookEndpoint => {
  const data = (payload as { data?: Record<string, unknown> } | null)?.data;

  if (!data || typeof data.id !== 'string' || typeof data.url !== 'string') {
    throw new AlloApiError('Allo returned an unexpected webhook payload', 502);
  }

  return {
    id: data.id,
    url: data.url,
    topics: Array.isArray(data.topics)
      ? data.topics.filter((topic): topic is string => typeof topic === 'string')
      : [],
    enabled: data.enabled !== false,
    signingSecret:
      typeof data.signing_secret === 'string' ? data.signing_secret : null,
  };
};

/**
 * POST /v2/api/webhooks. Requires the WEBHOOKS_READ_WRITE scope. The signing
 * secret is returned only by this call.
 * https://help.withallo.com/en/v2/api-reference/webhooks/create-webhook
 */
export const createAlloWebhook = async ({
  apiKey,
  url,
  topics,
  description,
}: {
  apiKey: string;
  url: string;
  topics: readonly string[];
  description: string;
}): Promise<AlloWebhookEndpoint> =>
  toEndpoint(
    await requestAllo({
      apiKey,
      method: 'POST',
      path: '/v2/api/webhooks',
      body: { url, topics, description },
    }),
  );

/** GET /v2/api/webhooks/{id}. Resolves to null when Allo no longer has it. */
export const getAlloWebhook = async ({
  apiKey,
  webhookId,
}: {
  apiKey: string;
  webhookId: string;
}): Promise<AlloWebhookEndpoint | null> => {
  try {
    return toEndpoint(
      await requestAllo({
        apiKey,
        method: 'GET',
        path: `/v2/api/webhooks/${encodeURIComponent(webhookId)}`,
      }),
    );
  } catch (error) {
    if (error instanceof AlloApiError && error.status === 404) {
      return null;
    }

    throw error;
  }
};

/** DELETE /v2/api/webhooks/{id}. A webhook that is already gone counts as deleted. */
export const deleteAlloWebhook = async ({
  apiKey,
  webhookId,
}: {
  apiKey: string;
  webhookId: string;
}): Promise<void> => {
  try {
    await requestAllo({
      apiKey,
      method: 'DELETE',
      path: `/v2/api/webhooks/${encodeURIComponent(webhookId)}`,
    });
  } catch (error) {
    if (error instanceof AlloApiError && error.status === 404) {
      return;
    }

    throw error;
  }
};
