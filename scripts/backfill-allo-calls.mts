/**
 * One-shot backfill of historical Allo calls into Twenty.
 *
 * Scope: every call Allo holds for a phone number that already exists on a
 * Person in the CRM. Numbers unknown to the CRM are not fetched.
 *
 * Deduplication is free: the API returns the same call id the webhooks use, and
 * the upsert matches on `alloCallId`, so a call already recorded is updated
 * rather than duplicated. Re-running the script is safe.
 *
 * Three modes, deliberately staged so nothing is spent by accident:
 *
 *   (no flag)   Count the CRM numbers and estimate the Allo requests.
 *               Reads Twenty only. Zero Allo API calls.
 *   --fetch     Query Allo and report what would be written, including every
 *               distinct tag seen. No writes to Twenty.
 *   --apply     Same as --fetch, then write.
 *
 * Usage:
 *   node scripts/backfill-allo-calls.mts
 *   node scripts/backfill-allo-calls.mts --fetch
 *   node scripts/backfill-allo-calls.mts --apply
 *
 * Credentials: ALLO_API_KEY from .env; Twenty from TWENTY_API_URL and
 * TWENTY_API_KEY, falling back to the default remote in ~/.twenty/config.json.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { CoreApiClient } from 'twenty-client-sdk/core';

import { AlloApi } from './lib/allo-api.mts';
import { mapApiCall } from './lib/map-api-call.mts';
import { throttled } from './lib/twenty-throttle.mts';

type Mode = 'estimate' | 'fetch' | 'apply';

const mode: Mode = process.argv.includes('--apply')
  ? 'apply'
  : process.argv.includes('--fetch')
    ? 'fetch'
    : 'estimate';

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

/** Twenty stores the national number and the calling code apart. */
const toE164 = (phone: {
  primaryPhoneNumber?: string | null;
  primaryPhoneCallingCode?: string | null;
}): string | null => {
  const national = (phone.primaryPhoneNumber ?? '').replace(/[^\d]/g, '');
  if (national.length === 0) return null;

  const calling = (phone.primaryPhoneCallingCode ?? '').replace(/[^\d]/g, '');

  return calling.length > 0 ? `+${calling}${national}` : `+${national}`;
};

type CrmNumber = { e164: string; personId: string; companyId: string | null };

const collectCrmNumbers = async (
  client: CoreApiClient,
): Promise<Map<string, CrmNumber>> => {
  const numbers = new Map<string, CrmNumber>();
  let after: string | null = null;

  for (;;) {
    // Explicitly annotated so the cursor's type does not flow back into the
    // query's inference, which TypeScript sees as circular.
    const args: { first: number; after?: string } = { first: 100 };
    if (after !== null) args.after = after;

    const { people } = await throttled(() => client.query({
      people: {
        __args: args,
        pageInfo: { hasNextPage: true, endCursor: true },
        edges: {
          cursor: true,
          node: {
            id: true,
            company: { id: true },
            phones: {
              primaryPhoneNumber: true,
              primaryPhoneCallingCode: true,
              additionalPhones: { number: true, callingCode: true },
            },
          },
        },
      },
    }));

    for (const edge of people?.edges ?? []) {
      const node = edge?.node;
      if (!node?.id) continue;

      const primary = toE164(node.phones ?? {});

      if (primary && !numbers.has(primary)) {
        numbers.set(primary, {
          e164: primary,
          personId: node.id,
          companyId: node.company?.id ?? null,
        });
      }

      const extra = node.phones?.additionalPhones;
      if (Array.isArray(extra)) {
        for (const entry of extra) {
          const e164 = toE164({
            primaryPhoneNumber: entry?.number,
            primaryPhoneCallingCode: entry?.callingCode,
          });
          if (e164 && !numbers.has(e164)) {
            numbers.set(e164, {
              e164,
              personId: node.id,
              companyId: node.company?.id ?? null,
            });
          }
        }
      }
    }

    if (!people?.pageInfo?.hasNextPage) break;
    after = people.pageInfo.endCursor ?? null;
    if (!after) break;
  }

  return numbers;
};

const findMemberIdByEmail = async (
  client: CoreApiClient,
  cache: Map<string, string | null>,
  email: string | null,
): Promise<string | null> => {
  if (!email) return null;
  if (cache.has(email)) return cache.get(email) ?? null;

  const { workspaceMembers } = await throttled(() =>
    client.query({
      workspaceMembers: {
        // `_` and `%` are ilike wildcards, and `_` is common in emails.
        __args: {
          filter: { userEmail: { ilike: email.replace(/[\\%_]/g, '\\$&') } },
          first: 1,
        },
        edges: { node: { id: true } },
      },
    }),
  );

  const id = workspaceMembers?.edges?.[0]?.node?.id ?? null;
  cache.set(email, id);

  return id;
};

/**
 * Every Allo call id already in Twenty, in one paged sweep. Doing this up front
 * turns the per-call lookup into a map hit, halving the number of Twenty
 * requests the run needs and keeping it inside the rate limit.
 */
const loadExistingCallIds = async (
  client: CoreApiClient,
): Promise<Map<string, string>> => {
  const existing = new Map<string, string>();
  let after: string | null = null;

  for (;;) {
    const args: { first: number; after?: string } = { first: 100 };
    if (after !== null) args.after = after;

    const { alloCalls } = await throttled(() =>
      client.query({
        alloCalls: {
          __args: args,
          pageInfo: { hasNextPage: true, endCursor: true },
          edges: { node: { id: true, alloCallId: true } },
        },
      }),
    );

    for (const edge of alloCalls?.edges ?? []) {
      const node = edge?.node;
      if (node?.id && node.alloCallId) existing.set(node.alloCallId, node.id);
    }

    if (!alloCalls?.pageInfo?.hasNextPage) break;
    after = alloCalls.pageInfo.endCursor ?? null;
    if (!after) break;
  }

  return existing;
};

