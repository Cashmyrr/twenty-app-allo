import { createHmac, randomBytes } from 'node:crypto';

export const SIGNING_SECRET_BYTES = randomBytes(32);
export const SIGNING_SECRET = `whsec_${SIGNING_SECRET_BYTES.toString('base64')}`;

/** Builds the route payload Twenty hands a server route for one signed delivery. */
export const buildSignedRoutePayload = ({
  body,
  registrationId = 'reg_1',
  webhookId = 'msg_1',
  rawBody = typeof body === 'string' ? body : JSON.stringify(body),
  secretBytes = SIGNING_SECRET_BYTES,
}: {
  body: unknown;
  registrationId?: string | null;
  webhookId?: string;
  rawBody?: string;
  secretBytes?: Buffer;
}) => {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', secretBytes)
    .update(`${webhookId}.${timestamp}.${rawBody}`)
    .digest('base64');

  return {
    headers: {
      'webhook-id': webhookId,
      'webhook-timestamp': String(timestamp),
      'webhook-signature': `v1,${signature}`,
      'content-type': 'application/json',
    } as Record<string, string | undefined>,
    queryStringParameters:
      registrationId === null ? {} : { registrationId },
    pathParameters: {},
    body: typeof body === 'string' ? null : body,
    rawBody,
    isBase64Encoded: false,
    requestContext: { http: { method: 'POST', path: '/webhooks/server/x' } },
    userWorkspaceId: null,
  };
};
