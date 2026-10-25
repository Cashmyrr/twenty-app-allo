import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMemoryKv } from 'src/__tests__/utils/create-memory-kv';
import {
  ALLO_REGISTRATION_KV_KEY,
  ALLO_WEBHOOK_PROBE_KV_KEY,
  getAlloRegistrationClaimKey,
} from 'src/constants/allo-registration';
import { ALLO_WEBHOOK_RESOLVER_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

const memoryKv = createMemoryKv();

vi.mock('twenty-sdk/logic-function', async (importOriginal) => ({
  ...(await importOriginal<typeof import('twenty-sdk/logic-function')>()),
  kv: memoryKv,
}));

const {
  buildAlloWebhookUrl,
  connectAllo,
  describeAlloWebhook,
  disconnectAllo,
  fingerprintApiKey,
  getAlloConnectionStatus,
} = await import('src/logic-functions/utils/allo-registration');

const API_KEY = 'allo_key_1';
const BASE_URL = 'https://acme.withtwenty.com';

type AlloRoute = { method: string; path: string };
type AlloReply = { status: number; body?: unknown };

/**
 * Fakes Allo's webhook endpoints and records every request to them. Any other
 * host is this workspace's receiver, which echoes Connect's probe.
 */
const fakeAllo = (routes: (request: AlloRoute & { body: any }) => AlloReply) => {
  const requests: (AlloRoute & { body: any })[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init: RequestInit) => {
      const url = new URL(input);

      if (url.host !== 'api.withallo.com') {
        const expected = await memoryKv.get<string>(ALLO_WEBHOOK_PROBE_KV_KEY);
        const echoed =
          expected !== null &&
          url.searchParams.get('probe') === expected &&
          new Headers(init.headers).get('webhook-id') === expected &&
          String(init.body).includes(expected);

        return echoed
          ? new Response(JSON.stringify({ probe: 'ok' }), { status: 200 })
          : new Response(null, { status: 404 });
      }

      const request = {
        method: init.method ?? 'GET',
        path: url.pathname,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      };

      requests.push(request);

      const reply = routes(request);

      return new Response(
        reply.body === undefined ? null : JSON.stringify(reply.body),
        { status: reply.status },
      );
    }),
  );

  return requests;
};

const webhookBody = (overrides: Record<string, unknown> = {}) => ({
  data: {
    id: 'ep_new',
    url: 'https://acme.withtwenty.com/allo/webhook?registrationId=x',
    topics: ['call.completed'],
    enabled: true,
    signing_secret: 'whsec_c2VjcmV0',
    ...overrides,
  },
});

const OLD_WEBHOOK_URL = `${BASE_URL}/allo/webhook?registrationId=reg_old`;
// What 0.2.0 pre-releases registered: a server route shared by every workspace.
const SERVER_ROUTE_WEBHOOK_URL = `https://api.twenty.com/webhooks/server/${ALLO_WEBHOOK_RESOLVER_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER}?registrationId=reg_old`;

const seedRegistration = async ({
  apiKey = API_KEY,
  webhookUrl = OLD_WEBHOOK_URL,
  withoutSecret = false,
}: { apiKey?: string; webhookUrl?: string; withoutSecret?: boolean } = {}) => {
  await memoryKv.set(ALLO_REGISTRATION_KV_KEY, {
    registrationId: 'reg_old',
    webhookId: 'ep_old',
    webhookUrl,
    ...(withoutSecret ? {} : { signingSecret: 'whsec_b2xk' }),
    apiKeyFingerprint: fingerprintApiKey(apiKey),
    connectedAt: '2026-01-01T00:00:00.000Z',
  });
};

beforeEach(() => {
  memoryKv.store.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildAlloWebhookUrl', () => {
  it('targets the receiver route and carries the registration id', () => {
    expect(
      buildAlloWebhookUrl({ baseUrl: `${BASE_URL}/`, registrationId: 'reg_1' }),
    ).toBe(`${BASE_URL}/allo/webhook?registrationId=reg_1`);
  });

  it('keeps the /s prefix of a server without a public function domain', () => {
    expect(
      buildAlloWebhookUrl({
        baseUrl: 'https://crm.example.com/s',
        registrationId: 'r',
      }),
    ).toBe('https://crm.example.com/s/allo/webhook?registrationId=r');
  });

  it('refuses a non-HTTPS server, which Allo cannot deliver to', () => {
    expect(() =>
      buildAlloWebhookUrl({ baseUrl: 'http://localhost:2020/s', registrationId: 'r' }),
    ).toThrow(/HTTPS/);
  });
});

