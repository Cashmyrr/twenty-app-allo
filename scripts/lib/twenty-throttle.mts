// Twenty enforces 100 requests per 60s. A backfill does one write per call, so
// it blows through that instantly without pacing. This keeps a safe minimum
// interval and retries the rejections the limiter still produces.

const MIN_INTERVAL_MS = 700; // ~85 req/min, under the 100/60s ceiling
const MAX_ATTEMPTS = 6;

let nextSlot = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const isRateLimited = (error: unknown): boolean =>
  /limit reached|rate limit|429/i.test(
    error instanceof Error ? error.message : String(error),
  );

/** Serialises and paces every Twenty request, retrying on rate-limit rejections. */
// `T | Promise<T>` rather than `Promise<T>`: until `yarn twenty dev:build`
// generates the client, `query` returns `any`, which `Promise<T>` would narrow
// to `unknown`.
export const throttled = async <T,>(
  operation: () => T | Promise<T>,
): Promise<Awaited<T>> => {
  for (let attempt = 1; ; attempt += 1) {
    const wait = Math.max(0, nextSlot - Date.now());
    if (wait > 0) await sleep(wait);
    nextSlot = Date.now() + MIN_INTERVAL_MS;

    try {
      return await operation();
    } catch (error) {
      if (!isRateLimited(error) || attempt >= MAX_ATTEMPTS) throw error;

      // The window is 60s, so back off into the next one rather than spinning.
      const backoff = Math.min(60_000, 5_000 * 2 ** (attempt - 1));
      console.log(`  rate limited, waiting ${Math.round(backoff / 1000)}s...`);
      await sleep(backoff);
      nextSlot = Date.now() + MIN_INTERVAL_MS;
    }
  }
};
