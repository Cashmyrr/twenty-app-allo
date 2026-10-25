import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMemoryKv } from 'src/__tests__/utils/create-memory-kv';
import { ALLO_REGISTRATION_KV_KEY } from 'src/constants/allo-registration';

const memoryKv = createMemoryKv();
let permissionFlags: string[] = ['APPLICATIONS'];

vi.mock('twenty-sdk/logic-function', async (importOriginal) => ({
  ...(await importOriginal<typeof import('twenty-sdk/logic-function')>()),
  kv: memoryKv,
}));

vi.mock('twenty-client-sdk/metadata', () => ({
  MetadataApiClient: class {
    query = async () => ({
      currentUser: { currentUserWorkspace: { permissionFlags } },
      currentWorkspace: {
        subdomain: 'acme',
        workspaceUrls: { subdomainUrl: 'https://acme.twenty.com' },
      },
    });
  },
}));

const { alloConnectHandler } = await import('src/logic-functions/allo-connect');
const { alloDisconnectHandler } = await import(
  'src/logic-functions/allo-disconnect'
);
const { alloConnectionStatusHandler } = await import(
  'src/logic-functions/allo-connection-status'
);
const { healthCheckHandler } = await import('src/logic-functions/health-check');
const { alloWebhookReceiverHandler } = await import(
  'src/logic-functions/allo-webhook-receiver'
);

const alloRequests: string[] = [];
let createdWebhook: Record<string, unknown> | null = null;

const CLOUD_CONFIG = {
  serverUrl: 'https://crm.example.com',
  publicFunctionDomain: 'withtwenty.com',
  isMultiWorkspaceEnabled: true,
};
let clientConfig: Record<string, unknown> = CLOUD_CONFIG;
let workspaceReachable = true;

/** Twenty's public function domain, serving the real receiver route. */
const servePublicRoute = async (url: URL, init: RequestInit) => {
  if (!workspaceReachable) {
    return new Response(JSON.stringify({ error: 'Workspace not found' }), {
      status: 404,
    });
  }

  const result = (await alloWebhookReceiverHandler({
    headers: Object.fromEntries(new Headers(init.headers).entries()),
    queryStringParameters: Object.fromEntries(url.searchParams),
    pathParameters: {},
    body: null,
    rawBody: String(init.body ?? ''),
    isBase64Encoded: false,
    requestContext: { http: { method: 'POST', path: url.pathname } },
    userWorkspaceId: null,
  } as never)) as unknown as { status: number; body: unknown };

  return new Response(JSON.stringify(result.body), { status: result.status });
};

/**
 * Allo with one webhook endpoint that can be created, read and deleted, plus
 * the two Twenty URLs Connect reads: the client config and its own webhook.
 */
const fakeAllo = ({ status }: { status?: number } = {}) => {
  let endpoint: Record<string, unknown> | null = null;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const url = new URL(input);
      const method = init.method ?? 'GET';

      if (url.pathname === '/client-config') {
        return new Response(JSON.stringify(clientConfig), { status: 200 });
      }

      if (url.host !== 'api.withallo.com') {
        return servePublicRoute(url, init);
      }

      alloRequests.push(`${method} ${url.pathname}`);

      if (status !== undefined) {
        return new Response(JSON.stringify({ error: {} }), { status });
      }

      if (method === 'POST') {
        const body = JSON.parse(String(init.body));

        createdWebhook = body;

        endpoint = {
          id: 'ep_1',
          url: body.url,
          enabled: true,
          signing_secret: 'whsec_c2VjcmV0',
        };

        return new Response(JSON.stringify({ data: endpoint }), { status: 201 });
      }

      if (method === 'DELETE') {
        endpoint = null;

        return new Response(null, { status: 204 });
      }

      return endpoint
        ? new Response(JSON.stringify({ data: endpoint }), { status: 200 })
        : new Response(JSON.stringify({ error: {} }), { status: 404 });
    }),
  );
};

const connect = () => alloConnectHandler();

beforeEach(() => {
  memoryKv.store.clear();
  alloRequests.length = 0;
  createdWebhook = null;
  clientConfig = CLOUD_CONFIG;
  workspaceReachable = true;
  permissionFlags = ['APPLICATIONS'];
  process.env.ALLO_API_KEY = 'allo_key_1';
  process.env.TWENTY_API_URL = 'https://crm.example.com';
  fakeAllo();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ALLO_API_KEY;
  delete process.env.TWENTY_API_URL;
});

