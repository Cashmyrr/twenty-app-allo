import { type CoreApiClient } from 'twenty-client-sdk/core';

export type SyncLastAlloCallInput = {
  personId: string | null | undefined;
  startedAt: string | null | undefined;
};

export type SyncLastAlloCallResult =
  | { outcome: 'written'; personId: string; startedAt: string }
  | { outcome: 'no-person' }
  | { outcome: 'no-date' }
  | { outcome: 'person-not-found'; personId: string }
  | { outcome: 'older'; personId: string };

/**
 * Keeps `person.lastAlloCallAt` on the newest call date seen for that person.
 *
 * Idempotent by construction: a replayed event, or an event arriving out of
 * order, cannot move the date backwards. That is what makes this safe to call
 * from several triggers, and safe to re-run as a backfill.
 */
export const syncLastAlloCall = async (
  client: CoreApiClient,
  { personId, startedAt }: SyncLastAlloCallInput,
): Promise<SyncLastAlloCallResult> => {
  if (typeof personId !== 'string' || personId.length === 0) {
    return { outcome: 'no-person' };
  }

  if (typeof startedAt !== 'string' || startedAt.length === 0) {
    return { outcome: 'no-date' };
  }

  const { people } = await client.query({
    people: {
      __args: { filter: { id: { eq: personId } }, first: 1 },
      edges: { node: { id: true, lastAlloCallAt: true } },
    },
  });

  const person = people?.edges?.[0]?.node;

  if (!person?.id) {
    return { outcome: 'person-not-found', personId };
  }

  const current =
    typeof person.lastAlloCallAt === 'string' ? person.lastAlloCallAt : null;

  // Compare as instants, not as strings: Twenty can hand back a different
  // serialisation than the one that went in.
  if (current !== null && Date.parse(current) >= Date.parse(startedAt)) {
    return { outcome: 'older', personId };
  }

  await client.mutation({
    updatePerson: {
      __args: { id: personId, data: { lastAlloCallAt: startedAt } },
      id: true,
    },
  });

  return { outcome: 'written', personId, startedAt };
};
