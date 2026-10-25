import { beforeEach, describe, expect, it } from 'vitest';

import { processAlloEvent } from 'src/logic-functions/utils/process-allo-event';

type CallRecord = Record<string, unknown> & { id: string };
type Filter = Record<string, any>;

let records: CallRecord[] = [];

// Evaluates the filter operators the app uses, so a wrong filter fails here.
const matches = (record: CallRecord, filter: Filter): boolean =>
  Object.entries(filter).every(([key, condition]) => {
    if (key === 'and') {
      return (condition as Filter[]).every((part) => matches(record, part));
    }

    if (key === 'or') {
      return (condition as Filter[]).some((part) => matches(record, part));
    }

    const value = record[key] ?? null;

    return Object.entries(condition as Filter).every(([operator, operand]) => {
      switch (operator) {
        case 'eq':
          return value === operand;
        case 'neq':
          return value !== null && value !== operand;
        case 'is':
          return operand === 'NULL' ? value === null : value !== null;
        case 'gte':
          return value !== null && String(value) >= operand;
        case 'lte':
          return value !== null && String(value) <= operand;
        default:
          throw new Error(`Unsupported filter operator ${operator}`);
      }
    });
  });

/** A Twenty workspace holding Allo Call records, and nobody to link to. */
const fakeClient = {
  query: async (operation: Record<string, any>) => {
    if ('alloCalls' in operation) {
      const { filter, orderBy, first } = operation.alloCalls.__args;
      let found = records.filter((record) => matches(record, filter));
      const direction = orderBy?.[0]?.startedAt;

      if (direction) {
        found = [...found].sort((a, b) =>
          String(a.startedAt).localeCompare(String(b.startedAt)) *
          (direction.startsWith('Desc') ? -1 : 1),
        );
      }

      return {
        alloCalls: {
          edges: found.slice(0, first).map((node) => ({ node })),
        },
      };
    }

    const [name] = Object.keys(operation);

    return { [name]: { edges: [] } };
  },
  mutation: async (operation: Record<string, any>) => {
    if ('createAlloCall' in operation) {
      const record = {
        id: `rec_${records.length + 1}`,
        ...operation.createAlloCall.__args.data,
      };

      records.push(record);

      return { createAlloCall: { id: record.id } };
    }

    const { id, data } = operation.updateAlloCall.__args;
    const record = records.find((candidate) => candidate.id === id);

    Object.assign(record!, data);

    return { updateAlloCall: { id } };
  },
};

const send = (topic: string, data: Record<string, unknown>) =>
  processAlloEvent(fakeClient as never, { topic, data });

const ALLO_NUMBER = '+33745805086';
const CONTACT_NUMBER = '+33635442110';
const person = { id: 'per-1', name: 'Pierre', last_name: 'Perso' };

// The timestamps of a real answered call: call.completed's start_date is the
// answer time, truncated to the second, not the ring start.
const RING_START = '2026-10-25T23:17:48.933Z';
const ANSWERED_AT = '2026-10-25T23:17:54.236Z';
const COMPLETED_START = '2026-10-25T23:17:54Z';

const triggered = (startedAt = RING_START) =>
  send('call.triggered', {
    from_number: ALLO_NUMBER,
    to_number: CONTACT_NUMBER,
    started_at: startedAt,
    user_email: 'tech@cashmyrr.com',
    person,
  });

const answered = () =>
  send('call.answered', {
    from_number: ALLO_NUMBER,
    to_number: CONTACT_NUMBER,
    direction: 'OUTBOUND',
    started_at: RING_START,
    answered_at: ANSWERED_AT,
    user_email: 'tech@cashmyrr.com',
    person,
  });

const completed = ({
  id = 'cll-1',
  startDate = COMPLETED_START,
  result = 'ANSWERED',
  lengthInMinutes = 0.65,
} = {}) =>
  send('call.completed', {
    id,
    start_date: startDate,
    from_number: ALLO_NUMBER,
    from_name: 'Antoine Lessard',
    to: CONTACT_NUMBER,
    to_name: '',
    length_in_minutes: lengthInMinutes,
    type: 'OUTBOUND',
    result,
    summary: 'Agreed to sign',
    user_email: 'tech@cashmyrr.com',
  });

beforeEach(() => {
  records = [];
});

describe('one record per Allo call', () => {
  it('completes the record the ring events created', async () => {
    await triggered();
    await answered();
    await completed();

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      alloCallId: 'cll-1',
      status: 'COMPLETED',
      // The ring start and the contact's name survive call.completed.
      startedAt: RING_START,
      name: 'Outbound call to Pierre Perso',
      answeredAt: ANSWERED_AT,
      endedAt: '2026-10-25T23:18:33.000Z',
      durationSeconds: 39,
      summary: 'Agreed to sign',
    });
  });

  it('merges ring events that arrive after call.completed', async () => {
    await completed();
    await triggered();
    await answered();

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      alloCallId: 'cll-1',
      status: 'COMPLETED',
      startedAt: RING_START,
      answeredAt: ANSWERED_AT,
      name: 'Outbound call to Pierre Perso',
    });
  });

  it('keeps a retried call.completed on the same record', async () => {
    await triggered();
    await completed();
    await completed();

    expect(records).toHaveLength(1);
  });

  // An unanswered call followed by a redial a minute later: each completion
  // must land on its own ring record.
  it('keeps a redial on its own record', async () => {
    await triggered('2026-10-25T10:00:00.400Z');
    await completed({
      id: 'cll-a',
      startDate: '2026-10-25T10:00:00Z',
      result: 'MISSED',
      lengthInMinutes: 0,
    });
    await triggered('2026-10-25T10:01:00.400Z');
    await completed({
      id: 'cll-b',
      startDate: '2026-10-25T10:01:05Z',
    });

    expect(
      records.map(({ alloCallId, startedAt }) => ({ alloCallId, startedAt })),
    ).toEqual([
      { alloCallId: 'cll-a', startedAt: '2026-10-25T10:00:00.400Z' },
      { alloCallId: 'cll-b', startedAt: '2026-10-25T10:01:00.400Z' },
    ]);
  });

  it('does not reach back to a ring record older than the window', async () => {
    await triggered('2026-10-25T09:00:00.000Z');
    await completed({ startDate: '2026-10-25T10:00:00Z' });

    expect(records).toHaveLength(2);
  });
});