const upsert = async (
  client: CoreApiClient,
  existing: Map<string, string>,
  alloCallId: string,
  data: Record<string, unknown>,
): Promise<'created' | 'updated'> => {
  const clean = Object.fromEntries(
    Object.entries(data).filter(([, v]) => v !== null && v !== undefined),
  );

  const recordId = existing.get(alloCallId);

  if (recordId) {
    await throttled(() =>
      client.mutation({
        updateAlloCall: { __args: { id: recordId, data: clean }, id: true },
      }),
    );
    return 'updated';
  }

  const result = await throttled(() =>
    client.mutation({ createAlloCall: { __args: { data: clean }, id: true } }),
  );

  // Remember it, so a duplicate id later in the run updates instead of creating.
  const newId = result?.createAlloCall?.id;
  if (newId) existing.set(alloCallId, newId);

  return 'created';
};

const main = async (): Promise<void> => {
  loadDotEnv();
  loadTwentyCredentials();

  if (!process.env.TWENTY_API_URL || !process.env.TWENTY_API_KEY) {
    throw new Error(
      'Twenty credentials missing. Set TWENTY_API_URL and TWENTY_API_KEY, or run `yarn twenty remote:add`.',
    );
  }

  // The client captures its environment at import time, which happens before
  // the credentials above are loaded, so they are passed explicitly.
  const client = new CoreApiClient({
    url: `${process.env.TWENTY_API_URL}/graphql`,
    headers: { authorization: `Bearer ${process.env.TWENTY_API_KEY}` },
  });

  console.log(`Mode: ${mode}`);
  console.log(`Twenty: ${process.env.TWENTY_API_URL}`);
  console.log('Collecting phone numbers from the CRM...');

  const crmNumbers = await collectCrmNumbers(client);

  console.log(`  ${crmNumbers.size} distinct phone numbers on Person records.`);

  if (mode === 'estimate') {
    console.log('');
    console.log('Estimated Allo API requests:');
    console.log(`  at least ${crmNumbers.size} (one search page per number),`);
    console.log('  plus one extra page per number with more than 100 calls.');
    console.log(`  At 20 read req/s the floor is ~${Math.ceil(crmNumbers.size / 20)}s of API time.`);
    console.log('');
    console.log('No Allo request was made. Re-run with --fetch to query Allo');
    console.log('without writing, then --apply to write.');
    return;
  }

  const alloApiKey = process.env.ALLO_API_KEY;

  if (!alloApiKey) {
    throw new Error('ALLO_API_KEY missing. Put it in .env.');
  }

  const allo = new AlloApi(alloApiKey);

  console.log('Verifying the Allo key...');
  await allo.me();
  console.log('  key accepted.');

  console.log('Loading Allo call ids already in Twenty...');
  const existingCalls = await loadExistingCallIds(client);
  console.log(`  ${existingCalls.size} already recorded.`);

  const memberCache = new Map<string, string | null>();
  const tagCounts = new Map<string, number>();
  let calls = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const failures: string[] = [];

  let index = 0;

  for (const crm of crmNumbers.values()) {
    index += 1;

    let items;
    try {
      items = await allo.listCallsForNumber(crm.e164);
    } catch (error) {
      failures.push(`${crm.e164}: ${(error as Error).message}`);
      continue;
    }

    if (items.length === 0) continue;

    console.log(`[${index}/${crmNumbers.size}] ${crm.e164}: ${items.length} call(s)`);

    for (const item of items) {
      const mapped = mapApiCall(item);

      if (!mapped) {
        skipped += 1;
        continue;
      }

      calls += 1;
      for (const tag of mapped.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }

      if (mode !== 'apply') continue;

      try {
        const memberId = await findMemberIdByEmail(
          client,
          memberCache,
          mapped.userEmail,
        );

        const outcome = await upsert(client, existingCalls, mapped.alloCallId, {
          ...mapped.fields,
          ...(mapped.correlationKey
            ? { correlationKey: mapped.correlationKey }
            : {}),
          // The number came from this Person, so the link is known up front.
          personId: crm.personId,
          ...(crm.companyId ? { companyId: crm.companyId } : {}),
          ...(memberId ? { memberId } : {}),
        });

        if (outcome === 'created') created += 1;
        else updated += 1;
      } catch (error) {
        failures.push(`${mapped.alloCallId}: ${(error as Error).message}`);
      }
    }
  }

  console.log('');
  console.log('--- Summary ---');
  console.log(`Numbers queried:   ${crmNumbers.size}`);
  console.log(`Allo API requests: ${allo.requestsMade}`);
  console.log(`Calls found:       ${calls}`);
  console.log(`Calls unusable:    ${skipped}`);

  if (mode === 'apply') {
    console.log(`Records created:   ${created}`);
    console.log(`Records updated:   ${updated}`);
  } else {
    console.log('No write was performed. Re-run with --apply to write.');
  }

  console.log('');
  console.log('--- Tags seen ---');

  if (tagCounts.size === 0) {
    console.log('(none)');
  } else {
    for (const [tag, count] of [...tagCounts].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(count).padStart(5)}  ${tag}`);
    }
  }

  if (failures.length > 0) {
    console.log('');
    console.log(`--- ${failures.length} failure(s) ---`);
    for (const f of failures.slice(0, 20)) console.log(`  ${f}`);
    if (failures.length > 20) console.log(`  ... and ${failures.length - 20} more`);
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