describe('connect', () => {
  it('registers the webhook, and the health check turns OK', async () => {
    expect(await healthCheckHandler()).toMatchObject({ status: 'WARNING' });

    const result = await connect();

    expect(result).toMatchObject({ success: true, outcome: 'connected' });
    expect(await healthCheckHandler()).toEqual({ status: 'OK' });
    expect(await alloConnectionStatusHandler()).toMatchObject({
      state: 'connected',
    });
  });

  // Twenty picks the workspace from the host, so the receiver runs where the
  // secret is and can refuse a bad signature on the spot.
  it('points the webhook at the workspace on the public function domain', async () => {
    await connect();

    expect(createdWebhook?.url).toMatch(
      /^https:\/\/acme\.withtwenty\.com\/allo\/webhook\?registrationId=[0-9a-f-]{36}$/,
    );
  });

  it('uses the /s/ route of a single-workspace server', async () => {
    clientConfig = {
      serverUrl: 'https://crm.example.com',
      publicFunctionDomain: null,
      isMultiWorkspaceEnabled: false,
    };

    await connect();

    expect(createdWebhook?.url).toMatch(
      /^https:\/\/crm\.example\.com\/s\/allo\/webhook\?registrationId=/,
    );
  });

  it('touches nothing in Allo when the URL does not reach this workspace', async () => {
    await connect();
    const before = await memoryKv.get(ALLO_REGISTRATION_KV_KEY);
    process.env.ALLO_API_KEY = 'allo_key_2';
    workspaceReachable = false;
    alloRequests.length = 0;

    expect(await connect()).toEqual({
      success: false,
      error: expect.stringContaining('does not reach this workspace'),
    });
    expect(alloRequests).toEqual([]);
    expect(await memoryKv.get(ALLO_REGISTRATION_KV_KEY)).toEqual(before);
  });

  it('names the workspace in the webhook description', async () => {
    await connect();

    expect(createdWebhook?.description).toBe('Twenty CRM (acme.twenty.com)');
  });

  it('does nothing more than one check when already connected', async () => {
    await connect();
    alloRequests.length = 0;

    expect(await connect()).toMatchObject({ outcome: 'already-connected' });
    expect(alloRequests).toEqual(['GET /v2/api/webhooks/ep_1']);
  });

  it('requires the permission to manage applications', async () => {
    permissionFlags = [];

    expect(await connect()).toMatchObject({ success: false });
    expect(alloRequests).toHaveLength(0);
  });

  it('asks for a key when none is saved', async () => {
    delete process.env.ALLO_API_KEY;

    expect(await connect()).toEqual({
      success: false,
      error: 'Save an Allo API key first.',
    });
  });

  it('explains a refused key in terms an admin can act on', async () => {
    fakeAllo({ status: 403 });

    expect(await connect()).toEqual({
      success: false,
      error: expect.stringContaining('WEBHOOKS_READ_WRITE'),
    });
  });

  it('refuses a server that is not reachable over HTTPS', async () => {
    clientConfig = {
      serverUrl: 'http://localhost:2020',
      publicFunctionDomain: null,
      isMultiWorkspaceEnabled: false,
    };

    expect(await connect()).toEqual({
      success: false,
      error: expect.stringContaining('HTTPS'),
    });
    expect(alloRequests).toHaveLength(0);
  });
});

describe('disconnect', () => {
  it('deletes the webhook in Allo and forgets the registration', async () => {
    await connect();

    expect(await alloDisconnectHandler()).toEqual({
      success: true,
      removedFromAllo: true,
    });
    expect(await memoryKv.get(ALLO_REGISTRATION_KV_KEY)).toBeNull();
    expect(alloRequests).toContain('DELETE /v2/api/webhooks/ep_1');
  });

  it('requires the permission to manage applications', async () => {
    await connect();
    permissionFlags = [];

    expect(await alloDisconnectHandler()).toMatchObject({ success: false });
    expect(await memoryKv.get(ALLO_REGISTRATION_KV_KEY)).not.toBeNull();
  });
});

describe('connection status', () => {
  it('notices a webhook deleted in Allo', async () => {
    await connect();
    await fetch('https://api.withallo.com/v2/api/webhooks/ep_1', {
      method: 'DELETE',
    });

    expect(await alloConnectionStatusHandler()).toMatchObject({
      state: 'webhook-missing',
    });
  });

  it('reports Allo being unreachable instead of failing', async () => {
    await connect();
    fakeAllo({ status: 503 });

    expect(await alloConnectionStatusHandler()).toMatchObject({
      state: 'unknown',
    });
  });
});

describe('health check', () => {
  it('points at the settings tab when Allo is not connected', async () => {
    delete process.env.ALLO_API_KEY;

    const result = await healthCheckHandler();

    expect(result).toMatchObject({
      status: 'WARNING',
      action: { label: 'Connect Allo' },
    });
    // Without a location Twenty opens the app's configuration tab.
    expect(result).not.toHaveProperty('action.location');
  });

  it('flags a key changed since the webhook was registered', async () => {
    await connect();
    process.env.ALLO_API_KEY = 'allo_key_2';

    expect(await healthCheckHandler()).toMatchObject({ status: 'ERROR' });
  });

  it('never calls Allo', async () => {
    await connect();
    alloRequests.length = 0;

    await healthCheckHandler();

    expect(alloRequests).toHaveLength(0);
  });
});
