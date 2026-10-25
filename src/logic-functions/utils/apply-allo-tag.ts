import { type CoreApiClient } from 'twenty-client-sdk/core';

export type ApplyAlloTagInput = {
  alloCallId: string;
  tag: string;
  operation: 'add' | 'remove';
};

export type ApplyAlloTagResult = {
  recordId: string | null;
  outcome: 'updated' | 'unchanged' | 'call-not-found';
  tags: string[];
};

/**
 * Adds or removes one tag on the Allo call record.
 *
 * tag.added / tag.removed carry only the call id, so the record must already
 * exist. It normally does: tags are applied after the agent hangs up, well after
 * call.completed created the record. A call tagged before this app was installed
 * has no record, and that is reported rather than treated as an error.
 */
export const applyAlloTag = async (
  client: CoreApiClient,
  { alloCallId, tag, operation }: ApplyAlloTagInput,
): Promise<ApplyAlloTagResult> => {
  const { alloCalls } = await client.query({
    alloCalls: {
      __args: { filter: { alloCallId: { eq: alloCallId } }, first: 1 },
      edges: { node: { id: true, tags: true } },
    },
  });

  const record = alloCalls?.edges?.[0]?.node;

  if (!record?.id) {
    return { recordId: null, outcome: 'call-not-found', tags: [] };
  }

  // The generated client types array elements as possibly undefined.
  const current: string[] = Array.isArray(record.tags)
    ? record.tags.filter((entry: unknown): entry is string => typeof entry === 'string')
    : [];

  const next =
    operation === 'add'
      ? current.includes(tag)
        ? current
        : [...current, tag]
      : current.filter((entry) => entry !== tag);

  // Allo re-sends events on retry, so the same tag can arrive twice.
  if (next.length === current.length && next.every((v, i) => v === current[i])) {
    return { recordId: record.id, outcome: 'unchanged', tags: current };
  }

  await client.mutation({
    updateAlloCall: {
      __args: { id: record.id, data: { tags: next } },
      id: true,
    },
  });

  return { recordId: record.id, outcome: 'updated', tags: next };
};
