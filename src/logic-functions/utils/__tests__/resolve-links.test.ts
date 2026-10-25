import { describe, expect, it, vi } from 'vitest';

import {
  buildPhoneCandidates,
  escapeIlikePattern,
  resolveLinks,
} from 'src/logic-functions/utils/resolve-links';

describe('escapeIlikePattern', () => {
  it('escapes the characters ilike treats as wildcards', () => {
    expect(escapeIlikePattern('j_doe%1\\x@acme.com')).toBe(
      'j\\_doe\\%1\\\\x@acme.com',
    );
  });

  it('leaves an ordinary address alone', () => {
    expect(escapeIlikePattern('marie.dupont@acme.com')).toBe(
      'marie.dupont@acme.com',
    );
  });
});

describe('buildPhoneCandidates', () => {
  // Twenty stores the national number apart from the calling code.
  it('tries the national number before the raw forms', () => {
    expect(buildPhoneCandidates('+33612345678')).toEqual([
      '612345678',
      '33612345678',
      '+33612345678',
    ]);
  });

  it('returns nothing for an empty number', () => {
    expect(buildPhoneCandidates(null)).toEqual([]);
  });
});

describe('resolveLinks', () => {
  it('matches the member on an escaped email', async () => {
    const query = vi.fn(async (operation: Record<string, any>) =>
      'workspaceMembers' in operation
        ? { workspaceMembers: { edges: [{ node: { id: 'wm_1' } }] } }
        : { people: { edges: [] } },
    );

    const links = await resolveLinks({ query } as never, {
      userEmail: 'j_doe@acme.com',
      alloPerson: null,
      contactNumber: null,
    });

    expect(links.memberId).toBe('wm_1');
    expect(query.mock.calls[0][0].workspaceMembers.__args.filter).toEqual({
      userEmail: { ilike: 'j\\_doe@acme.com' },
    });
  });

  it('refuses an ambiguous phone suffix match', async () => {
    const query = vi.fn(async (operation: Record<string, any>) => {
      const filter = operation.people?.__args.filter.phones.primaryPhoneNumber;

      return filter?.ilike
        ? { people: { edges: [{ node: { id: 'a' } }, { node: { id: 'b' } }] } }
        : { people: { edges: [] } };
    });

    const links = await resolveLinks({ query } as never, {
      userEmail: null,
      alloPerson: null,
      contactNumber: '+33612345678',
    });

    expect(links.personId).toBeNull();
  });
});
