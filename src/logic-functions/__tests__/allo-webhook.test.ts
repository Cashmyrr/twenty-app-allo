import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMemoryKv } from 'src/__tests__/utils/create-memory-kv';
import { ALLO_REGISTRATION_KV_KEY } from 'src/constants/allo-registration';

const queryMock = vi.fn();
const mutationMock = vi.fn();
const constructorSpy = vi.fn();

vi.mock('twenty-client-sdk/core', () => ({
  CoreApiClient: class {
    query = queryMock;
    mutation = mutationMock;

    constructor(options?: unknown) {
      constructorSpy(options);
    }
  },
}));

const memoryKv = createMemoryKv();
const enqueueJobsMock = vi.fn();

vi.mock('twenty-sdk/logic-function', async (importOriginal) => ({
  ...(await importOriginal<typeof import('twenty-sdk/logic-function')>()),
  kv: memoryKv,
  enqueueJobs: enqueueJobsMock,
}));

const { RetryableLogicFunctionError } = await import('twenty-sdk/logic-function');
const { alloWebhookHandler } = await import('src/logic-functions/allo-webhook');

const CONTACT_NUMBER = '+33612345678';
const ALLO_NUMBER = '+33112345678';
const STARTED_AT = '2025-03-15T14:30:00.000Z';

const receivedPayload = {
  topic: 'call.received',
  version: '2.0',
  timestamp: STARTED_AT,
  data: {
    from_number: CONTACT_NUMBER,
    to_number: ALLO_NUMBER,
    started_at: STARTED_AT,
    user_email: 'john@acme.com',
    person: {
      id: 'con_1',
      name: 'Marie',
      last_name: 'Dupont',
      email: 'marie.dupont@acme.com',
    },
  },
};


// The resolver has already verified the signature; the target receives the
// parsed event plus the registration it was dispatched for.
const handle = (event: unknown, deferredAttempt?: number) =>
  alloWebhookHandler({
    registrationId: 'reg_1',
    webhookId: 'msg_1',
    event: event as never,
    ...(deferredAttempt === undefined ? {} : { deferredAttempt }),
  }) as Promise<any>;

// Answers the queries in the order the handler issues them: workspace member,
// then person, then the existing-record lookups inside the upsert.
const mockQueries = ({
  memberId = null,
  personId = null,
  companyId = null,
  existingCallId = null,
  existingStatus = null,
  existingTags = null,
}: {
  memberId?: string | null;
  personId?: string | null;
  companyId?: string | null;
  existingCallId?: string | null;
  existingStatus?: string | null;
  existingTags?: string[] | null;
} = {}) => {
  queryMock.mockImplementation((operation: Record<string, unknown>) => {
    if ('workspaceMembers' in operation) {
      return Promise.resolve({
        workspaceMembers: {
          edges: memberId ? [{ node: { id: memberId } }] : [],
        },
      });
    }

    if ('people' in operation) {
      const edges = personId
        ? [
            {
              node: {
                id: personId,
                company: companyId ? { id: companyId } : null,
              },
            },
          ]
        : [];

      return Promise.resolve({ people: { edges } });
    }

    if ('alloCalls' in operation) {
      return Promise.resolve({
        alloCalls: {
          edges: existingCallId
            ? [
                {
                  node: {
                    id: existingCallId,
                    status: existingStatus,
                    tags: existingTags,
                  },
                },
              ]
            : [],
        },
      });
    }

    throw new Error(`Unexpected query: ${Object.keys(operation).join(',')}`);
  });
};

beforeEach(async () => {
  queryMock.mockReset();
  mutationMock.mockReset();
  constructorSpy.mockReset();
  enqueueJobsMock.mockReset();
  memoryKv.store.clear();
  await memoryKv.set(ALLO_REGISTRATION_KV_KEY, { registrationId: 'reg_1' });
});

