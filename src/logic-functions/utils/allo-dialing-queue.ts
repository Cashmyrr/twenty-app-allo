export type DialerNumber = {
  number: string;
  name?: string;
  last_name?: string;
  company?: string;
  website?: string;
  job_title?: string;
  emails?: string[];
};

export type AppendResult =
  | {
      ok: true;
      added: number;
      skipped: number;
      /** Skipped numbers counted by Allo's reason, e.g. INVALID_PHONE_NUMBER. */
      skippedReasons: Record<string, number>;
    }
  | { ok: false; status: number; error: string };

type AppendInput = {
  baseUrl: string;
  apiKey: string;
  email: string;
  numbers: DialerNumber[];
};

/**
 * POST /v2/api/dialing-queues/current/numbers
 *
 * Appends to the queue of the user identified by `email`. Allo answers with what
 * it added and what it skipped, and a number it refuses (INVALID_PHONE_NUMBER)
 * is reported rather than treated as a failure: one bad number in the CRM must
 * not cost the other 230 their place in the queue.
 *
 * Docs: https://help.withallo.com/en/v2/api-reference/dialing-queues
 */
export const appendToDialingQueue = async ({
  baseUrl,
  apiKey,
  email,
  numbers,
}: AppendInput): Promise<AppendResult> => {
  let response: Response;

  try {
    response = await fetch(`${baseUrl}/v2/api/dialing-queues/current/numbers`, {
      method: 'POST',
      headers: {
        authorization: `Api-Key ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ numbers, email }),
    });
  } catch (error) {
    return {
      ok: false,
      status: 502,
      error: `Allo unreachable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const text = await response.text();

  if (!response.ok) {
    // 403 here almost always means the API key lacks DIALING_QUEUE_READ_WRITE.
    return {
      ok: false,
      status: response.status,
      error: `Allo answered ${response.status}: ${text.slice(0, 300)}`,
    };
  }

  let payload: {
    data?: { added?: unknown[]; skipped?: { reason?: unknown }[] };
  } | null = null;

  try {
    payload = JSON.parse(text);
  } catch {
    return { ok: false, status: 502, error: 'Allo returned a non-JSON body' };
  }

  const skipped = Array.isArray(payload?.data?.skipped)
    ? payload.data.skipped
    : [];
  const skippedReasons: Record<string, number> = {};

  for (const item of skipped) {
    const reason = typeof item?.reason === 'string' ? item.reason : 'UNKNOWN';

    skippedReasons[reason] = (skippedReasons[reason] ?? 0) + 1;
  }

  return {
    ok: true,
    added: Array.isArray(payload?.data?.added) ? payload.data.added.length : 0,
    skipped: skipped.length,
    skippedReasons,
  };
};
