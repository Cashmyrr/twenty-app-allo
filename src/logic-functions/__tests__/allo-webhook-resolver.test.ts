import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMemoryKv } from 'src/__tests__/utils/create-memory-kv';
import {
  buildSignedRoutePayload,
  SIGNING_SECRET,
} from 'src/__tests__/utils/sign-allo-payload';
import { getAlloRegistrationClaimKey } from 'src/constants/allo-registration';
import { ALLO_WEBHOOK_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

const memoryKv = createMemoryKv();

vi.mock('twenty-sdk/logic-function', async (importOriginal) => ({
  ...(await importOriginal<typeof import('twenty-sdk/logic-function')>()),
  kv: memoryKv,
}));

const { alloWebhookResolverHandler, default: resolverDefinition } =
  await import('src/logic-functions/allo-webhook-resolver');

type HttpResult = { status?: number; body: unknown };

const resolve = (event: unknown) =>
  alloWebhookResolverHandler(event as never) as Promise<
    HttpResult & Record<string, unknown>
  >;

const callReceived = {
  topic: 'call.received',
  data: { from_number: '+33612345678', to_number: '+33112345678' },
};

beforeEach(async () => {
  memoryKv.store.clear();
  await memoryKv.set(
    getAlloRegistrationClaimKey('reg_1'),
    { workspaceId: 'ws_1', signingSecret: SIGNING_SECRET },
    { scope: 'SERVER' },
  );
});

describe('allo webhook resolver', () => {
  it('dispatches a signed delivery to the workspace that registered it', async () => {
    const result = await resolve(buildSignedRoutePayload({ body: callReceived }));

    expect(result).toEqual({
      workspaceId: 'ws_1',
      targetLogicFunctionUniversalIdentifier:
        ALLO_WEBHOOK_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
      payload: { registrationId: 'reg_1', webhookId: 'msg_1', event: callReceived },
    });
  });

  it('reads the claim from the server scope, not the workspace one', async () => {
    memoryKv.store.clear();
    await memoryKv.set(getAlloRegistrationClaimKey('reg_1'), {
      workspaceId: 'ws_1',
      signingSecret: SIGNING_SECRET,
    });

    const result = await resolve(buildSignedRoutePayload({ body: callReceived }));

    expect(result.status).toBe(404);
  });

  it('answers 400 when the URL carries no registration id', async () => {
    const result = await resolve(
      buildSignedRoutePayload({ body: callReceived, registrationId: null }),
    );

    expect(result.status).toBe(400);
  });

  it('answers 404 for a registration nobody holds', async () => {
    const result = await resolve(
      buildSignedRoutePayload({ body: callReceived, registrationId: 'reg_gone' }),
    );

    expect(result.status).toBe(404);
  });

  it('rejects a bad signature with 401 and dispatches nothing', async () => {
    const event = buildSignedRoutePayload({ body: callReceived });
    event.headers['webhook-signature'] = 'v1,wrong';

    const result = await resolve(event);

    expect(result.status).toBe(401);
    expect(result).not.toHaveProperty('workspaceId');
  });

  it('rejects a delivery signed with another registration secret', async () => {
    const result = await resolve(
      buildSignedRoutePayload({
        body: callReceived,
        secretBytes: Buffer.alloc(32, 7),
      }),
    );

    expect(result.status).toBe(401);
  });

  it('refuses a request with no raw body rather than re-serialising it', async () => {
    const event = { ...buildSignedRoutePayload({ body: callReceived }), rawBody: undefined };

    expect((await resolve(event)).status).toBe(400);
  });

  it('verifies a base64-encoded body against the decoded bytes', async () => {
    const event = buildSignedRoutePayload({ body: callReceived });

    const result = await resolve({
      ...event,
      rawBody: Buffer.from(event.rawBody, 'utf8').toString('base64'),
      isBase64Encoded: true,
    });

    expect(result.workspaceId).toBe('ws_1');
  });

  it('rejects a signed body that is not JSON with 400', async () => {
    const result = await resolve(buildSignedRoutePayload({ body: 'not json' }));

    expect(result.status).toBe(400);
  });

  it('acknowledges a topic it does not handle without dispatching', async () => {
    const result = await resolve(
      buildSignedRoutePayload({ body: { topic: 'sms.received', data: {} } }),
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ignored: true, topic: 'sms.received' });
  });

  it('is exposed as a POST server route forwarding the signature headers', () => {
    const settings = resolverDefinition.config.serverRouteTriggerSettings;

    expect(settings?.httpMethods).toEqual(['POST']);
    expect(settings?.forwardedRequestHeaders).toEqual(
      expect.arrayContaining(['webhook-id', 'webhook-timestamp', 'webhook-signature']),
    );
  });
});
