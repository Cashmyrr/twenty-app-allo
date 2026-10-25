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
        notFound: 3,
      }),
    ).toBe(
      'Power Dialer: 180 queued, 40 without a number, 8 refused by Allo, 3 not found.',
    );
  });
});
