import { createHmac, timingSafeEqual } from 'node:crypto';

// Allo signs webhooks the Standard Webhooks way:
//   base64(HMAC-SHA256(secretBytes, "{webhook-id}.{webhook-timestamp}.{rawBody}"))
// where secretBytes is the base64-decoded part after the `whsec_` prefix.
// https://help.withallo.com/en/v2/api-reference/webhooks/verifying-signatures
const SIGNATURE_TOLERANCE_SECONDS = 300;

export type VerifyAlloSignatureInput = {
  rawBody: string;
  headers: Record<string, string | undefined>;
  secret: string;
  /** Injected in tests; defaults to now. */
  nowSeconds?: number;
};

export type VerifyAlloSignatureResult =
  | { valid: true }
  | { valid: false; reason: string };

const readHeader = (
  headers: Record<string, string | undefined>,
  name: string,
): string | undefined => {
  // Header casing is not guaranteed through the gateway, so match case-insensitively.
  const match = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name,
  );

  return match?.[1] ?? undefined;
};

const equalsInConstantTime = (a: string, b: string): boolean => {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);

  // timingSafeEqual throws on length mismatch, and the length itself is not secret.
  return (
    bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB)
  );
};

export const verifyAlloSignature = ({
  rawBody,
  headers,
  secret,
  nowSeconds,
}: VerifyAlloSignatureInput): VerifyAlloSignatureResult => {
  const webhookId = readHeader(headers, 'webhook-id');
  const webhookTimestamp = readHeader(headers, 'webhook-timestamp');
  const webhookSignature = readHeader(headers, 'webhook-signature');

  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    return { valid: false, reason: 'Missing webhook signature headers' };
  }

  const timestamp = Number(webhookTimestamp);

  if (!Number.isFinite(timestamp)) {
    return { valid: false, reason: 'Malformed webhook-timestamp header' };
  }

  const now = nowSeconds ?? Math.floor(Date.now() / 1000);

  if (Math.abs(now - timestamp) > SIGNATURE_TOLERANCE_SECONDS) {
    return { valid: false, reason: 'Webhook timestamp outside tolerance' };
  }

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');

  if (secretBytes.length === 0) {
    return { valid: false, reason: 'Empty or malformed signing secret' };
  }

  const expected = createHmac('sha256', secretBytes)
    .update(`${webhookId}.${webhookTimestamp}.${rawBody}`)
    .digest('base64');

  // The header can carry several space-separated `v1,<signature>` pairs during
  // a secret rotation; any one of them matching is enough.
  const providedSignatures = webhookSignature
    .split(' ')
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith('v1,'))
    .map((entry) => entry.slice('v1,'.length));

  if (providedSignatures.length === 0) {
    return { valid: false, reason: 'No v1 signature in webhook-signature' };
  }

  const matches = providedSignatures.some((signature) =>
    equalsInConstantTime(signature, expected),
  );

  return matches ? { valid: true } : { valid: false, reason: 'Signature mismatch' };
};