describe('allo webhook target', () => {
  it('creates a record on call.received and links member and person', async () => {
    mockQueries({ memberId: 'wm_1', personId: 'p_1', companyId: 'c_1' });
    mutationMock.mockResolvedValue({ createAlloCall: { id: 'call_1' } });

    const result = await handle(receivedPayload);

    expect(result).toEqual({
      kind: 'call',
      topic: 'call.received',
      operation: 'created',
      recordId: 'call_1',
      linked: { member: true, person: true, company: true },
    });

    // Deliveries have no calling user, so the app's own role must be used.
    expect(constructorSpy).toHaveBeenCalledWith({ runAs: 'application' });

    const createArgs = mutationMock.mock.calls[0][0].createAlloCall.__args.data;
    expect(createArgs).toMatchObject({
      status: 'RINGING',
      direction: 'INBOUND',
      contactNumber: CONTACT_NUMBER,
      alloNumber: ALLO_NUMBER,
      userEmail: 'john@acme.com',
      memberId: 'wm_1',
      personId: 'p_1',
      companyId: 'c_1',
      correlationKey: `${CONTACT_NUMBER}|${ALLO_NUMBER}|${STARTED_AT}`,
    });
  });

  it('updates the same record on call.completed', async () => {
    mockQueries({ existingCallId: 'call_1' });
    mutationMock.mockResolvedValue({ updateAlloCall: { id: 'call_1' } });

    const result = await handle({
      topic: 'call.completed',
      data: {
        id: 'cll_1',
        start_date: STARTED_AT,
        from_number: CONTACT_NUMBER,
        to: ALLO_NUMBER,
        type: 'INBOUND',
        result: 'ANSWERED',
        length_in_minutes: 5.5,
        length: '5m 30s',
        summary: 'Billing question.',
        concatenated_transcript: 'Hi.',
        user_email: 'john@acme.com',
      },
    });

    expect(result.operation).toBe('updated');

    const call = mutationMock.mock.calls[0][0].updateAlloCall;
    expect(call.__args.id).toBe('call_1');
    expect(call.__args.data).toMatchObject({
      alloCallId: 'cll_1',
      status: 'COMPLETED',
      result: 'ANSWERED',
      durationSeconds: 330,
      summary: 'Billing question.',
      transcript: 'Hi.',
    });
  });

  it('creates the record on call.completed when earlier events never arrived', async () => {
    mockQueries();
    mutationMock.mockResolvedValue({ createAlloCall: { id: 'call_2' } });

    const result = await handle({
      topic: 'call.completed',
      data: {
        id: 'cll_2',
        start_date: STARTED_AT,
        from_number: CONTACT_NUMBER,
        to: ALLO_NUMBER,
        type: 'OUTBOUND',
      },
    });

    expect(result.operation).toBe('created');
  });

  it('never blanks a field an earlier event filled', async () => {
    mockQueries({ existingCallId: 'call_1' });
    mutationMock.mockResolvedValue({ updateAlloCall: { id: 'call_1' } });

    await handle({
      topic: 'call.completed',
      data: {
        id: 'cll_1',
        start_date: STARTED_AT,
        from_number: CONTACT_NUMBER,
        to: ALLO_NUMBER,
        type: 'INBOUND',
      },
    });

    const data = mutationMock.mock.calls[0][0].updateAlloCall.__args.data;

    // call.completed carries no answered_at, so the key must be absent, not null.
    expect(data).not.toHaveProperty('answeredAt');
    expect(data).not.toHaveProperty('summary');
  });

  // Allo retries a failed delivery, so a lifecycle event can land after
  // call.completed already closed the record.
  it('does not pull a completed call back when call.answered is retried', async () => {
    mockQueries({ existingCallId: 'call_1', existingStatus: 'COMPLETED' });
    mutationMock.mockResolvedValue({ updateAlloCall: { id: 'call_1' } });

    await handle({
      topic: 'call.answered',
      data: {
        from_number: CONTACT_NUMBER,
        to_number: ALLO_NUMBER,
        started_at: STARTED_AT,
        answered_at: '2025-03-15T14:30:08.000Z',
        direction: 'INBOUND',
        user_email: 'john@acme.com',
      },
    });

    const data = mutationMock.mock.calls[0][0].updateAlloCall.__args.data;

    expect(data).not.toHaveProperty('status');
    // The rest of a late event is additive and must still be written.
    expect(data.answeredAt).toBe('2025-03-15T14:30:08.000Z');
  });

  it('does not pull an in-progress call back when call.received is retried', async () => {
    mockQueries({ existingCallId: 'call_1', existingStatus: 'IN_PROGRESS' });
    mutationMock.mockResolvedValue({ updateAlloCall: { id: 'call_1' } });

    await handle(receivedPayload);

    expect(
      mutationMock.mock.calls[0][0].updateAlloCall.__args.data,
    ).not.toHaveProperty('status');
  });

  it('still advances the status when the event moves the call forward', async () => {
    mockQueries({ existingCallId: 'call_1', existingStatus: 'RINGING' });
    mutationMock.mockResolvedValue({ updateAlloCall: { id: 'call_1' } });

    await handle({
      topic: 'call.completed',
      data: {
        id: 'cll_1',
        start_date: STARTED_AT,
        from_number: CONTACT_NUMBER,
        to: ALLO_NUMBER,
        type: 'INBOUND',
      },
    });

    expect(
      mutationMock.mock.calls[0][0].updateAlloCall.__args.data.status,
    ).toBe('COMPLETED');
  });

  it('writes the status when the existing record has none', async () => {
    mockQueries({ existingCallId: 'call_1', existingStatus: null });
    mutationMock.mockResolvedValue({ updateAlloCall: { id: 'call_1' } });

    await handle(receivedPayload);

    expect(
      mutationMock.mock.calls[0][0].updateAlloCall.__args.data.status,
    ).toBe('RINGING');
  });

  // Allo already has its 200, so a failed write must be retried here.
  it('re-queues the delivery when the write fails', async () => {
    mockQueries();
    mutationMock.mockRejectedValue(new Error('boom'));

    const result = await handle(receivedPayload);

    expect(result).toEqual({
      kind: 'retry-scheduled',
      topic: 'call.received',
      delayMs: 60_000,
    });
    expect(enqueueJobsMock.mock.calls[0][0].payloads[0].deferredAttempt).toBe(1);
  });

  it('falls back on the queue retries when it cannot schedule one', async () => {
    mockQueries();
    mutationMock.mockRejectedValue(new Error('boom'));
    enqueueJobsMock.mockRejectedValue(new Error('queue down'));

    await expect(handle(receivedPayload)).rejects.toBeInstanceOf(
      RetryableLogicFunctionError,
    );
  });

  it('fails for good once every retry is spent', async () => {
    mockQueries();
    mutationMock.mockRejectedValue(new Error('boom'));

    await expect(handle(receivedPayload, 5)).rejects.toThrow(/Giving up/);
    expect(enqueueJobsMock).not.toHaveBeenCalled();
  });

  it('still records the call when link resolution fails', async () => {
    queryMock.mockImplementation((operation: Record<string, unknown>) => {
      if ('alloCalls' in operation) {
        return Promise.resolve({ alloCalls: { edges: [] } });
      }

      return Promise.reject(new Error('lookup unavailable'));
    });
    mutationMock.mockResolvedValue({ createAlloCall: { id: 'call_4' } });

    const result = await handle(receivedPayload);

    expect(result.linked).toEqual({
      member: false,
      person: false,
      company: false,
    });
  });

  it('skips an event whose payload cannot be correlated', async () => {
    mockQueries();

    const result = await handle({
      topic: 'call.received',
      data: { from_number: CONTACT_NUMBER, to_number: ALLO_NUMBER },
    });

    expect(result.operation).toBe('skipped');
    expect(mutationMock).not.toHaveBeenCalled();
  });

  it('reports an event with no data as invalid', async () => {
    const result = await handle({ topic: 'call.received' });

    expect(result).toEqual({ kind: 'invalid', reason: 'Event has no data payload' });
    expect(mutationMock).not.toHaveBeenCalled();
  });

  // A delivery queued just before a disconnect must not write into a
  // workspace that no longer holds that registration.
  it('ignores a delivery for a registration this workspace no longer holds', async () => {
    await memoryKv.delete(ALLO_REGISTRATION_KV_KEY);

    const result = await handle(receivedPayload);

    expect(result).toEqual({ kind: 'stale-registration' });
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe('tag events', () => {
  const tagEvent = (topic: string, tagKey: string = 'wrong_number') => ({
    topic,
    data: {
      call_id: 'cll_1',
      tag_key: tagKey,
      tag_name: 'Wrong number',
      user_email: 'john@acme.com',
    },
  });

  it('adds a tag to the existing call', async () => {
    mockQueries({ existingCallId: 'call_1', existingTags: ['support'] });
    mutationMock.mockResolvedValue({ updateAlloCall: { id: 'call_1' } });

    const result = await handle(tagEvent('tag.added'));

    expect(result).toEqual({
      kind: 'tag',
      topic: 'tag.added',
      outcome: 'updated',
      recordId: 'call_1',
      alloCallId: 'cll_1',
      tag: 'wrong_number',
    });
    expect(
      mutationMock.mock.calls[0][0].updateAlloCall.__args.data.tags,
    ).toEqual(['support', 'wrong_number']);
  });

  it('removes a tag from the existing call', async () => {
    mockQueries({
      existingCallId: 'call_1',
      existingTags: ['support', 'wrong_number'],
    });
    mutationMock.mockResolvedValue({ updateAlloCall: { id: 'call_1' } });

    await handle(tagEvent('tag.removed'));

    expect(
      mutationMock.mock.calls[0][0].updateAlloCall.__args.data.tags,
    ).toEqual(['support']);
  });

  it('creates the tags array when the call has none', async () => {
    mockQueries({ existingCallId: 'call_1', existingTags: null });
    mutationMock.mockResolvedValue({ updateAlloCall: { id: 'call_1' } });

    await handle(tagEvent('tag.added'));

    expect(
      mutationMock.mock.calls[0][0].updateAlloCall.__args.data.tags,
    ).toEqual(['wrong_number']);
  });

  // Allo retries deliveries, so the same tag event can arrive twice.
  it('is idempotent when the tag is already present', async () => {
    mockQueries({ existingCallId: 'call_1', existingTags: ['wrong_number'] });

    const result = await handle(tagEvent('tag.added'));

    expect(result.outcome).toBe('unchanged');
    expect(mutationMock).not.toHaveBeenCalled();
  });

  it('is idempotent when removing a tag that is absent', async () => {
    mockQueries({ existingCallId: 'call_1', existingTags: ['support'] });

    const result = await handle(tagEvent('tag.removed'));

    expect(result.outcome).toBe('unchanged');
    expect(mutationMock).not.toHaveBeenCalled();
  });

  // Allo does not order deliveries: the tag can beat the call.completed that
  // creates the record, which Allo sends about 30s after hangup.
  it('re-queues a tag for a call not recorded yet, a minute later', async () => {
    mockQueries({ existingCallId: null });

    const result = await handle(tagEvent('tag.added'));

    expect(result).toEqual({ kind: 'deferred', alloCallId: 'cll_1', delayMs: 60_000 });
    expect(enqueueJobsMock).toHaveBeenCalledWith({
      logicFunctionUniversalIdentifier: expect.any(String),
      payloads: [expect.objectContaining({ registrationId: 'reg_1', deferredAttempt: 1 })],
      delayMs: 60_000,
    });
    expect(mutationMock).not.toHaveBeenCalled();
  });

  it('waits longer on each attempt', async () => {
    mockQueries({ existingCallId: null });

    const result = await handle(tagEvent('tag.added'), 2);

    expect(result.delayMs).toBe(30 * 60_000);
    expect(enqueueJobsMock.mock.calls[0][0].payloads[0].deferredAttempt).toBe(3);
  });

  // Out of attempts, the call most likely predates the app: give up quietly.
  it('ignores a tag for an unknown call once attempts are spent', async () => {
    mockQueries({ existingCallId: null });

    const result = await handle(tagEvent('tag.added'), 5);

    expect(result.outcome).toBe('call-not-found');
    expect(enqueueJobsMock).not.toHaveBeenCalled();
  });

  it('applies a deferred tag once the call exists', async () => {
    mockQueries({ existingCallId: 'call_1', existingTags: [] });
    mutationMock.mockResolvedValue({ updateAlloCall: { id: 'call_1' } });

    const result = await handle(tagEvent('tag.added'), 1);

    expect(result.outcome).toBe('updated');
    expect(enqueueJobsMock).not.toHaveBeenCalled();
  });

  it('reports a tag event with no call_id as invalid', async () => {
    const result = await handle({
      topic: 'tag.added',
      data: { tag_key: 'wrong_number' },
    });

    expect(result.kind).toBe('invalid');
    expect(mutationMock).not.toHaveBeenCalled();
  });

  it('reports a tag event with no tag_key as invalid', async () => {
    const result = await handle({ topic: 'tag.added', data: { call_id: 'cll_1' } });

    expect(result.kind).toBe('invalid');
  });
});
