// Minimal Allo v2 REST client for the one-shot backfill.
// Docs: https://help.withallo.com/en/v2/api-reference

const ALLO_BASE_URL = process.env.ALLO_API_URL ?? 'https://api.withallo.com';

// Documented limits: 20 read req/s, 5 write req/s per key. We only read, and we
// stay well under by serialising requests with a small delay.
const READ_DELAY_MS = 120;

export type AlloApiCallItem = {
  id?: string | null;
  type?: string | null;
  direction?: string | null;
  allo_number?: string | null;
  contact_number?: string | null;
  contacts?: { id?: string | null; name?: string | null }[] | null;
  user?: { id?: string | null; name?: string | null; email?: string | null } | null;
  date?: string | null;
  duration?: number | null;
  result?: string | null;
  recording_url?: string | null;
  summary?: string | null;
  tags?: string[] | null;
  transcript?: { source?: string | null; time?: string | null; text?: string | null }[] | null;
};

type SearchResponse = {
  data?: AlloApiCallItem[];
  pagination?: {
    page?: number;
    size?: number;
    total_count?: number;
    has_more?: boolean;
  };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class AlloApi {
  private requestCount = 0;
  private readonly apiKey: string;

  // A plain field rather than a parameter property: Node's type-stripping
  // runtime does not support parameter properties.
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  get requestsMade(): number {
    return this.requestCount;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    this.requestCount += 1;

    const res = await fetch(`${ALLO_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        // The scheme is `Api-Key`, not `Bearer`.
        authorization: `Api-Key ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Allo ${path} returned ${res.status} ${res.statusText}: ${text.slice(0, 300)}`,
      );
    }

    return (await res.json()) as T;
  }

  async me(): Promise<unknown> {
    this.requestCount += 1;

    const res = await fetch(`${ALLO_BASE_URL}/v2/api/me`, {
      headers: { authorization: `Api-Key ${this.apiKey}` },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Allo /v2/api/me returned ${res.status} ${res.statusText}: ${text.slice(0, 300)}`,
      );
    }

    return res.json();
  }

  /** Every CALL item for one contact number, across all pages. */
  async listCallsForNumber(contactNumber: string): Promise<AlloApiCallItem[]> {
    const items: AlloApiCallItem[] = [];
    let page = 1;

    // Pace every request, not just the paged ones, so a long run of
    // single-page numbers cannot burst past the documented 20 read req/s.
    await sleep(READ_DELAY_MS);

    for (;;) {
      const body = await this.post<SearchResponse>(
        '/v2/api/conversations/items/search',
        {
          contact_number: contactNumber,
          type: 'CALL',
          extend: 'transcript',
          page,
          size: 100,
        },
      );

      items.push(...(body.data ?? []));

      if (!body.pagination?.has_more) {
        return items;
      }

      page += 1;
      await sleep(READ_DELAY_MS);
    }
  }
}
