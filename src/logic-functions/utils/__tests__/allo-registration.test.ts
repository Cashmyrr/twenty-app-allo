import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMemoryKv } from 'src/__tests__/utils/create-memory-kv';
import {
  ALLO_REGISTRATION_KV_KEY,
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
const API_URL = 'https://crm.example.com';

type AlloRoute = { method: string; path: string };
type AlloReply = { status: number; body?: unknown };

/** Fakes Allo's webhook endpoints and records every request. */
const fakeAllo = (routes: (request: AlloRoute & { body: any }) => AlloReply) => {
  const requests: (AlloRoute & { body: any })[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const request = {
        method: init.method ?? 'GET',
        path: new URL(url).pathname,
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
    url: 'https://crm.example.com/webhooks/server/x',
    topics: ['call.completed'],
    enabled: true,
    signing_secret: 'whsec_c2VjcmV0',
    ...overrides,
  },
});

const RESOLVER_PATH = `/webhooks/server/${ALLO_WEBHOOK_RESOLVER_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER}`;
const OLD_WEBHOOK_URL = `${API_URL}${RESOLVER_PATH}?registrationId=reg_old`;

const seedRegistration = async ({
  apiKey = API_KEY,
  webhookUrl = OLD_WEBHOOK_URL,
}: { apiKey?: string; webhookUrl?: string } = {}) => {
  await memoryKv.set(ALLO_REGISTRATION_KV_KEY, {
    registrationId: 'reg_old',
    webhookId: 'ep_old',
    webhookUrl,
    apiKeyFingerprint: fingerprintApiKey(apiKey),
    connectedAt: '2026-01-01T00:00:00.000Z',
  });
  await memoryKv.set(
    getAlloRegistrationClaimKey('reg_old'),
    { workspaceId: 'ws_1', signingSecret: 'whsec_b2xk' },
    { scope: 'SERVER' },
  );
};

beforeEach(() => {
  memoryKv.store.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildAlloWebhookUrl', () => {
  it('targets the resolver server route and carries the registration id', () => {
    expect(
      buildAlloWebhookUrl({ apiUrl: `${API_URL}/`, registrationId: 'reg_1' }),
    ).toBe(
      `${API_URL}/webhooks/server/${ALLO_WEBHOOK_RESOLVER_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER}?registrationId=reg_1`,
    );
  });

  it('keeps a base path the server is mounted under', () => {
    expect(
      buildAlloWebhookUrl({ apiUrl: `${API_URL}/twenty`, registrationId: 'r' }),
    ).toContain('/twenty/webhooks/server/');
  });

  it('refuses a non-HTTPS server, which Allo cannot deliver to', () => {
    expect(() =>
      buildAlloWebhookUrl({ apiUrl: 'http://localhost:2020', registrationId: 'r' }),
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
      apiUrl: API_URL,
      workspaceId: 'ws_1',
      workspaceUrl: 'https://acme.twenty.com',
    });

    expect(requests[0].body.description).toBe('Twenty CRM (acme.twenty.com)');
  });

  it('registers a webhook and stores the claim the resolver needs', async () => {
    const requests = fakeAllo(() => ({ status: 201, body: webhookBody() }));

    const result = await connectAllo({
      apiKey: API_KEY,
      apiUrl: API_URL,
      workspaceId: 'ws_1',
    });

    expect(result.outcome).toBe('connected');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: 'POST', path: '/v2/api/webhooks' });
    expect(requests[0].body.url).toBe(result.webhookUrl);
    expect(requests[0].body.topics).toEqual(
      expect.arrayContaining(['call.completed', 'tag.added', 'tag.removed']),
    );

    const registration = await memoryKv.get<any>(ALLO_REGISTRATION_KV_KEY);
    expect(registration).toMatchObject({
      webhookId: 'ep_new',
      webhookUrl: result.webhookUrl,
      apiKeyFingerprint: fingerprintApiKey(API_KEY),
    });

    // The claim lives in the server scope, where the resolver can read it.
    expect(
      await memoryKv.get(getAlloRegistrationClaimKey(registration.registrationId), {
        scope: 'SERVER',
      }),
    ).toEqual({ workspaceId: 'ws_1', signingSecret: 'whsec_c2VjcmV0' });
  });

  it('never stores the API key itself', async () => {
    fakeAllo(() => ({ status: 201, body: webhookBody() }));

    await connectAllo({ apiKey: API_KEY, apiUrl: API_URL, workspaceId: 'ws_1' });

    expect(JSON.stringify([...memoryKv.store.values()])).not.toContain(API_KEY);
  });

  it('leaves a healthy registration untouched', async () => {
    await seedRegistration();
    const requests = fakeAllo(() => ({
      status: 200,
      body: webhookBody({ id: 'ep_old', url: OLD_WEBHOOK_URL }),
    }));

    const result = await connectAllo({
      apiKey: API_KEY,
      apiUrl: API_URL,
      workspaceId: 'ws_1',
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
        url: `https://CRM.example.com:443${RESOLVER_PATH}/?registrationId=reg_old`,
      }),
    }));

    const result = await connectAllo({
      apiKey: API_KEY,
      apiUrl: API_URL,
      workspaceId: 'ws_1',
    });

    expect(result.outcome).toBe('already-connected');
    expect(requests).toHaveLength(1);
  });

  it('re-creates the webhook when the server URL changed', async () => {
    await seedRegistration();
    const requests = fakeAllo(({ method }) =>
      method === 'GET'
        ? { status: 200, body: webhookBody({ id: 'ep_old', url: OLD_WEBHOOK_URL }) }
        : { status: method === 'DELETE' ? 204 : 201, body: webhookBody() },
    );

    const result = await connectAllo({
      apiKey: API_KEY,
      apiUrl: 'https://twenty.example.org',
      workspaceId: 'ws_1',
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
      apiUrl: API_URL,
      workspaceId: 'ws_1',
    });

    expect(result.outcome).toBe('connected');
    expect(requests.map((request) => request.method)).toEqual([
      'GET',
      'DELETE',
      'POST',
    ]);
    expect(
      await memoryKv.get(getAlloRegistrationClaimKey('reg_old'), { scope: 'SERVER' }),
    ).toBeNull();
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

    await connectAllo({ apiKey: API_KEY, apiUrl: API_URL, workspaceId: 'ws_1' });

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
      apiUrl: API_URL,
      workspaceId: 'ws_1',
    });

    expect(result.outcome).toBe('connected');
    expect(requests.map((request) => request.method)).toEqual(['DELETE', 'POST']);
  });

  it('deletes the new webhook when the secret cannot be stored', async () => {
    const requests = fakeAllo(({ method }) =>
      method === 'POST' ? { status: 201, body: webhookBody() } : { status: 204 },
    );
    const set = vi
      .spyOn(memoryKv, 'set')
      .mockRejectedValueOnce(new Error('kv unavailable'));

    await expect(
      connectAllo({ apiKey: API_KEY, apiUrl: API_URL, workspaceId: 'ws_1' }),
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
      connectAllo({ apiKey: API_KEY, apiUrl: API_URL, workspaceId: 'ws_1' }),
    ).rejects.toThrow(/signing secret/);

    expect(requests.map((request) => request.method)).toEqual(['POST', 'DELETE']);
  });

  it('surfaces Allo refusing the key', async () => {
    fakeAllo(() => ({ status: 403, body: { error: { code: 'FORBIDDEN' } } }));

    await expect(
      connectAllo({ apiKey: API_KEY, apiUrl: API_URL, workspaceId: 'ws_1' }),
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
