import { CoreApiClient } from 'twenty-client-sdk/core';
import { MetadataApiClient } from 'twenty-client-sdk/metadata';
import { afterAll, describe, expect, it } from 'vitest';

import { APPLICATION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { escapeIlikePattern } from 'src/logic-functions/utils/resolve-links';

// These cover what the unit tests cannot: that the metadata actually syncs, that
// the generated GraphQL names match what the webhook calls, and that the filter
// shapes the link resolver relies on are valid against a real schema.
const client = new CoreApiClient();

const createdCallIds: string[] = [];
const createdPersonIds: string[] = [];

const uniqueSuffix = Date.now();

afterAll(async () => {
  for (const id of createdCallIds) {
    await client
      .mutation({ destroyAlloCall: { __args: { id }, id: true } })
      .catch(() => {});
  }

  for (const id of createdPersonIds) {
    await client
      .mutation({ destroyPerson: { __args: { id }, id: true } })
      .catch(() => {});
  }
});

describe('app installation', () => {
  it('installs the app', async () => {
    const metadataClient = new MetadataApiClient();

    const result = await metadataClient.query({
      findManyApplications: {
        id: true,
        name: true,
        universalIdentifier: true,
      },
    });

    const app = result.findManyApplications.find(
      (candidate: { universalIdentifier: string }) =>
        candidate.universalIdentifier === APPLICATION_UNIVERSAL_IDENTIFIER,
    );

    expect(app).toBeDefined();
  });
});

describe('allo call record', () => {
  it('supports the create, lookup and update the webhook performs', async () => {
    const correlationKey = `+33600000001|+33100000001|${new Date(
      uniqueSuffix,
    ).toISOString()}`;

    // createAlloCall / alloCalls / updateAlloCall are derived from the object's
    // nameSingular and namePlural; this proves the webhook calls the right names.
    const created = await client.mutation({
      createAlloCall: {
        __args: {
          data: {
            name: 'Integration test call',
            correlationKey,
            startedAt: new Date(uniqueSuffix).toISOString(),
            direction: 'INBOUND',
            status: 'RINGING',
            fromNumber: '+33600000001',
            toNumber: '+33100000001',
            contactNumber: '+33600000001',
            userEmail: 'integration@example.com',
          },
        },
        id: true,
      },
    });

    const recordId = created.createAlloCall?.id;
    expect(recordId).toBeDefined();

    if (recordId === undefined) {
      throw new Error('createAlloCall returned no id');
    }

    createdCallIds.push(recordId);

    // The correlation-key lookup used by every event before call.completed.
    const byCorrelationKey = await client.query({
      alloCalls: {
        __args: { filter: { correlationKey: { eq: correlationKey } }, first: 1 },
        edges: { node: { id: true, status: true } },
      },
    });

    expect(byCorrelationKey.alloCalls?.edges[0]?.node?.id).toBe(recordId);

    // The call.completed update, including every field type the mapper writes.
    const updated = await client.mutation({
      updateAlloCall: {
        __args: {
          id: recordId,
          data: {
            alloCallId: `cll_integration_${uniqueSuffix}`,
            status: 'COMPLETED',
            result: 'ANSWERED',
            durationSeconds: 330,
            durationLabel: '5m 30s',
            endedAt: new Date(uniqueSuffix + 330_000).toISOString(),
            summary: 'Integration test summary.',
            transcript: 'Contact: Hi.\nAgent: Hello.',
            // Cast: the generated client types RAW_JSON as Record<string,
            // unknown>, but the column is jsonb. Whether an array round-trips is
            // exactly what this asserts.
            transcriptEntries: [
              { source: 'EXTERNAL', time: null, text: 'Hi.' },
            ] as unknown as Record<string, unknown>,
            recording: {
              primaryLinkUrl: 'https://example.com/recording.mp3',
              primaryLinkLabel: 'Recording',
            },
            tags: ['support', 'urgent'],
            dataCollected: { account_number: '12345' },
            ivrResult: [
              { dtmf_key: '2', text_key: 'Support' },
            ] as unknown as Record<string, unknown>,
            transfer: { from: null, to: null, originalCallId: null },
          },
        },
        id: true,
        status: true,
        result: true,
        durationSeconds: true,
        tags: true,
        summary: true,
      },
    });

    expect(updated.updateAlloCall?.status).toBe('COMPLETED');
    expect(updated.updateAlloCall?.result).toBe('ANSWERED');
    expect(updated.updateAlloCall?.durationSeconds).toBe(330);

    // Re-read the JSON and array columns to prove the shapes survived the write.
    const { alloCalls: reread } = await client.query({
      alloCalls: {
        __args: { filter: { id: { eq: recordId } }, first: 1 },
        edges: {
          node: {
            tags: true,
            transcriptEntries: true,
            ivrResult: true,
            dataCollected: true,
          },
        },
      },
    });

    const stored = reread?.edges[0]?.node;
    expect(stored?.tags).toEqual(['support', 'urgent']);
    expect(stored?.transcriptEntries).toEqual([
      { source: 'EXTERNAL', time: null, text: 'Hi.' },
    ]);
    expect(stored?.ivrResult).toEqual([{ dtmf_key: '2', text_key: 'Support' }]);
    expect(stored?.dataCollected).toEqual({ account_number: '12345' });

    // The alloCallId lookup that takes over once call.completed has landed.
    const byAlloCallId = await client.query({
      alloCalls: {
        __args: {
          filter: { alloCallId: { eq: `cll_integration_${uniqueSuffix}` } },
          first: 1,
        },
        edges: { node: { id: true } },
      },
    });

    expect(byAlloCallId.alloCalls?.edges[0]?.node?.id).toBe(recordId);
  });
});

describe('relations', () => {
  it('links a call to a workspace member and a person', async () => {
    const { workspaceMembers } = await client.query({
      workspaceMembers: {
        __args: { first: 1 },
        edges: { node: { id: true, userEmail: true } },
      },
    });

    const member = workspaceMembers?.edges[0]?.node;
    expect(member?.id).toBeDefined();
    if (!member?.id) return;

    const person = await client.mutation({
      createPerson: {
        __args: {
          data: {
            name: { firstName: 'Allo', lastName: `Test ${uniqueSuffix}` },
            emails: { primaryEmail: `allo.test.${uniqueSuffix}@example.com` },
            phones: {
              primaryPhoneNumber: '612345678',
              primaryPhoneCallingCode: '+33',
              primaryPhoneCountryCode: 'FR',
            },
          },
        },
        id: true,
      },
    });

    const personId = person.createPerson?.id as string;
    createdPersonIds.push(personId);

    const call = await client.mutation({
      createAlloCall: {
        __args: {
          data: {
            name: 'Integration test linked call',
            correlationKey: `+33612345678|+33100000002|${uniqueSuffix}`,
            memberId: member.id,
            personId,
          },
        },
        id: true,
      },
    });

    createdCallIds.push(call.createAlloCall?.id as string);

    // Reading the relations back proves both sides of each relation synced,
    // including the one added to the standard workspaceMember object.
    const { alloCalls } = await client.query({
      alloCalls: {
        __args: { filter: { id: { eq: call.createAlloCall?.id } }, first: 1 },
        edges: {
          node: {
            id: true,
            member: { id: true },
            person: { id: true },
          },
        },
      },
    });

    const node = alloCalls?.edges[0]?.node;
    expect(node?.member?.id).toBe(member.id);
    expect(node?.person?.id).toBe(personId);
  });

  it('exposes alloCalls on person and workspaceMember', async () => {
    const { people } = await client.query({
      people: {
        __args: { first: 1 },
        edges: { node: { id: true, alloCalls: { edges: { node: { id: true } } } } },
      },
    });

    expect(people).toBeDefined();

    const { workspaceMembers } = await client.query({
      workspaceMembers: {
        __args: { first: 1 },
        edges: { node: { id: true, alloCalls: { edges: { node: { id: true } } } } },
      },
    });

    expect(workspaceMembers).toBeDefined();
  });
});

describe('link resolution filters', () => {
  it('accepts the workspace member email filter', async () => {
    const { workspaceMembers } = await client.query({
      workspaceMembers: {
        __args: {
          filter: { userEmail: { ilike: 'nobody@example.invalid' } },
          first: 1,
        },
        edges: { node: { id: true } },
      },
    });

    expect(workspaceMembers?.edges).toEqual([]);
  });

  it('accepts the person email filter and finds a known address', async () => {
    const email = `allo.filter.${uniqueSuffix}@example.com`;

    const person = await client.mutation({
      createPerson: {
        __args: {
          data: {
            name: { firstName: 'Filter', lastName: `Test ${uniqueSuffix}` },
            emails: { primaryEmail: email },
          },
        },
        id: true,
      },
    });

    createdPersonIds.push(person.createPerson?.id as string);

    const { people } = await client.query({
      people: {
        __args: {
          filter: { emails: { primaryEmail: { ilike: email } } },
          first: 1,
        },
        edges: { node: { id: true } },
      },
    });

    expect(people?.edges[0]?.node?.id).toBe(person.createPerson?.id);
  });

  // The resolver escapes `_` and `%` before an ilike match. This proves the
  // server honours the backslash escape, so an escaped address still matches
  // itself and stops matching its wildcard look-alikes.
  it('matches an escaped email literally', async () => {
    const email = `allo_escape.${uniqueSuffix}@example.com`;
    // Matches `allo_escape...` only if `_` is still read as a wildcard.
    const lookAlike = email.replace('allo_escape', 'alloxescape');

    const createPerson = async (address: string) => {
      const created = await client.mutation({
        createPerson: {
          __args: {
            data: {
              name: { firstName: 'Escape', lastName: `Test ${uniqueSuffix}` },
              emails: { primaryEmail: address },
            },
          },
          id: true,
        },
      });

      createdPersonIds.push(created.createPerson?.id as string);

      return created.createPerson?.id as string;
    };

    const exactId = await createPerson(email);
    await createPerson(lookAlike);

    const { people } = await client.query({
      people: {
        __args: {
          filter: {
            emails: { primaryEmail: { ilike: escapeIlikePattern(email) } },
          },
          first: 5,
        },
        edges: { node: { id: true } },
      },
    });

    expect(people?.edges.map((edge: any) => edge?.node?.id)).toEqual([exactId]);
  });

  it('accepts the person phone filter on the national number', async () => {
    const nationalNumber = String(9_000_000_000 + (uniqueSuffix % 99_999_999));

    const person = await client.mutation({
      createPerson: {
        __args: {
          data: {
            name: { firstName: 'Phone', lastName: `Test ${uniqueSuffix}` },
            phones: {
              primaryPhoneNumber: nationalNumber,
              primaryPhoneCallingCode: '+33',
              primaryPhoneCountryCode: 'FR',
            },
          },
        },
        id: true,
      },
    });

    createdPersonIds.push(person.createPerson?.id as string);

    const { people } = await client.query({
      people: {
        __args: {
          filter: { phones: { primaryPhoneNumber: { eq: nationalNumber } } },
          first: 1,
        },
        edges: { node: { id: true } },
      },
    });

    expect(people?.edges[0]?.node?.id).toBe(person.createPerson?.id);

    // The suffix fallback the resolver uses when the exact match misses.
    const { people: bySuffix } = await client.query({
      people: {
        __args: {
          filter: {
            phones: { primaryPhoneNumber: { ilike: `%${nationalNumber}` } },
          },
          first: 2,
        },
        edges: { node: { id: true } },
      },
    });

    expect(bySuffix?.edges.length).toBeGreaterThan(0);
  });
});
