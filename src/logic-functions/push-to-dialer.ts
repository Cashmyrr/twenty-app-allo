import { CoreApiClient } from 'twenty-client-sdk/core';
import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import {
  type LogicFunctionExecutionContext,
  Response,
} from 'twenty-sdk/logic-function';

import {
  ALLO_API_BASE_URL,
  ALLO_API_KEY_ENV_VAR_NAME,
  PUSH_TO_DIALER_ROUTE_PATH,
} from 'src/constants/allo-api';
import { PUSH_TO_DIALER_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import {
  appendToDialingQueue,
  type DialerNumber,
} from 'src/logic-functions/utils/allo-dialing-queue';
import { fetchSelectedPeople } from 'src/logic-functions/utils/fetch-selected-people';
import { toE164 } from 'src/logic-functions/utils/to-e164';

/** One Allo request per send; large enough for a day of calling. */
export const MAX_PEOPLE = 500;

export type PushToDialerBody = {
  personIds?: unknown;
  filter?: unknown;
};

export type PushToDialerResult = {
  selected: number;
  added: number;
  skippedByAllo: number;
  withoutNumber: number;
  notFound: number;
};

/**
 * The SDK's `Response`, not the browser one. The runtime recognises an HTTP
 * response by its `__twentyHttpResponse` marker: returning a global `Response`
 * serialises to `{}` and the caller gets an empty body with no error at all.
 */
const jsonResponse = (body: unknown, status: number): Response =>
  new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  });

const readPersonIds = (body: PushToDialerBody): string[] => {
  if (!Array.isArray(body.personIds)) return [];

  return [
    ...new Set(
      body.personIds.filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      ),
    ),
  ];
};

const readFilter = (body: PushToDialerBody): Record<string, unknown> | null =>
  body.filter !== null &&
  typeof body.filter === 'object' &&
  !Array.isArray(body.filter)
    ? (body.filter as Record<string, unknown>)
    : null;

/**
 * Pushes a selection of people into the caller's own Allo Power Dialer queue.
 *
 * The Allo browser extension scrapes the page: it sees every number rendered in
 * the DOM, not the view's filter and not the selection. Reading the selection
 * server-side and calling Allo's API removes that guesswork.
 *
 * Runs as the caller (`isAuthRequired`, plain `CoreApiClient`), so a member can
 * only queue people they are allowed to read. The queue is the caller's, found
 * from their own workspace member email, never from a client-supplied id.
 */
export const pushToDialerHandler = async (
  event: RoutePayload<PushToDialerBody>,
  context: LogicFunctionExecutionContext,
): Promise<Response> => {
  const apiKey = process.env[ALLO_API_KEY_ENV_VAR_NAME]?.trim();

  if (!apiKey) {
    return jsonResponse({ error: 'Allo API key not configured' }, 500);
  }

  const body: PushToDialerBody =
    event?.body !== null && typeof event?.body === 'object' ? event.body : {};
  const personIds = readPersonIds(body);
  const filter = readFilter(body);

  if (personIds.length === 0 && filter === null) {
    return jsonResponse({ error: 'No person selected' }, 400);
  }

  if (!context?.workspaceMemberId) {
    return jsonResponse({ error: 'Caller is not a workspace member' }, 403);
  }

  const client = new CoreApiClient();

  // Whose queue. Refuse rather than fall through: without an email Allo would
  // fill the API key owner's queue, which is somebody else's.
  const { workspaceMembers } = await client.query({
    workspaceMembers: {
      __args: { filter: { id: { eq: context.workspaceMemberId } }, first: 1 },
      edges: { node: { id: true, userEmail: true } },
    },
  });

  const callerEmail = workspaceMembers?.edges?.[0]?.node?.userEmail;

  if (typeof callerEmail !== 'string' || callerEmail.length === 0) {
    return jsonResponse({ error: 'Caller has no workspace member email' }, 403);
  }

  const selection = await fetchSelectedPeople(client, {
    personIds,
    filter,
    limit: MAX_PEOPLE,
  });

  if (!selection.ok) {
    return jsonResponse(
      { error: `Too many people selected (max ${selection.limit})` },
      400,
    );
  }

  const numbers: DialerNumber[] = [];
  let withoutNumber = 0;

  for (const person of selection.people) {
    const e164 = toE164(person.phones ?? {});

    if (e164 === null) {
      withoutNumber += 1;
      continue;
    }

    numbers.push({
      number: e164,
      name: person.name?.firstName ?? undefined,
      last_name: person.name?.lastName ?? undefined,
      company: person.company?.name ?? undefined,
      website: person.company?.domainName?.primaryLinkUrl ?? undefined,
      job_title: person.jobTitle ?? undefined,
      emails: person.emails?.primaryEmail
        ? [person.emails.primaryEmail]
        : undefined,
    });
  }

  // Ids the caller sent but cannot read, or that no longer exist.
  const notFound =
    personIds.length > 0 ? personIds.length - selection.people.length : 0;
  const selected = personIds.length > 0 ? personIds.length : selection.people.length;

  if (numbers.length === 0) {
    return jsonResponse(
      {
        error: 'None of the selected people has a phone number',
        withoutNumber,
        notFound,
      },
      422,
    );
  }

  const result = await appendToDialingQueue({
    baseUrl: ALLO_API_BASE_URL,
    apiKey,
    email: callerEmail,
    numbers,
  });

  if (!result.ok) {
    console.error(`[allo] dialing queue append failed: ${result.error}`);

    return jsonResponse({ error: result.error }, result.status);
  }

  console.log(
    `[allo] queued ${result.added} number(s), ${result.skipped} skipped by Allo, ${withoutNumber} without a number, ${notFound} not found`,
  );

  const response: PushToDialerResult = {
    selected,
    added: result.added,
    skippedByAllo: result.skipped,
    withoutNumber,
    notFound,
  };

  return jsonResponse(response, 200);
};

export default defineLogicFunction({
  universalIdentifier: PUSH_TO_DIALER_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'push-to-dialer',
  description:
    "Appends the selected people's phone numbers to the caller's Allo Power Dialer queue.",
  timeoutSeconds: 60,
  handler: pushToDialerHandler,
  httpRouteTriggerSettings: {
    path: PUSH_TO_DIALER_ROUTE_PATH,
    httpMethod: 'POST',
    isAuthRequired: true,
  },
});
