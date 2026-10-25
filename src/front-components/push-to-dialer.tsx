import { RestApiClient, RestApiClientError } from 'twenty-client-sdk/rest';
import {
  CommandModal,
  enqueueSnackbar,
  useSelectedRecordIds,
  useSelectedRecordsFilter,
} from 'twenty-sdk/front-component';

import { PUSH_TO_DIALER_ROUTE_PATH } from 'src/constants/allo-api';

type PushResult = {
  selected?: number;
  added?: number;
  skippedByAllo?: number;
  skippedReasons?: Record<string, number>;
  withoutNumber?: number;
  notFound?: number;
  error?: string;
};

/** Report what was dropped and why: a silent "done" hides who will not be called. */
export const formatPushResult = (result: PushResult): string => {
  const parts = [`${result.added ?? 0} queued`];

  if ((result.withoutNumber ?? 0) > 0) {
    parts.push(`${result.withoutNumber} without a number`);
  }

  const reasons = Object.entries(result.skippedReasons ?? {});

  if (reasons.length > 0) {
    for (const [reason, count] of reasons) {
      parts.push(
        reason === 'INVALID_PHONE_NUMBER'
          ? `${count} with an invalid number`
          : `${count} skipped by Allo (${reason})`,
      );
    }
  } else if ((result.skippedByAllo ?? 0) > 0) {
    parts.push(`${result.skippedByAllo} skipped by Allo`);
  }

  if ((result.notFound ?? 0) > 0) {
    parts.push(`${result.notFound} not found`);
  }

  return `Power Dialer: ${parts.join(', ')}.`;
};

const readErrorMessage = (error: unknown): string => {
  if (error instanceof RestApiClientError) {
    const body = error.body as PushResult | undefined;

    return body?.error ?? `Server answered ${error.status ?? 'an error'}`;
  }

  return `Could not reach the server: ${error instanceof Error ? error.message : String(error)}`;
};

export const PushToDialer = () => {
  const selectedRecordIds = useSelectedRecordIds();
  // Under "Select all" the ids are empty and the selection is the view's filter.
  const selectedRecordsFilter = useSelectedRecordsFilter();
  const isSelectAll = selectedRecordIds.length === 0;
  const count = selectedRecordIds.length;

  const execute = async (): Promise<void> => {
    try {
      const result = await new RestApiClient().post<PushResult>(
        `/s${PUSH_TO_DIALER_ROUTE_PATH}`,
        isSelectAll
          ? { filter: selectedRecordsFilter }
          : { personIds: selectedRecordIds },
      );

      await enqueueSnackbar({
        message: formatPushResult(result ?? {}),
        variant: 'success',
      });
    } catch (error) {
      await enqueueSnackbar({ message: readErrorMessage(error), variant: 'error' });
    }
  };

  return (
    <CommandModal
      title="Send to Power Dialer"
      subtitle={`${isSelectAll ? 'All matching people' : `${count} ${count === 1 ? 'person' : 'people'}`} will be appended to your Allo queue. People without a phone number are skipped.`}
      execute={execute}
      confirmButtonText="Send"
    />
  );
};

export default PushToDialer;
