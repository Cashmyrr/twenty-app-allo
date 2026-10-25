import { type CoreApiClient, type CoreSchema } from 'twenty-client-sdk/core';

import {
  ALLO_CALL_STATUS_COMPLETED,
  ALLO_CALL_STATUS_IN_PROGRESS,
  ALLO_CALL_STATUS_RINGING,
} from 'src/constants/allo-call-values';
import { type NearbyCallMatch } from 'src/logic-functions/utils/map-allo-call';

// A call only ever moves forward through its lifecycle. Allo retries a failed
// delivery and can deliver out of order, so a late call.answered must not pull a
// record that already completed back to IN_PROGRESS.
const STATUS_RANK: Record<string, number> = {
  [ALLO_CALL_STATUS_RINGING]: 0,
  [ALLO_CALL_STATUS_IN_PROGRESS]: 1,
  [ALLO_CALL_STATUS_COMPLETED]: 2,
};

const isStatusRegression = (
  incoming: unknown,
  existing: unknown,
): boolean => {
  if (typeof incoming !== 'string' || typeof existing !== 'string') {
    return false;
  }

  const incomingRank = STATUS_RANK[incoming];
  const existingRank = STATUS_RANK[existing];

  if (incomingRank === undefined || existingRank === undefined) {
    return false;
  }

  return incomingRank <= existingRank;
};

export type UpsertAlloCallInput = {
  alloCallId: string | null;
  correlationKey: string | null;
  /** Tried when neither the Allo id nor the correlation key finds a record. */
  nearbyMatch?: NearbyCallMatch | null;
  /** Left as they are when updating an existing record. */
  keepExistingFields?: string[];
  fields: Record<string, unknown>;
  /** call.completed creates the record if the earlier events never arrived. */
  shouldCreateIfMissing: boolean;
};

export type UpsertAlloCallResult = {
  recordId: string | null;
  operation: 'created' | 'updated' | 'skipped';
};

/**
 * Drops keys whose value is null/undefined so a later event never blanks a
 * field an earlier one filled (call.completed carries no `answeredAt`, for
 * instance). Explicit values, including `false` and `0`, are kept.
 */
const withoutEmptyValues = (
  fields: Record<string, unknown>,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(fields).filter(
      ([, value]) => value !== null && value !== undefined,
    ),
  );

type ExistingRecord = {
  id: string;
  status: string | null;
  matchedBy: 'allo-call-id' | 'correlation-key' | 'nearby';
};

const findNearbyRecord = async (
  client: CoreApiClient,
  match: NearbyCallMatch,
): Promise<ExistingRecord | null> => {
  const targetFilter: CoreSchema.AlloCallFilterInput[] =
    match.target === 'lifecycle-record'
      ? [
          {
            or: [{ alloCallId: { is: 'NULL' } }, { alloCallId: { eq: '' } }],
          },
          { status: { neq: ALLO_CALL_STATUS_COMPLETED } },
        ]
      : [{ alloCallId: { neq: '' } }];

  const { alloCalls } = await client.query({
    alloCalls: {
      __args: {
        filter: {
          and: [
            { contactNumber: { eq: match.contactNumber } },
            { alloNumber: { eq: match.alloNumber } },
            { startedAt: { gte: match.startedFrom } },
            { startedAt: { lte: match.startedTo } },
            ...targetFilter,
          ],
        },
        // The closest ring start before call.completed, or the closest
        // completed record after a late ring event.
        orderBy: [
          {
            startedAt:
              match.target === 'lifecycle-record'
                ? 'DescNullsLast'
                : 'AscNullsLast',
          },
        ],
        first: 1,
      },
      edges: { node: { id: true, status: true } },
    },
  });

  const node = alloCalls?.edges?.[0]?.node;

  return node?.id
    ? { id: node.id, status: node.status ?? null, matchedBy: 'nearby' }
    : null;
};

const findExistingRecord = async (
  client: CoreApiClient,
  {
    alloCallId,
    correlationKey,
    nearbyMatch,
  }: Pick<UpsertAlloCallInput, 'alloCallId' | 'correlationKey' | 'nearbyMatch'>,
): Promise<ExistingRecord | null> => {
  // Allo's own id is authoritative once we have it.
  if (alloCallId) {
    const { alloCalls } = await client.query({
      alloCalls: {
        __args: { filter: { alloCallId: { eq: alloCallId } }, first: 1 },
        edges: { node: { id: true, status: true } },
      },
    });

    const byAlloCallId = alloCalls?.edges?.[0]?.node;

    if (byAlloCallId?.id) {
      return {
        id: byAlloCallId.id,
        status: byAlloCallId.status ?? null,
        matchedBy: 'allo-call-id',
      };
    }
  }

  if (correlationKey) {
    const { alloCalls } = await client.query({
      alloCalls: {
        __args: { filter: { correlationKey: { eq: correlationKey } }, first: 1 },
        edges: { node: { id: true, status: true } },
      },
    });

    const byCorrelationKey = alloCalls?.edges?.[0]?.node;

    if (byCorrelationKey?.id) {
      return {
        id: byCorrelationKey.id,
        status: byCorrelationKey.status ?? null,
        matchedBy: 'correlation-key',
      };
    }
  }

  return nearbyMatch ? findNearbyRecord(client, nearbyMatch) : null;
};

/**
 * One record per Allo call: the first event creates it, every later event
 * updates the same record in place. Idempotent, so an Allo retry of the same
 * event converges on the same state rather than adding a row.
 */
export const upsertAlloCall = async (
  client: CoreApiClient,
  {
    alloCallId,
    correlationKey,
    nearbyMatch,
    keepExistingFields = [],
    fields,
    shouldCreateIfMissing,
  }: UpsertAlloCallInput,
): Promise<UpsertAlloCallResult> => {
  const existing = await findExistingRecord(client, {
    alloCallId,
    correlationKey,
    nearbyMatch,
  });

  const data = withoutEmptyValues(fields);

  if (existing) {
    // Everything else in a late event is additive, so only the status is held back.
    if (isStatusRegression(data.status, existing.status)) {
      delete data.status;
    }

    for (const field of keepExistingFields) {
      delete data[field];
    }

    // A ring event that lands on the record call.completed created gives it
    // the key, so the call's remaining ring events match it exactly.
    if (
      existing.matchedBy === 'nearby' &&
      nearbyMatch?.target === 'completed-record' &&
      correlationKey
    ) {
      data.correlationKey = correlationKey;
    }

    const result = await client.mutation({
      updateAlloCall: {
        __args: { id: existing.id, data },
        id: true,
      },
    });

    return {
      recordId: result?.updateAlloCall?.id ?? existing.id,
      operation: 'updated',
    };
  }

  if (!shouldCreateIfMissing) {
    return { recordId: null, operation: 'skipped' };
  }

  const result = await client.mutation({
    createAlloCall: {
      __args: {
        data: { ...data, ...(correlationKey ? { correlationKey } : {}) },
      },
      id: true,
    },
  });

  return { recordId: result?.createAlloCall?.id ?? null, operation: 'created' };
};