describe('describeAlloWebhook', () => {
  it('names the workspace by its host', () => {
    expect(describeAlloWebhook('https://acme.twenty.com/')).toBe(
      'Twenty CRM (acme.twenty.com)',
    );
  });

  it('falls back to a generic name without a usable URL', () => {
    expect(describeAlloWebhook()).toBe('Twenty CRM');
    expect(describeAlloWebhook('not a url')).toBe('Twenty CRM');
  });
});

describe('connectAllo', () => {
  it('describes the webhook with the workspace URL', async () => {
    const requests = fakeAllo(() => ({ status: 201, body: webhookBody() }));

    await connectAllo({
      apiKey: API_KEY,
      webhookBaseUrl: BASE_URL,
      workspaceUrl: 'https://acme.twenty.com',
    });

    expect(requests[0].body.description).toBe('Twenty CRM (acme.twenty.com)');
  });

  it('registers a webhook and keeps its secret in the workspace', async () => {
    const requests = fakeAllo(() => ({ status: 201, body: webhookBody() }));

    const result = await connectAllo({
      apiKey: API_KEY,
      webhookBaseUrl: BASE_URL,
    });

    expect(result.outcome).toBe('connected');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: 'POST', path: '/v2/api/webhooks' });
    expect(requests[0].body.url).toBe(result.webhookUrl);
    expect(requests[0].body.topics).toEqual(
      expect.arrayContaining(['call.completed', 'tag.added', 'tag.removed']),
    );

    expect(await memoryKv.get(ALLO_REGISTRATION_KV_KEY)).toMatchObject({
      webhookId: 'ep_new',
      webhookUrl: result.webhookUrl,
      signingSecret: 'whsec_c2VjcmV0',
      apiKeyFingerprint: fingerprintApiKey(API_KEY),
    });
    // Nothing in the server scope, and the probe nonce is gone.
    expect([...memoryKv.store.keys()]).toEqual([
      `WORKSPACE:${ALLO_REGISTRATION_KV_KEY}`,
    ]);
  });

  it('creates nothing in Allo when its own URL does not answer the probe', async () => {
    const alloCalls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = new URL(input);

        if (url.host !== 'api.withallo.com') {
          return new Response(null, { status: 404 });
        }

        alloCalls.push(url.pathname);

        return new Response(JSON.stringify(webhookBody()), { status: 201 });
      }),
    );

    await expect(
      connectAllo({ apiKey: API_KEY, webhookBaseUrl: BASE_URL }),
    ).rejects.toThrow('does not reach this workspace (HTTP 404)');
    expect(alloCalls).toHaveLength(0);
    expect(memoryKv.store.size).toBe(0);
  });

  // Allo may reach a URL this server cannot reach from inside.
  it('registers anyway when its own URL cannot be reached from the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        if (new URL(input).host !== 'api.withallo.com') {
          throw new TypeError('fetch failed');
        }

        return new Response(JSON.stringify(webhookBody()), { status: 201 });
      }),
    );

    const result = await connectAllo({ apiKey: API_KEY, webhookBaseUrl: BASE_URL });

    expect(result.outcome).toBe('connected');
    expect(await memoryKv.get(ALLO_WEBHOOK_PROBE_KV_KEY)).toBeNull();
  });

  it('moves a 0.2.0 pre-release webhook off the server route', async () => {
    await seedRegistration({ webhookUrl: SERVER_ROUTE_WEBHOOK_URL });
    await memoryKv.set(getAlloRegistrationClaimKey('reg_old'), 'ignored', {
      scope: 'SERVER',
    });
    const requests = fakeAllo(({ method }) =>
      method === 'GET'
        ? {
            status: 200,
            body: webhookBody({ id: 'ep_old', url: SERVER_ROUTE_WEBHOOK_URL }),
          }
        : { status: method === 'DELETE' ? 204 : 201, body: webhookBody() },
    );

    const result = await connectAllo({ apiKey: API_KEY, webhookBaseUrl: BASE_URL });

    expect(result.webhookUrl).toMatch(/^https:\/\/acme\.withtwenty\.com\/allo\/webhook\?/);
    expect(requests.map((request) => request.method)).toEqual([
      'GET',
      'DELETE',
      'POST',
    ]);
    expect(
      await memoryKv.get(getAlloRegistrationClaimKey('reg_old'), { scope: 'SERVER' }),
    ).toBeNull();
  });

  it('never stores the API key itself', async () => {
    fakeAllo(() => ({ status: 201, body: webhookBody() }));

    await connectAllo({ apiKey: API_KEY, webhookBaseUrl: BASE_URL });

    expect(JSON.stringify([...memoryKv.store.values()])).not.toContain(API_KEY);
  });

  it('re-creates a webhook whose signing secret was never stored', async () => {
    await seedRegistration({ withoutSecret: true });
    const requests = fakeAllo(({ method }) =>
      method === 'GET'
        ? { status: 200, body: webhookBody({ id: 'ep_old', url: OLD_WEBHOOK_URL }) }
        : { status: method === 'DELETE' ? 204 : 201, body: webhookBody() },
    );

    const result = await connectAllo({
      apiKey: API_KEY,
      webhookBaseUrl: BASE_URL,
    });

    expect(result.outcome).toBe('connected');
    expect(requests.map((request) => request.method)).toEqual([
      'GET',
      'DELETE',
      'POST',
    ]);
  });

  it('leaves a healthy registration untouched', async () => {
    await seedRegistration();
    const requests = fakeAllo(() => ({
      status: 200,
      body: webhookBody({ id: 'ep_old', url: OLD_WEBHOOK_URL }),
    }));

    const result = await connectAllo({
      apiKey: API_KEY,
      webhookBaseUrl: BASE_URL,
    });

    expect(result.outcome).toBe('already-connected');
    expect(requests.map((request) => request.method)).toEqual(['GET']);
  });

  // A string comparison would delete and re-create the webhook on every sync.
  it('accepts the URL back from Allo in a normalised form', async () => {
    await seedRegistration();
    const requests = fakeAllo(() => ({
      status: 200,
      body: webhookBody({
        id: 'ep_old',
        url: 'https://ACME.withtwenty.com:443/allo/webhook/?registrationId=reg_old',
      }),
    }));

    const result = await connectAllo({
      apiKey: API_KEY,
      webhookBaseUrl: BASE_URL,
    });

    expect(result.outcome).toBe('already-connected');
    expect(requests).toHaveLength(1);
  });

  it('re-creates the webhook when the workspace URL changed', async () => {
    await seedRegistration();
    const requests = fakeAllo(({ method }) =>
      method === 'GET'
        ? { status: 200, body: webhookBody({ id: 'ep_old', url: OLD_WEBHOOK_URL }) }
        : { status: method === 'DELETE' ? 204 : 201, body: webhookBody() },
    );

    const result = await connectAllo({
      apiKey: API_KEY,
      webhookBaseUrl: 'https://renamed.withtwenty.com',
    });

    expect(result.outcome).toBe('connected');
    expect(requests.map((request) => request.method)).toEqual([
      'GET',
      'DELETE',
      'POST',
    ]);
  });

  it('re-creates a webhook that was deleted in Allo', async () => {
    await seedRegistration();
    const requests = fakeAllo(({ method }) =>
      method === 'POST'
        ? { status: 201, body: webhookBody() }
        : { status: 404, body: { error: { code: 'NOT_FOUND' } } },
    );

    const result = await connectAllo({
      apiKey: API_KEY,
      webhookBaseUrl: BASE_URL,
    });

    expect(result.outcome).toBe('connected');
    expect(requests.map((request) => request.method)).toEqual([
      'GET',
      'DELETE',
      'POST',
    ]);
  });

  it('re-creates a webhook Allo disabled after repeated failures', async () => {
    await seedRegistration();
    const requests = fakeAllo(({ method }) =>
      method === 'GET'
        ? {
            status: 200,
            body: webhookBody({
              id: 'ep_old',
              url: OLD_WEBHOOK_URL,
              enabled: false,
            }),
          }
        : { status: method === 'DELETE' ? 204 : 201, body: webhookBody() },
    );

    await connectAllo({ apiKey: API_KEY, webhookBaseUrl: BASE_URL });

    expect(requests.map((request) => request.method)).toEqual([
      'GET',
      'DELETE',
      'POST',
    ]);
  });

  it('replaces the registration when the API key changed', async () => {
    await seedRegistration({ apiKey: 'previous_key' });
    const requests = fakeAllo(({ method }) =>
      method === 'DELETE'
        ? { status: 204 }
        : { status: 201, body: webhookBody() },
    );

    const result = await connectAllo({
      apiKey: API_KEY,
      webhookBaseUrl: BASE_URL,
    });

    expect(result.outcome).toBe('connected');
    expect(requests.map((request) => request.method)).toEqual(['DELETE', 'POST']);
  });

  it('deletes the new webhook when the secret cannot be stored', async () => {
    const requests = fakeAllo(({ method }) =>
      method === 'POST' ? { status: 201, body: webhookBody() } : { status: 204 },
    );
    const originalSet = memoryKv.set;
    const set = vi
      .spyOn(memoryKv, 'set')
      .mockImplementation((key, value, options) =>
        key === ALLO_REGISTRATION_KV_KEY
          ? Promise.reject(new Error('kv unavailable'))
          : originalSet(key, value, options),
      );

    await expect(
      connectAllo({ apiKey: API_KEY, webhookBaseUrl: BASE_URL }),
    ).rejects.toThrow('kv unavailable');

    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'POST /v2/api/webhooks',
      'DELETE /v2/api/webhooks/ep_new',
    ]);
    expect(await memoryKv.get(ALLO_REGISTRATION_KV_KEY)).toBeNull();

    set.mockRestore();
  });

  it('deletes a webhook Allo created without a signing secret', async () => {
    const requests = fakeAllo(({ method }) =>
      method === 'POST'
        ? { status: 201, body: webhookBody({ signing_secret: null }) }
        : { status: 204 },
    );

    await expect(
      connectAllo({ apiKey: API_KEY, webhookBaseUrl: BASE_URL }),
    ).rejects.toThrow(/signing secret/);

    expect(requests.map((request) => request.method)).toEqual(['POST', 'DELETE']);
  });

  it('surfaces Allo refusing the key', async () => {
    fakeAllo(() => ({ status: 403, body: { error: { code: 'FORBIDDEN' } } }));

    await expect(
      connectAllo({ apiKey: API_KEY, webhookBaseUrl: BASE_URL }),
    ).rejects.toMatchObject({ name: 'AlloApiError', status: 403 });
  });
});

