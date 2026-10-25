import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMemoryKv } from 'src/__tests__/utils/create-memory-kv';
import {
  buildSignedRoutePayload,
  SIGNING_SECRET,
} from 'src/__tests__/utils/sign-allo-payload';
import {
  ALLO_REGISTRATION_KV_KEY,
  ALLO_WEBHOOK_PROBE_KV_KEY,
} from 'src/constants/allo-registration';
import { ALLO_WEBHOOK_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

const memoryKv = createMemoryKv();
const enqueueJobsMock = vi.fn();

vi.mock('twenty-sdk/logic-function', async (importOriginal) => ({
  ...(await importOriginal<typeof import('twenty-sdk/logic-function')>()),
  kv: memoryKv,
  enqueueJobs: enqueueJobsMock,
}));

const { alloWebhookReceiverHandler } = await import(
  'src/logic-functions/allo-webhook-receiver'
);

type HttpResult = { status: number; body: any };

const receive = (event: unknown) =>
  alloWebhookReceiverHandler(event as never) as unknown as Promise<HttpResult>;

const callReceived = {
  topic: 'call.received',
  data: { from_number: '+33612345678', to_number: '+33112345678' },
};

beforeEach(async () => {
  memoryKv.store.clear();
  enqueueJobsMock.mockReset();
  enqueueJobsMock.mockResolvedValue({ enqueued: true });
  await memoryKv.set(ALLO_REGISTRATION_KV_KEY, {
    registrationId: 'reg_1',
    signingSecret: SIGNING_SECRET,
  });
});

describe('allo webhook receiver', () => {
  it('queues a delivery signed with the workspace secret, already verified', async () => {
    const result = await receive(buildSignedRoutePayload({ body: callReceived }));

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ queued: true });
    expect(enqueueJobsMock).toHaveBeenCalledWith({
      logicFunctionUniversalIdentifier:
        ALLO_WEBHOOK_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
      payloads: [
        {
          kind: 'verified-delivery',
          registrationId: 'reg_1',
          webhookId: 'msg_1',
          event: callReceived,
        },
      ],
    });
  });

  it('answers 401 to a delivery signed with another secret, queuing nothing', async () => {
    const result = await receive(
      buildSignedRoutePayload({
        body: callReceived,
        secretBytes: Buffer.alloc(32, 7),
      }),
    );

    expect(result.status).toBe(401);
    expect(enqueueJobsMock).not.toHaveBeenCalled();
  });

  it('answers 401 to a request without the signature headers', async () => {
    const event = buildSignedRoutePayload({ body: callReceived });
    delete event.headers['webhook-signature'];

    expect((await receive(event)).status).toBe(401);
    expect(enqueueJobsMock).not.toHaveBeenCalled();
  });

  it('answers 401 to a replayed delivery outside the window', async () => {
    const event = buildSignedRoutePayload({ body: callReceived });
    vi.useFakeTimers({ now: Date.now() + 3600_000 });

    try {
      expect(await receive(event)).toMatchObject({
        status: 401,
        body: { error: 'Webhook timestamp outside tolerance' },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('answers 400 when the URL carries no registration id', async () => {
    const result = await receive(
      buildSignedRoutePayload({ body: callReceived, registrationId: null }),
    );

    expect(result.status).toBe(400);
  });

  // A replaced or disconnected webhook: Allo eventually disables it.
  it('answers 404 for a registration this workspace does not hold', async () => {
    const result = await receive(
      buildSignedRoutePayload({ body: callReceived, registrationId: 'reg_gone' }),
    );

    expect(result.status).toBe(404);
    expect(enqueueJobsMock).not.toHaveBeenCalled();
  });

  it('answers 404 once the workspace is disconnected', async () => {
    await memoryKv.delete(ALLO_REGISTRATION_KV_KEY);

    expect(
      (await receive(buildSignedRoutePayload({ body: callReceived }))).status,
    ).toBe(404);
  });

  // A 404 would get the endpoint disabled; a 500 keeps the delivery in Allo
  // until someone connects again.
  it('answers 500 while the registration has no signing secret', async () => {
    await memoryKv.set(ALLO_REGISTRATION_KV_KEY, { registrationId: 'reg_1' });

    const result = await receive(buildSignedRoutePayload({ body: callReceived }));

    expect(result.status).toBe(500);
    expect(enqueueJobsMock).not.toHaveBeenCalled();
  });

  it('refuses a request with no raw body rather than re-serialising it', async () => {
    const event = {
      ...buildSignedRoutePayload({ body: callReceived }),
      rawBody: undefined,
    };

    expect((await receive(event)).status).toBe(400);
  });

  it('verifies a base64-encoded body against the decoded bytes', async () => {
    const event = buildSignedRoutePayload({ body: callReceived });

    const result = await receive({
      ...event,
      rawBody: Buffer.from(event.rawBody, 'utf8').toString('base64'),
      isBase64Encoded: true,
    });

    expect(result.status).toBe(200);
  });

  it('rejects a signed body that is not JSON with 400', async () => {
    const result = await receive(buildSignedRoutePayload({ body: 'not json' }));

    expect(result.status).toBe(400);
  });

  it('acknowledges a topic it does not handle without queuing', async () => {
    const result = await receive(
      buildSignedRoutePayload({ body: { topic: 'sms.received', data: {} } }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: 200,
        body: { ignored: true, topic: 'sms.received' },
      }),
    );
    expect(enqueueJobsMock).not.toHaveBeenCalled();
  });

  it('answers 500 when the delivery cannot be queued, so Allo retries', async () => {
    enqueueJobsMock.mockRejectedValue(new Error('queue down'));

    const result = await receive(buildSignedRoutePayload({ body: callReceived }));

    expect(result.status).toBe(500);
  });
});

describe('allo webhook receiver: connect probe', () => {
  const probe = (nonce: string, { delivered = true } = {}) =>
    receive({
      headers: delivered ? { 'webhook-id': nonce } : {},
      queryStringParameters: { probe: nonce },
      rawBody: delivered ? JSON.stringify({ probe: nonce }) : undefined,
      isBase64Encoded: false,
    });

  it('echoes the nonce Connect stored', async () => {
    await memoryKv.set(ALLO_WEBHOOK_PROBE_KV_KEY, 'nonce_1');

    expect(await probe('nonce_1')).toMatchObject({
      status: 200,
      body: { probe: 'ok' },
    });
  });

  // The signature check needs both, so Connect must not pass without them.
  it('fails when the probe headers or body do not arrive', async () => {
    await memoryKv.set(ALLO_WEBHOOK_PROBE_KV_KEY, 'nonce_1');

    expect((await probe('nonce_1', { delivered: false })).status).toBe(422);
  });

  it('answers 404 to any other nonce', async () => {
    await memoryKv.set(ALLO_WEBHOOK_PROBE_KV_KEY, 'nonce_1');

    expect((await probe('guess')).status).toBe(404);
    expect(enqueueJobsMock).not.toHaveBeenCalled();
  });

  it('answers 404 when no probe is running', async () => {
    expect((await probe('nonce_1')).status).toBe(404);
  });
});
