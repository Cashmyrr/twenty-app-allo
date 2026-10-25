import { AlloApiError } from 'src/logic-functions/utils/allo-webhooks-api';

/** A message an admin can act on, shown in the settings tab. */
export const describeAlloError = (error: unknown): string => {
  if (
    error instanceof AlloApiError &&
    (error.status === 401 || error.status === 403)
  ) {
    return 'Allo refused the API key. Check that it is valid and has the WEBHOOKS_READ_WRITE scope.';
  }

  if (error instanceof AlloApiError && error.status === 429) {
    return 'Allo is rate limiting this key. Try again in a moment.';
  }

  return error instanceof Error ? error.message : 'Could not reach Allo.';
};
