import { describe, expect, it } from 'vitest';

import {
  describeConnectionStatus,
  listCompanyPhoneFields,
} from 'src/front-components/allo-settings';

describe('describeConnectionStatus', () => {
  it.each([
    [{ state: 'missing-api-key' as const }, /Enter an Allo API key/],
    [{ state: 'disconnected' as const }, /not syncing/],
    [{ state: 'api-key-changed' as const }, /Connect again/],
    [{ state: 'webhook-missing' as const, webhookUrl: 'u' }, /re-create/],
    [{ state: 'unknown' as const, error: 'Allo is down' }, /Allo is down/],
  ])('tells the admin what to do for %o', (status, expected) => {
    expect(describeConnectionStatus(status)).toMatch(expected);
  });

  it('says it is still checking before the first answer', () => {
    expect(describeConnectionStatus(null)).toMatch(/Checking/);
  });
});

describe('listCompanyPhoneFields', () => {
  it('offers only the active Phones fields, by label', () => {
    expect(
      listCompanyPhoneFields([
        { name: 'name', label: 'Name', type: 'TEXT', isActive: true },
        { name: 'telephone', label: 'Téléphone', type: 'PHONES', isActive: true },
        { name: 'fax', label: 'Fax', type: 'PHONES', isActive: false },
        { name: 'hotline', label: 'Hotline', type: 'PHONES' },
      ]),
    ).toEqual([
      { name: 'hotline', label: 'Hotline' },
      { name: 'telephone', label: 'Téléphone' },
    ]);
  });
});
