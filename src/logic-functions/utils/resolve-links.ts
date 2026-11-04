import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { type CoreApiClient } from 'twenty-client-sdk/core';

import { type AlloPerson } from 'src/types/allo-webhook.type';

export type ResolvedLinks = {
  memberId: string | null;
  personId: string | null;
  companyId: string | null;
};

const nonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

/**
 * `ilike` gives `_` and `%` a wildcard meaning, and `_` is common in emails:
 * unescaped, `j_doe@acme.com` also matches `jxdoe@acme.com`.
 */
export const escapeIlikePattern = (value: string): string =>
  value.replace(/[\\%_]/g, '\\$&');

/**
 * The Twenty member who handled the call, matched on the Allo user's email.
 * `userEmail` on workspaceMember is the login email, which is what Allo reports.
 */
export const resolveMemberId = async (
  client: CoreApiClient,
  userEmail: string | null,
): Promise<string | null> => {
  const email = nonEmptyString(userEmail);

  if (!email) {
    return null;
  }

  const { workspaceMembers } = await client.query({
    workspaceMembers: {
      __args: {
        filter: { userEmail: { ilike: escapeIlikePattern(email) } },
        first: 1,
      },
      edges: { node: { id: true } },
    },
  });

  return workspaceMembers?.edges?.[0]?.node?.id ?? null;
};

const findPersonByEmail = async (
  client: CoreApiClient,
  email: string,
): Promise<{ id: string; companyId: string | null } | null> => {
  const { people } = await client.query({
    people: {
      __args: {
        filter: { emails: { primaryEmail: { ilike: escapeIlikePattern(email) } } },
        first: 1,
      },
      edges: { node: { id: true, company: { id: true } } },
    },
  });

  const person = people?.edges?.[0]?.node;

  return person?.id
    ? { id: person.id, companyId: person.company?.id ?? null }
    : null;
};

const findPersonByPhone = async (
  client: CoreApiClient,
  candidates: string[],
): Promise<{ id: string; companyId: string | null } | null> => {
  for (const candidate of candidates) {
    const { people } = await client.query({
      people: {
        __args: {
          filter: { phones: { primaryPhoneNumber: { eq: candidate } } },
          first: 1,
        },
        edges: { node: { id: true, company: { id: true } } },
      },
    });

    const person = people?.edges?.[0]?.node;

    if (person?.id) {
      return { id: person.id, companyId: person.company?.id ?? null };
    }
  }

  // Last resort: a suffix match catches records stored with a country prefix or
  // stray formatting. Narrow enough with 8+ digits to not collide in practice.
  const longest = candidates
    .slice()
    .sort((a, b) => b.length - a.length)
    .find((candidate) => candidate.length >= 8);

  if (!longest) {
    return null;
  }

  const { people } = await client.query({
    people: {
      __args: {
        filter: {
          phones: {
            primaryPhoneNumber: { ilike: `%${escapeIlikePattern(longest)}` },
          },
        },
        first: 2,
      },
      edges: { node: { id: true, company: { id: true } } },
    },
  });

  const matches = people?.edges ?? [];

  // Ambiguous suffix match: better no link than the wrong one.
  if (matches.length !== 1) {
    return null;
  }

  const person = matches[0]?.node;

  return person?.id
    ? { id: person.id, companyId: person.company?.id ?? null }
    : null;
};

/**
 * Twenty stores `primaryPhoneNumber` as the national number, with the calling
 * code held separately, so an E.164 number never matches as-is. Try the
 * national number first, then the raw variants.
 */
export const buildPhoneCandidates = (
  contactNumber: string | null,
): string[] => {
  const number = nonEmptyString(contactNumber);

  if (!number) {
    return [];
  }

  const candidates: string[] = [];
  const parsed = parsePhoneNumberFromString(number);

  if (parsed?.nationalNumber) {
    candidates.push(parsed.nationalNumber);
  }

  candidates.push(number.replace(/^\+/, ''), number);

  return [...new Set(candidates.filter((candidate) => candidate.length > 0))];
};

/** `+33` for a French number, or null when the number cannot be parsed. */
const callingCodeOf = (contactNumber: string | null): string | null => {
  const number = nonEmptyString(contactNumber);
  const parsed = number ? parsePhoneNumberFromString(number) : undefined;

  return parsed?.countryCallingCode ? `+${parsed.countryCallingCode}` : null;
};

/**
 * The person on the other end of the call. Email is the reliable signal, so it
 * is tried first; the phone number is the fallback. Both are best-effort: a
 * miss leaves the link empty and the call still lands with its raw fields.
 */
