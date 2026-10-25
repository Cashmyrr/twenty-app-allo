import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { verifyAlloSignature } from 'src/logic-functions/utils/verify-allo-signature';

const SECRET_BYTES = randomBytes(32);
const SECRET = `whsec_${SECRET_BYTES.toString('base64')}`;
const WEBHOOK_ID = 'msg_2NfDKEm9sF8xK3pQr1Zt';
const NOW = 1_773_000_000;
const RAW_BODY = JSON.stringify({
  topic: 'call.completed',
  data: { id: 'cll_1' },
});

const sign = (body: string, timestamp: number, secretBytes = SECRET_BYTES) =>
  createHmac('sha256', secretBytes)
    .update(`${WEBHOOK_ID}.${timestamp}.${body}`)
    .digest('base64');

const headersFor = (
  signature: string,
  timestamp: number = NOW,
): Record<string, string | undefined> => ({
  'webhook-id': WEBHOOK_ID,
  'webhook-timestamp': String(timestamp),
  'webhook-signature': `v1,${signature}`,
});

describe('verifyAlloSignature', () => {
  it('accepts a correctly signed payload', () => {
    expect(
      verifyAlloSignature({
        rawBody: RAW_BODY,
        headers: headersFor(sign(RAW_BODY, NOW)),
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).toEqual({ valid: true });
  });

  it('accepts headers whose casing differs', () => {
    const signature = sign(RAW_BODY, NOW);

    expect(
      verifyAlloSignature({
        rawBody: RAW_BODY,
        headers: {
          'Webhook-Id': WEBHOOK_ID,
          'Webhook-Timestamp': String(NOW),
          'Webhook-Signature': `v1,${signature}`,
        },
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).toEqual({ valid: true });
  });

  it('accepts when one of several signatures matches (secret rotation)', () => {
    const valid = sign(RAW_BODY, NOW);
    const stale = sign(RAW_BODY, NOW, randomBytes(32));

    expect(
      verifyAlloSignature({
        rawBody: RAW_BODY,
        headers: {
          ...headersFor(valid),
          'webhook-signature': `v1,${stale} v1,${valid}`,
        },
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).toEqual({ valid: true });
  });

  it('rejects a tampered body', () => {
    expect(
      verifyAlloSignature({
        rawBody: RAW_BODY.replace('cll_1', 'cll_2'),
        headers: headersFor(sign(RAW_BODY, NOW)),
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).toEqual({ valid: false, reason: 'Signature mismatch' });
  });

  it('rejects a signature made with another secret', () => {
    expect(
      verifyAlloSignature({
        rawBody: RAW_BODY,
        headers: headersFor(sign(RAW_BODY, NOW, randomBytes(32))),
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).toEqual({ valid: false, reason: 'Signature mismatch' });
  });

  it('rejects a replayed payload older than the tolerance', () => {
    const staleTimestamp = NOW - 301;

    expect(
      verifyAlloSignature({
        rawBody: RAW_BODY,
        headers: headersFor(sign(RAW_BODY, staleTimestamp), staleTimestamp),
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).toEqual({
      valid: false,
      reason: 'Webhook timestamp outside tolerance',
    });
  });

  it('accepts a payload at the edge of the tolerance', () => {
    const timestamp = NOW - 299;

    expect(
      verifyAlloSignature({
        rawBody: RAW_BODY,
        headers: headersFor(sign(RAW_BODY, timestamp), timestamp),
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).toEqual({ valid: true });
  });

  it('rejects a timestamp too far in the future', () => {
    const timestamp = NOW + 400;

    expect(
      verifyAlloSignature({
        rawBody: RAW_BODY,
        headers: headersFor(sign(RAW_BODY, timestamp), timestamp),
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).toEqual({
      valid: false,
      reason: 'Webhook timestamp outside tolerance',
    });
  });

  it.each(['webhook-id', 'webhook-timestamp', 'webhook-signature'])(
    'rejects when %s is absent',
    (header) => {
      const headers = headersFor(sign(RAW_BODY, NOW));
      delete headers[header];

      expect(
        verifyAlloSignature({
          rawBody: RAW_BODY,
          headers,
          secret: SECRET,
          nowSeconds: NOW,
        }),
      ).toEqual({
        valid: false,
        reason: 'Missing webhook signature headers',
      });
    },
  );

  it('rejects a non-numeric timestamp', () => {
    expect(
      verifyAlloSignature({
        rawBody: RAW_BODY,
        headers: {
          ...headersFor(sign(RAW_BODY, NOW)),
          'webhook-timestamp': 'not-a-number',
        },
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).toEqual({
      valid: false,
      reason: 'Malformed webhook-timestamp header',
    });
  });

  it('rejects a signature header with no v1 entry', () => {
    expect(
      verifyAlloSignature({
        rawBody: RAW_BODY,
        headers: {
          ...headersFor(sign(RAW_BODY, NOW)),
          'webhook-signature': `v2,${sign(RAW_BODY, NOW)}`,
        },
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).toEqual({
      valid: false,
      reason: 'No v1 signature in webhook-signature',
    });
  });

  it('rejects an empty signing secret', () => {
    expect(
      verifyAlloSignature({
        rawBody: RAW_BODY,
        headers: headersFor(sign(RAW_BODY, NOW)),
        secret: 'whsec_',
        nowSeconds: NOW,
      }),
    ).toEqual({
      valid: false,
      reason: 'Empty or malformed signing secret',
    });
  });
});