describe('disconnectAllo', () => {
  it('deletes the webhook in Allo and forgets the registration', async () => {
    await seedRegistration();
    const requests = fakeAllo(() => ({ status: 204 }));

    expect(await disconnectAllo({ apiKey: API_KEY })).toEqual({
      removedFromAllo: true,
    });
    expect(requests[0]).toMatchObject({
      method: 'DELETE',
      path: '/v2/api/webhooks/ep_old',
    });
    expect(memoryKv.store.size).toBe(0);
  });

  it('still forgets the registration when Allo cannot be reached', async () => {
    await seedRegistration();
    fakeAllo(() => ({ status: 500 }));

    expect(await disconnectAllo({ apiKey: API_KEY })).toEqual({
      removedFromAllo: false,
    });
    expect(memoryKv.store.size).toBe(0);
  });

  it('forgets the registration without a key', async () => {
    await seedRegistration();
    const requests = fakeAllo(() => ({ status: 204 }));

    await disconnectAllo({ apiKey: undefined });

    expect(requests).toHaveLength(0);
    expect(memoryKv.store.size).toBe(0);
  });
});

describe('getAlloConnectionStatus', () => {
  it('reports a missing key first', async () => {
    expect(await getAlloConnectionStatus(undefined)).toEqual({
      state: 'missing-api-key',
    });
  });

  it('is disconnected until the webhook is registered', async () => {
    expect((await getAlloConnectionStatus(API_KEY)).state).toBe('disconnected');
  });

  it('flags a registration made with another key', async () => {
    await seedRegistration({ apiKey: 'previous_key' });

    expect((await getAlloConnectionStatus(API_KEY)).state).toBe(
      'api-key-changed',
    );
  });

  it('is connected with a registration for the current key, without asking Allo', async () => {
    await seedRegistration();
    const requests = fakeAllo(() => ({ status: 500 }));

    expect(await getAlloConnectionStatus(API_KEY)).toMatchObject({
      state: 'connected',
      webhookUrl: OLD_WEBHOOK_URL,
    });
    expect(requests).toHaveLength(0);
  });

  it('flags a registration stored without its signing secret', async () => {
    await seedRegistration({ withoutSecret: true });

    expect((await getAlloConnectionStatus(API_KEY)).state).toBe(
      'secret-missing',
    );
  });

  it('detects a webhook deleted in Allo when asked to check', async () => {
    await seedRegistration();
    fakeAllo(() => ({ status: 404 }));

    expect(
      (await getAlloConnectionStatus(API_KEY, { checkAllo: true })).state,
    ).toBe('webhook-missing');
  });

  it('detects a webhook Allo disabled when asked to check', async () => {
    await seedRegistration();
    fakeAllo(() => ({
      status: 200,
      body: webhookBody({ id: 'ep_old', url: OLD_WEBHOOK_URL, enabled: false }),
    }));

    expect(
      (await getAlloConnectionStatus(API_KEY, { checkAllo: true })).state,
    ).toBe('webhook-missing');
  });
});
