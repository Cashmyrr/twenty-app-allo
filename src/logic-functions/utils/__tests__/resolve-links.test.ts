import { describe, expect, it, vi } from 'vitest';

import {
  buildPhoneCandidates,
  escapeIlikePattern,
  readCompanyPhoneField,
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

describe('readCompanyPhoneField', () => {
  it('is off when the variable is unset or blank', () => {
    expect(readCompanyPhoneField(undefined)).toBeNull();
    expect(readCompanyPhoneField('  ')).toBeNull();
  });

  it('accepts a field name and refuses anything else', () => {
    expect(readCompanyPhoneField(' telephone ')).toBe('telephone');
    expect(readCompanyPhoneField('phones.primaryPhoneNumber')).toBeNull();
  });
});

describe('resolveLinks: company phone', () => {
  type Company = { id: string; callingCode: string; number: string };

  // A workspace with no matching person, where companies keep their phone in a
  // custom `telephone` field the way Twenty stores phones.
  const workspace = (
    companies: Company[],
    people: Record<string, unknown>[] = [],
  ) =>
    vi.fn(async (operation: Record<string, any>) => {
      if ('companies' in operation) {
        const { filter } = operation.companies.__args;
        const [sameNumber, sameCountry] = filter.and;
        const wanted: string[] =
          sameNumber.telephone.primaryPhoneNumber.in;
        const callingCodes = sameCountry.or.map(
          (part: any) => part.telephone.primaryPhoneCallingCode.eq ?? null,
        );

        return {
          companies: {
            edges: companies
              .filter(
                (company) =>
                  wanted.includes(company.number) &&
                  callingCodes.includes(company.callingCode),
              )
              .slice(0, operation.companies.__args.first)
              .map((company) => ({ node: { id: company.id } })),
          },
        };
      }

      if ('people' in operation) {
        return { people: { edges: people.map((node) => ({ node })) } };
      }

      return { workspaceMembers: { edges: [] } };
    });

  const resolve = (
    query: ReturnType<typeof workspace>,
    companyPhoneField: string | null = 'telephone',
  ) =>
    resolveLinks({ query } as never, {
      userEmail: null,
      alloPerson: null,
      contactNumber: '+33232877889',
      companyPhoneField,
    });

  it('links a call to a switchboard to the company holding the number', async () => {
    const query = workspace([
      { id: 'co_1', callingCode: '+33', number: '232877889' },
    ]);

    expect(await resolve(query)).toMatchObject({
      personId: null,
      companyId: 'co_1',
    });
  });

  it('links nothing when two companies share the number', async () => {
    const query = workspace([
      { id: 'co_1', callingCode: '+33', number: '232877889' },
      { id: 'co_2', callingCode: '+33', number: '232877889' },
    ]);

    expect((await resolve(query)).companyId).toBeNull();
  });

  it('ignores the same national number in another country', async () => {
    const query = workspace([
      { id: 'co_be', callingCode: '+32', number: '232877889' },
    ]);

    expect((await resolve(query)).companyId).toBeNull();
  });

  it("keeps the matched person's company", async () => {
    const query = workspace(
      [{ id: 'co_switchboard', callingCode: '+33', number: '232877889' }],
      [{ id: 'per_1', company: { id: 'co_person' } }],
    );

    expect(await resolve(query)).toMatchObject({
      personId: 'per_1',
      companyId: 'co_person',
    });
    expect(
      query.mock.calls.some(([operation]) => 'companies' in operation),
    ).toBe(false);
  });

  it('does not look at companies when no field is set', async () => {
    const query = workspace([
      { id: 'co_1', callingCode: '+33', number: '232877889' },
    ]);

    expect((await resolve(query, null)).companyId).toBeNull();
    expect(
      query.mock.calls.some(([operation]) => 'companies' in operation),
    ).toBe(false);
  });

  it('keeps the call when the company lookup fails', async () => {
    const query = vi.fn(async (operation: Record<string, any>) => {
      if ('companies' in operation) {
        throw new Error('Field telephone does not exist');
      }

      return { people: { edges: [] }, workspaceMembers: { edges: [] } };
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect((await resolve(query as never)).companyId).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
