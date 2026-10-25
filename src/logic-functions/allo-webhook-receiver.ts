import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { enqueueJobs, kv, Response } from 'twenty-sdk/logic-function';

import { ALLO_WEBHOOK_ROUTE_PATH } from 'src/constants/allo-api';
import {
  ALLO_REGISTRATION_QUERY_PARAMETER,
  ALLO_WEBHOOK_PROBE_KV_KEY,
  ALLO_WEBHOOK_PROBE_QUERY_PARAMETER,
} from 'src/constants/allo-registration';
import {
  ALLO_WEBHOOK_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  ALLO_WEBHOOK_RECEIVER_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';
import {
  type AlloVerifiedDeliveryPayload,
  type AlloWebhookEvent,
  isAlloCallTopic,
  isAlloTagTopic,
} from 'src/types/allo-webhook.type';
import { readAlloRegistration } from 'src/logic-functions/utils/allo-registration';
import { verifyAlloSignature } from 'src/logic-functions/utils/verify-allo-signature';

/**
 * The SDK's `Response`, not the browser one. The runtime recognises an HTTP
 * response by its `__twentyHttpResponse` marker: a global `Response` serialises
 * to `{}` and the caller gets an empty body.
 */
const jsonResponse = (body: unknown, status: number): Response =>
  new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** The raw bytes Allo signed. Re-serialising the parsed body breaks the HMAC. */
const readRawBody = (event: RoutePayload): string | null => {
  if (typeof event.rawBody !== 'string' || event.rawBody.length === 0) {
    return null;
  }

  return event.isBase64Encoded
    ? Buffer.from(event.rawBody, 'base64').toString('utf8')
    : event.rawBody;
};

const readHeader = (event: RoutePayload, name: string): string | undefined => {
  const value = Object.entries(event.headers ?? {}).find(
    ([key]) => key.toLowerCase() === name,
  )?.[1];

  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

/**
 * Connect posts a one-time nonce here before giving the URL to Allo, in the
 * query, a `webhook-id` header and the body. Echoing it proves the URL reaches
 * this app in this workspace, and that the raw body and signature headers make
 * it through, which the signature check depends on.
 */
const answerProbe = async (
  event: RoutePayload,
  nonce: string,
): Promise<Response> => {
  const expected = await kv.get<string>(ALLO_WEBHOOK_PROBE_KV_KEY);

  if (expected !== nonce) {
    return jsonResponse({ error: 'Unknown probe' }, 404);
  }

  const delivered =
    readHeader(event, 'webhook-id') === nonce &&
    (readRawBody(event) ?? '').includes(nonce);

  return delivered
    ? jsonResponse({ probe: 'ok' }, 200)
    : jsonResponse({ error: 'Probe headers or body did not arrive' }, 422);
};

/**
 * Public entry point for Allo deliveries. Twenty serves it on the workspace's
 * own domain and resolves the workspace from the host, so it runs inside the
 * workspace that registered the webhook: it checks the signature with that
 * workspace's secret and answers 401 before anything is queued.
 */
export const alloWebhookReceiverHandler = async (
  event: RoutePayload,
): Promise<Response> => {
  const probe =
    event.queryStringParameters?.[ALLO_WEBHOOK_PROBE_QUERY_PARAMETER];

  if (typeof probe === 'string' && probe.length > 0) {
    return answerProbe(event, probe);
  }

  const registrationId =
    event.queryStringParameters?.[ALLO_REGISTRATION_QUERY_PARAMETER];

  if (typeof registrationId !== 'string' || registrationId.length === 0) {
    return jsonResponse({ error: 'Missing registrationId' }, 400);
  }

  const registration = await readAlloRegistration();

  if (!registration || registration.registrationId !== registrationId) {
    // A disconnected workspace, a replaced webhook, or one created by hand.
    // Allo keeps retrying a 404 and eventually disables the endpoint, which is
    // the right outcome for a URL nobody owns anymore.
    return jsonResponse({ error: 'Unknown Allo registration' }, 404);
  }

  if (!registration.signingSecret) {
    // Ours, but unverifiable: answer 500 so Allo keeps the delivery and
    // retries it until someone connects again.
    console.error(
      '[allo] no signing secret is stored for this registration; connect Allo again from the settings tab',
    );

    return jsonResponse({ error: 'Registration has no signing secret' }, 500);
  }

  const rawBody = readRawBody(event);

  // Fail closed: without the exact signed bytes the signature cannot be checked.
  if (rawBody === null) {
    console.error(
      '[allo] rawBody missing; the runtime did not forward the raw request body',
    );

    return jsonResponse({ error: 'Missing raw request body' }, 400);
  }

  const signatureHeaders = {
    'webhook-id': readHeader(event, 'webhook-id'),
    'webhook-timestamp': readHeader(event, 'webhook-timestamp'),
    'webhook-signature': readHeader(event, 'webhook-signature'),
  };

  const signature = verifyAlloSignature({
    rawBody,
    headers: signatureHeaders,
    secret: registration.signingSecret,
  });

  if (!signature.valid) {
    return jsonResponse({ error: signature.reason }, 401);
  }

  let parsed: AlloWebhookEvent;

  try {
    parsed = JSON.parse(rawBody) as AlloWebhookEvent;
  } catch {
    return jsonResponse({ error: 'Body is not valid JSON' }, 400);
  }

  // Acknowledge topics the app does not handle without spending a job on them,
  // otherwise Allo retries them.
  if (!isAlloCallTopic(parsed.topic) && !isAlloTagTopic(parsed.topic)) {
    return jsonResponse({ ignored: true, topic: parsed.topic ?? null }, 200);
  }

  const delivery: AlloVerifiedDeliveryPayload = {
    kind: 'verified-delivery',
    registrationId,
    webhookId: signatureHeaders['webhook-id'] ?? null,
    event: parsed,
  };

  try {
    await enqueueJobs({
      logicFunctionUniversalIdentifier:
        ALLO_WEBHOOK_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
      payloads: [delivery],
    });
  } catch (error) {
    // Not queued, so not acknowledged: Allo retries the delivery.
    console.error('[allo] could not queue a verified delivery', error);

    return jsonResponse({ error: 'Could not queue the delivery' }, 500);
  }

  return jsonResponse({ queued: true }, 200);
};

export default defineLogicFunction({
  universalIdentifier: ALLO_WEBHOOK_RECEIVER_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'allo-webhook-receiver',
  description:
    'Public endpoint for Allo webhooks: checks the signature with this workspace secret, then queues the event.',
  timeoutSeconds: 15,
  handler: alloWebhookReceiverHandler,
  // POST https://<workspace>.<public function domain>/allo/webhook?registrationId=...
  httpRouteTriggerSettings: {
    path: ALLO_WEBHOOK_ROUTE_PATH,
    httpMethod: 'POST',
    isAuthRequired: false,
    // The /s/ form only passes listed headers to the handler; the public
    // function domain passes them all.
    forwardedRequestHeaders: [
      'webhook-id',
      'webhook-timestamp',
      'webhook-signature',
      'content-type',
    ],
  },
});
