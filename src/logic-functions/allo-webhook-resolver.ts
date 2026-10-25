import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import {
  Response,
  type ServerRouteResolverResult,
} from 'twenty-sdk/logic-function';

import { ALLO_REGISTRATION_QUERY_PARAMETER } from 'src/constants/allo-registration';
import {
  ALLO_WEBHOOK_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  ALLO_WEBHOOK_RESOLVER_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';
import {
  type AlloWebhookDispatchPayload,
  type AlloWebhookEvent,
  isAlloCallTopic,
  isAlloTagTopic,
} from 'src/types/allo-webhook.type';
import { readAlloRegistrationClaim } from 'src/logic-functions/utils/allo-registration';
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

/**
 * Public entry point for every Allo delivery, shared by all workspaces of the
 * server. It runs in the app's owner workspace, so it writes nothing itself: it
 * authenticates the delivery and dispatches it to `allo-webhook` in the workspace
 * that registered it.
 *
 * The signature is checked here rather than in the target, so unsigned traffic
 * gets a synchronous 401 and never reaches the job queue. Once dispatched, Allo
 * receives a 200 `{ queued: true }`; retries of a failed write are handled by
 * Twenty's queue, not by Allo.
 */
export const alloWebhookResolverHandler = async (
  event: RoutePayload,
): Promise<ServerRouteResolverResult> => {
  const registrationId =
    event.queryStringParameters?.[ALLO_REGISTRATION_QUERY_PARAMETER];

  if (typeof registrationId !== 'string' || registrationId.length === 0) {
    return jsonResponse({ error: 'Missing registrationId' }, 400);
  }

  const claim = await readAlloRegistrationClaim(registrationId);

  if (!claim) {
    // A disconnected workspace, or a webhook created by hand. Allo keeps
    // retrying a 404 and eventually disables the endpoint, which is the right
    // outcome for a URL nobody owns anymore.
    return jsonResponse({ error: 'Unknown Allo registration' }, 404);
  }

  const rawBody = readRawBody(event);

  // Fail closed: without the exact signed bytes the signature cannot be checked.
  if (rawBody === null) {
    console.error(
      '[allo] rawBody missing; the runtime did not forward the raw request body',
    );

    return jsonResponse({ error: 'Missing raw request body' }, 400);
  }

  const signature = verifyAlloSignature({
    rawBody,
    headers: event.headers,
    secret: claim.signingSecret,
  });

  if (!signature.valid) {
    console.warn(`[allo] rejected webhook: ${signature.reason}`);

    return jsonResponse({ error: 'Invalid webhook signature' }, 401);
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

  const webhookId = Object.entries(event.headers ?? {}).find(
    ([name]) => name.toLowerCase() === 'webhook-id',
  )?.[1];

  const payload: AlloWebhookDispatchPayload = {
    registrationId,
    webhookId: typeof webhookId === 'string' ? webhookId : null,
    event: parsed,
  };

  return {
    workspaceId: claim.workspaceId,
    targetLogicFunctionUniversalIdentifier:
      ALLO_WEBHOOK_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
    payload,
  };
};

export default defineLogicFunction({
  universalIdentifier: ALLO_WEBHOOK_RESOLVER_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'allo-webhook-resolver',
  description:
    'Public endpoint for Allo webhooks: verifies the signature and routes each delivery to the workspace that registered it.',
  timeoutSeconds: 15,
  handler: alloWebhookResolverHandler,
  // POST <server>/webhooks/server/<this universalIdentifier>?registrationId=...
  serverRouteTriggerSettings: {
    httpMethods: ['POST'],
    // Without this the signature headers never reach the handler.
    forwardedRequestHeaders: [
      'webhook-id',
      'webhook-timestamp',
      'webhook-signature',
      'content-type',
    ],
  },
});
