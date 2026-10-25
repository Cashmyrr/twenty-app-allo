import { describe, expect, it } from 'vitest';

import { formatPushResult } from 'src/front-components/push-to-dialer';

describe('formatPushResult', () => {
  it('reports only what was queued when nothing was dropped', () => {
    expect(formatPushResult({ added: 12 })).toBe('Power Dialer: 12 queued.');
  });

  // A silent "done" hides who will not be called.
  it('reports every reason a person was dropped', () => {
    expect(
      formatPushResult({
        added: 180,
        withoutNumber: 40,
        skippedByAllo: 8,
        skippedReasons: { INVALID_PHONE_NUMBER: 6, ALREADY_IN_QUEUE: 2 },
        notFound: 3,
      }),
    ).toBe(
      'Power Dialer: 180 queued, 40 without a number, 6 with an invalid number, 2 skipped by Allo (ALREADY_IN_QUEUE), 3 not found.',
    );
  });

  it('still reports skipped numbers when Allo gives no reason', () => {
    expect(formatPushResult({ added: 0, skippedByAllo: 1 })).toBe(
      'Power Dialer: 0 queued, 1 skipped by Allo.',
    );
  });
});
