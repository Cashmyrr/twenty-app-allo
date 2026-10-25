import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const constructorSpy = vi.fn();

vi.mock('twenty-client-sdk/core', () => ({
  CoreApiClient: class {
    query = queryMock;

    constructor(options?: unknown) {
      constructorSpy(options);
    }
  },
}));

const { pushToDialerHandler, MAX_PEOPLE } = await import(
  'src/logic-functions/push-to-dialer'
);

const CONTEXT: {
  retryCount: number;
  maxRetries: number;
  workspaceId: string;
  userWorkspaceId: string | null;
  workspaceMemberId: string | null;
} = {
  retryCount: 0,
  maxRetries: 0,
  workspaceId: 'ws_1',
  userWorkspaceId: 'uw_1',
  workspaceMemberId: 'wm_1',
};

const person = (id: string, phone: string | null = '612345678') => ({
  id,
  name: { firstName: 'Ada', lastName: id },
  phones: { primaryPhoneNumber: phone, primaryPhoneCallingCode: '+33' },
  emails: { primaryEmail: `${id}@example.com` },
  jobTitle: null,
  company: null,
});

/** Serves people pages the way Twenty does: at most 100 per page. */
const servePeople = (all: ReturnType<typeof person>[]) => {
  queryMock.mockImplementation(async (operation: Record<string, any>) => {
    if ('workspaceMembers' in operation) {
      return {
        workspaceMembers: {
          edges: [{ node: { id: 'wm_1', userEmail: 'rep@example.com' } }],
        },
      };
    }

    const args = operation.people.__args;
    const ids: string[] | undefined = args.filter?.id?.in;
    const matching = ids ? all.filter((p) => ids.includes(p.id)) : all;
    const start = args.after ? Number(args.after) : 0;
    const page = matching.slice(start, start + Math.min(args.first, 100));
    const end = start + page.length;

    return {
      people: {
        edges: page.map((node) => ({ node })),
        pageInfo: { hasNextPage: end < matching.length, endCursor: String(end) },
      },
    };
  });
};

let alloRequests: any[] = [];

const stubAllo = (status = 200) => {
  alloRequests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));

      alloRequests.push(body);

      return new Response(
        JSON.stringify({ data: { added: body.numbers, skipped: [] } }),
        { status },
      );
    }),
  );
};

const send = (body: unknown, context = CONTEXT) =>
  pushToDialerHandler({ body } as never, context) as Promise<any>;

beforeEach(() => {
  queryMock.mockReset();
  constructorSpy.mockReset();
  process.env.ALLO_API_KEY = 'allo_key_1';
  stubAllo();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ALLO_API_KEY;
});

describe('push-to-dialer', () => {
  it('counts the numbers Allo skipped by reason', async () => {
    servePeople([person('p1'), person('p2')]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: {
              added: [],
              skipped: [
                { number: '+33612345678', reason: 'INVALID_PHONE_NUMBER' },
                { number: '+33612345679', reason: 'INVALID_PHONE_NUMBER' },
              ],
            },
          }),
          { status: 200 },
        ),
      ),
    );

    const response = await send({ personIds: ['p1', 'p2'] });

    expect(response.body).toMatchObject({
      added: 0,
      skippedByAllo: 2,
      skippedReasons: { INVALID_PHONE_NUMBER: 2 },
    });
  });

  it("queues the selection into the caller's own queue", async () => {
    servePeople([person('p1'), person('p2')]);

    const response = await send({ personIds: ['p1', 'p2'] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      selected: 2,
      added: 2,
      skippedByAllo: 0,
      skippedReasons: {},
      withoutNumber: 0,
      notFound: 0,
    });
    expect(alloRequests[0].email).toBe('rep@example.com');
    expect(alloRequests[0].numbers[0]).toMatchObject({
      number: '+33612345678',
      name: 'Ada',
    });
  });

  // Runs as the caller: a member can only queue people they are allowed to read.
  it('reads people with the caller permissions, not the app role', async () => {
    servePeople([person('p1')]);

    await send({ personIds: ['p1'] });

    expect(constructorSpy).toHaveBeenCalledWith(undefined);
  });

  it('pages past the 100-record cap instead of dropping the rest', async () => {
    const people = Array.from({ length: 231 }, (_, index) => person(`p${index}`));
    servePeople(people);

    const response = await send({ personIds: people.map((p) => p.id) });

    expect(response.body.added).toBe(231);
    expect(alloRequests[0].numbers).toHaveLength(231);
  });

  it('queues a "Select all" selection through the view filter', async () => {
    servePeople(Array.from({ length: 150 }, (_, index) => person(`p${index}`)));

    const response = await send({ filter: { city: { eq: 'Paris' } } });

    expect(response.body).toMatchObject({ selected: 150, added: 150 });
  });

  it('refuses a selection above the limit rather than truncating it', async () => {
    servePeople(
      Array.from({ length: MAX_PEOPLE + 1 }, (_, index) => person(`p${index}`)),
    );

    const response = await send({ filter: {} });

    expect(response.status).toBe(400);
    expect(alloRequests).toHaveLength(0);
  });

  it('reports people without a number and ids it could not read', async () => {
    servePeople([person('p1'), person('p2', null)]);

    const response = await send({ personIds: ['p1', 'p2', 'p_hidden'] });

    expect(response.body).toMatchObject({
      selected: 3,
      added: 1,
      withoutNumber: 1,
      notFound: 1,
    });
  });

  it('answers 422 when nobody selected has a number', async () => {
    servePeople([person('p1', null)]);

    expect((await send({ personIds: ['p1'] })).status).toBe(422);
  });

  it('refuses a caller with no workspace member', async () => {
    servePeople([person('p1')]);

    const response = await send(
      { personIds: ['p1'] },
      { ...CONTEXT, workspaceMemberId: null },
    );

    expect(response.status).toBe(403);
    expect(alloRequests).toHaveLength(0);
  });

  it('answers 400 for an empty selection', async () => {
    expect((await send({ personIds: [] })).status).toBe(400);
  });

  it('passes Allo refusals through with their status', async () => {
    servePeople([person('p1')]);
    stubAllo(403);

    expect((await send({ personIds: ['p1'] })).status).toBe(403);
  });

  it('answers 500 when no API key is configured', async () => {
    delete process.env.ALLO_API_KEY;

    expect((await send({ personIds: ['p1'] })).status).toBe(500);
  });
});
