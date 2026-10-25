import { type CoreApiClient } from 'twenty-client-sdk/core';

/** Twenty serves at most this many records per page. */
const PAGE_SIZE = 100;

export type SelectedPerson = {
  id: string;
  name?: { firstName?: string | null; lastName?: string | null } | null;
  phones?: {
    primaryPhoneNumber?: string | null;
    primaryPhoneCallingCode?: string | null;
  } | null;
  emails?: { primaryEmail?: string | null } | null;
  jobTitle?: string | null;
  company?: {
    name?: string | null;
    domainName?: { primaryLinkUrl?: string | null } | null;
  } | null;
};

export type FetchSelectedPeopleResult =
  | { ok: true; people: SelectedPerson[] }
  | { ok: false; reason: 'too-many'; limit: number };

const PERSON_SELECTION = {
  id: true,
  name: { firstName: true, lastName: true },
  phones: { primaryPhoneNumber: true, primaryPhoneCallingCode: true },
  emails: { primaryEmail: true },
  jobTitle: true,
  company: { name: true, domainName: { primaryLinkUrl: true } },
} as const;

const fetchPage = async (
  client: CoreApiClient,
  filter: Record<string, unknown>,
  after: string | null,
): Promise<{ people: SelectedPerson[]; endCursor: string | null }> => {
  // Annotated so the cursor's type does not flow back into the query's
  // inference, which TypeScript sees as circular.
  const args: { filter: Record<string, unknown>; first: number; after?: string } =
    { filter, first: PAGE_SIZE };

  if (after !== null) {
    args.after = after;
  }

  const { people } = await client.query({
    people: {
      __args: args,
      pageInfo: { hasNextPage: true, endCursor: true },
      edges: { node: PERSON_SELECTION },
    },
  });

  const nodes = (people?.edges ?? [])
    .map((edge: { node?: SelectedPerson | null } | null) => edge?.node)
    .filter((node: SelectedPerson | null | undefined): node is SelectedPerson =>
      typeof node?.id === 'string',
    );

  return {
    people: nodes,
    endCursor: people?.pageInfo?.hasNextPage
      ? (people.pageInfo.endCursor ?? null)
      : null,
  };
};

/**
 * Reads the people a member selected, either as explicit ids or, under "Select
 * all", as the view's filter. Pages through Twenty's 100-record cap: a single
 * `first: 500` query silently returns 100.
 *
 * Refuses rather than truncates past `limit`: queueing the first N of a larger
 * list without saying so is how the wrong people get called.
 */
export const fetchSelectedPeople = async (
  client: CoreApiClient,
  {
    personIds,
    filter,
    limit,
  }: {
    personIds: string[];
    filter: Record<string, unknown> | null;
    limit: number;
  },
): Promise<FetchSelectedPeopleResult> => {
  if (personIds.length > limit) {
    return { ok: false, reason: 'too-many', limit };
  }

  const people: SelectedPerson[] = [];

  if (personIds.length > 0) {
    for (let index = 0; index < personIds.length; index += PAGE_SIZE) {
      const chunk = personIds.slice(index, index + PAGE_SIZE);
      const page = await fetchPage(client, { id: { in: chunk } }, null);

      people.push(...page.people);
    }

    return { ok: true, people };
  }

  if (filter === null) {
    return { ok: true, people };
  }

  let after: string | null = null;

  do {
    const page = await fetchPage(client, filter, after);

    people.push(...page.people);

    if (people.length > limit) {
      return { ok: false, reason: 'too-many', limit };
    }

    after = page.endCursor;
  } while (after !== null);

  return { ok: true, people };
};
