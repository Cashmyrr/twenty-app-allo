/**
 * One-shot backfill of `person.lastAlloCallAt` from the calls already in Twenty.
 *
 * The two logic functions that maintain this field only fire on new events, so
 * every call recorded before the field existed left its person with an empty
 * date. This walks the existing calls and writes the newest one per person.
 *
 * Reads Twenty only, no Allo API call, nothing metered. Safe to re-run: the
 * write is skipped whenever the stored date is already at least as recent, so a
 * second run reports zero changes.
 *
 *   node scripts/backfill-last-allo-call.mts            dry run, writes nothing
 *   node scripts/backfill-last-allo-call.mts --apply    writes
 *
 * Credentials: TWENTY_API_URL and TWENTY_API_KEY from .env, falling back to the
 * default remote in ~/.twenty/config.json.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { CoreApiClient } from 'twenty-client-sdk/core';

import { throttled } from './lib/twenty-throttle.mts';

const apply = process.argv.includes('--apply');

const loadDotEnv = (): void => {
  try {
    for (const line of readFileSync('.env', 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    // No .env is fine when the variables are already exported.
  }
};

const loadTwentyCredentials = (): void => {
  if (process.env.TWENTY_API_URL && process.env.TWENTY_API_KEY) return;

  try {
    const cfg = JSON.parse(
      readFileSync(join(homedir(), '.twenty', 'config.json'), 'utf8'),
    );
    const remote = cfg.remotes?.[cfg.defaultRemote];

    if (remote) {
      process.env.TWENTY_API_URL ??= remote.apiUrl ?? remote.url;
      process.env.TWENTY_API_KEY ??= remote.accessToken ?? remote.apiKey;
    }
  } catch {
    // Fall through to the explicit check below.
  }
};

/** Newest call date per person, from the calls already recorded in Twenty. */
const collectNewestCallPerPerson = async (
  client: CoreApiClient,
): Promise<Map<string, string>> => {
  const newest = new Map<string, string>();
  let after: string | null = null;
  let seen = 0;

  for (;;) {
    const args: { first: number; after?: string } = { first: 100 };
    if (after !== null) args.after = after;

    const { alloCalls } = await throttled(() =>
      client.query({
        alloCalls: {
          __args: args,
          pageInfo: { hasNextPage: true, endCursor: true },
          edges: { cursor: true, node: { personId: true, startedAt: true } },
        },
      }),
    );

    for (const edge of alloCalls?.edges ?? []) {
      seen += 1;
      const personId = edge?.node?.personId;
      const startedAt = edge?.node?.startedAt;

      if (typeof personId !== 'string' || typeof startedAt !== 'string') {
        continue;
      }

      const current = newest.get(personId);

      if (current === undefined || Date.parse(current) < Date.parse(startedAt)) {
        newest.set(personId, startedAt);
      }
    }

    if (!alloCalls?.pageInfo?.hasNextPage) break;
    after = alloCalls.pageInfo.endCursor ?? null;
    if (after === null) break;
  }

  console.log(`calls read: ${seen}, people with at least one call: ${newest.size}`);

  return newest;
};

const main = async (): Promise<void> => {
  loadDotEnv();
  loadTwentyCredentials();

  if (!process.env.TWENTY_API_URL || !process.env.TWENTY_API_KEY) {
    throw new Error(
      'Missing Twenty credentials: set TWENTY_API_URL and TWENTY_API_KEY, or configure a default remote.',
    );
  }

  console.log(apply ? '=== WRITING ===\n' : '=== DRY RUN, nothing written ===\n');

  const client = new CoreApiClient();
  const newest = await collectNewestCallPerPerson(client);

  let written = 0;
  let alreadyCurrent = 0;
  let missing = 0;

  for (const [personId, startedAt] of newest) {
    const { people } = await throttled(() =>
      client.query({
        people: {
          __args: { filter: { id: { eq: personId } }, first: 1 },
          edges: { node: { id: true, lastAlloCallAt: true } },
        },
      }),
    );

    const person = people?.edges?.[0]?.node;

    if (!person?.id) {
      missing += 1;
      console.warn(`  person ${personId} not found`);
      continue;
    }

    const current =
      typeof person.lastAlloCallAt === 'string' ? person.lastAlloCallAt : null;

    if (current !== null && Date.parse(current) >= Date.parse(startedAt)) {
      alreadyCurrent += 1;
      continue;
    }

    if (apply) {
      await throttled(() =>
        client.mutation({
          updatePerson: {
            __args: { id: personId, data: { lastAlloCallAt: startedAt } },
            id: true,
          },
        }),
      );
    }

    written += 1;
  }

  console.log(
    `\n${apply ? 'written' : 'to write'}: ${written}, already current: ${alreadyCurrent}, person missing: ${missing}`,
  );
};

await main();