export const resolvePersonLink = async (
  client: CoreApiClient,
  {
    alloPerson,
    contactNumber,
  }: { alloPerson: AlloPerson | null; contactNumber: string | null },
): Promise<{ personId: string | null; companyId: string | null }> => {
  const emails = [
    alloPerson?.email,
    ...(Array.isArray(alloPerson?.emails) ? alloPerson.emails : []),
  ]
    .map((email) => nonEmptyString(email))
    .filter((email): email is string => email !== null);

  for (const email of [...new Set(emails)]) {
    const match = await findPersonByEmail(client, email);

    if (match) {
      return { personId: match.id, companyId: match.companyId };
    }
  }

  // Allo's own contact record may hold numbers the call payload does not.
  const phoneCandidates = [
    ...buildPhoneCandidates(contactNumber),
    ...(Array.isArray(alloPerson?.numbers) ? alloPerson.numbers : []).flatMap(
      (number) => buildPhoneCandidates(nonEmptyString(number)),
    ),
  ];

  const uniqueCandidates = [...new Set(phoneCandidates)];

  if (uniqueCandidates.length === 0) {
    return { personId: null, companyId: null };
  }

  const match = await findPersonByPhone(client, uniqueCandidates);

  return match
    ? { personId: match.id, companyId: match.companyId }
    : { personId: null, companyId: null };
};

/** A field name as Twenty allows it, so a typo cannot reach the query. */
const FIELD_NAME_PATTERN = /^[a-z][a-zA-Z0-9]*$/;

/**
 * The company phone field set in the app's variables, or null when unset.
 * Twenty's company has no phone field, so this is opt-in.
 */
export const readCompanyPhoneField = (value: unknown): string | null => {
  const name = nonEmptyString(value);

  if (!name) {
    return null;
  }

  if (!FIELD_NAME_PATTERN.test(name)) {
    console.warn(
      `[allo] ignoring company phone field "${name}": not a valid field name`,
    );

    return null;
  }

  return name;
};

/**
 * The company whose phone is the number called, for a call to a switchboard
 * that matches no person. Linked only when exactly one company holds the
 * number: a number shared by two companies links neither.
 */
export const findCompanyByPhone = async (
  client: CoreApiClient,
  {
    fieldName,
    contactNumber,
  }: { fieldName: string; contactNumber: string | null },
): Promise<string | null> => {
  const candidates = buildPhoneCandidates(contactNumber);

  if (candidates.length === 0) {
    return null;
  }

  const callingCode = callingCodeOf(contactNumber);
  const sameNumber = { [fieldName]: { primaryPhoneNumber: { in: candidates } } };

  // The national number alone repeats across countries, so the calling code
  // must agree when the company has one.
  const filter = callingCode
    ? {
        and: [
          sameNumber,
          {
            or: [
              { [fieldName]: { primaryPhoneCallingCode: { eq: callingCode } } },
              { [fieldName]: { primaryPhoneCallingCode: { is: 'NULL' } } },
              { [fieldName]: { primaryPhoneCallingCode: { eq: '' } } },
            ],
          },
        ],
      }
    : sameNumber;

  // The field is named at runtime, so the generated client cannot type the
  // filter. Only `id` is selected, which every client knows.
  const { companies } = await client.query({
    companies: {
      __args: { filter: filter as never, first: 2 },
      edges: { node: { id: true } },
    },
  });

  const matches = companies?.edges ?? [];

  return matches.length === 1 ? (matches[0]?.node?.id ?? null) : null;
};

/**
 * Resolves all three links in one go. Link resolution must never fail the
 * webhook, so each lookup is isolated: a broken one costs its own link only.
 */
export const resolveLinks = async (
  client: CoreApiClient,
  {
    userEmail,
    alloPerson,
    contactNumber,
    companyPhoneField = null,
  }: {
    userEmail: string | null;
    alloPerson: AlloPerson | null;
    contactNumber: string | null;
    /** A PHONES field on company, for calls to a company's own number. */
    companyPhoneField?: string | null;
  },
): Promise<ResolvedLinks> => {
  const [memberResult, personResult] = await Promise.allSettled([
    resolveMemberId(client, userEmail),
    resolvePersonLink(client, { alloPerson, contactNumber }),
  ]);

  if (memberResult.status === 'rejected') {
    console.warn('[allo] member lookup failed', memberResult.reason);
  }

  if (personResult.status === 'rejected') {
    console.warn('[allo] person lookup failed', personResult.reason);
  }

  const person =
    personResult.status === 'fulfilled'
      ? personResult.value
      : { personId: null, companyId: null };

  let companyId = person.companyId;

  // A person's company wins. Otherwise the number may be the company's own,
  // typically its switchboard.
  if (!companyId && companyPhoneField) {
    try {
      companyId = await findCompanyByPhone(client, {
        fieldName: companyPhoneField,
        contactNumber,
      });
    } catch (error) {
      console.warn('[allo] company phone lookup failed', error);
    }
  }

  return {
    memberId: memberResult.status === 'fulfilled' ? memberResult.value : null,
    personId: person.personId,
    companyId,
  };
};
