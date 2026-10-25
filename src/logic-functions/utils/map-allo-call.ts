import { buildAlloCallWebUrl } from 'src/constants/allo-api';
import {
  ALLO_CALL_DIRECTION_INBOUND,
  ALLO_CALL_DIRECTION_OUTBOUND,
  ALLO_CALL_STATUS_COMPLETED,
  ALLO_CALL_STATUS_IN_PROGRESS,
  ALLO_CALL_STATUS_RINGING,
  isAlloCallResult,
} from 'src/constants/allo-call-values';
import {
  type AlloCallCompletedData,
  type AlloCallLifecycleData,
  type AlloCallTopic,
  type AlloPerson,
} from 'src/types/allo-webhook.type';

export type AlloCallDirection =
  | typeof ALLO_CALL_DIRECTION_INBOUND
  | typeof ALLO_CALL_DIRECTION_OUTBOUND;

/**
 * Finds the record of the same call when the exact correlation key misses:
 * same contact and Allo numbers, started within a window. `target` says which
 * kind of record the other side of the call created.
 */
export type NearbyCallMatch = {
  contactNumber: string;
  alloNumber: string;
  startedFrom: string;
  startedTo: string;
  /**
   * `lifecycle-record`: built by call.received/triggered/answered, so it has no
   * Allo id and is not completed yet. `completed-record`: created by a
   * call.completed that arrived first.
   */
  target: 'lifecycle-record' | 'completed-record';
};

/** Everything the webhook needs to find, create and update the Twenty record. */
export type MappedAlloCall = {
  /** Fields to write on the Allo call record. Links are added separately. */
  fields: Record<string, unknown>;
  /** Present only from call.completed. */
  alloCallId: string | null;
  /**
   * Stable across call.received, call.triggered and call.answered. Null if the
   * payload is unusable.
   */
  correlationKey: string | null;
  /** Null when the payload lacks a number or a start time. */
  nearbyMatch: NearbyCallMatch | null;
  /** Fields an update must leave as they are on an existing record. */
  keepExistingFields: string[];
  direction: AlloCallDirection | null;
  /** The number on the other end: what we resolve the Person link from. */
  contactNumber: string | null;
  userEmail: string | null;
  alloPerson: AlloPerson | null;
};

/**
 * Numbers reach us in E.164 but not always identically formatted (spaces,
 * dashes). Normalising to `+` plus digits keeps the correlation key stable
 * across the four events of one call.
 */
export const normalizePhoneNumber = (
  value: string | null | undefined,
): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const digits = value.replace(/[^\d]/g, '');

  if (digits.length === 0) {
    return null;
  }

  return `+${digits}`;
};

/** Normalises to an ISO instant so `14:30:00` and `14:30:00.000Z` agree. */
export const normalizeTimestamp = (
  value: string | null | undefined,
): string | null => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

/**
 * Only call.completed carries Allo's call ID, so the earlier events are matched
 * on the triple that Allo keeps identical across them: the two numbers and the
 * moment the call started ringing. call.completed does not share it: on an
 * answered call its `start_date` is the answer time, to the second. That side
 * is matched with `NearbyCallMatch`.
 */
export const buildCorrelationKey = ({
  fromNumber,
  toNumber,
  startedAt,
}: {
  fromNumber: string | null;
  toNumber: string | null;
  startedAt: string | null;
}): string | null => {
  if (!fromNumber || !toNumber || !startedAt) {
    return null;
  }

  return `${fromNumber}|${toNumber}|${startedAt}`;
};

const asIsoOrNull = (value: string | null): string | null => value;

// How far call.completed's start_date can sit from the ring start: the ring,
// plus any IVR or queue. Narrow enough that a redial gets its own record.
const NEARBY_CALL_WINDOW_MS = 10 * 60_000;
// start_date is truncated to the second; the ring start has milliseconds.
const TIMESTAMP_SLACK_MS = 5_000;

const shiftIso = (iso: string, ms: number): string =>
  new Date(new Date(iso).getTime() + ms).toISOString();

const buildNearbyMatch = ({
  side,
  contactNumber,
  alloNumber,
  startedAt,
}: {
  side: 'lifecycle' | 'completed';
  contactNumber: string | null;
  alloNumber: string | null;
  startedAt: string | null;
}): NearbyCallMatch | null => {
  if (!contactNumber || !alloNumber || !startedAt) {
    return null;
  }

  // call.completed starts at or after the ring start, so it looks back for the
  // ringing record; a late ring event looks forward for the completed one.
  return side === 'completed'
    ? {
        contactNumber,
        alloNumber,
        startedFrom: shiftIso(startedAt, -NEARBY_CALL_WINDOW_MS),
        startedTo: shiftIso(startedAt, TIMESTAMP_SLACK_MS),
        target: 'lifecycle-record',
      }
    : {
        contactNumber,
        alloNumber,
        startedFrom: shiftIso(startedAt, -TIMESTAMP_SLACK_MS),
        startedTo: shiftIso(startedAt, NEARBY_CALL_WINDOW_MS),
        target: 'completed-record',
      };
};

const nonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

const buildPersonDisplayName = (person: AlloPerson | null): string | null => {
  if (!person) {
    return null;
  }

  const parts = [person.name, person.last_name]
    .map((part) => nonEmptyString(part))
    .filter((part): part is string => part !== null);

  return parts.length > 0 ? parts.join(' ') : null;
};

const buildCallName = ({
  direction,
  counterpartName,
  contactNumber,
}: {
  direction: AlloCallDirection | null;
  counterpartName: string | null;
  contactNumber: string | null;
}): string => {
  const prefix =
    direction === ALLO_CALL_DIRECTION_OUTBOUND
      ? 'Outbound call to'
      : direction === ALLO_CALL_DIRECTION_INBOUND
        ? 'Inbound call from'
        : 'Call with';

  return `${prefix} ${counterpartName ?? contactNumber ?? 'unknown number'}`;
};

/**
 * `call.received` and `call.triggered` carry no `direction`, but the topic tells
 * us: Allo received the call, or Allo triggered it.
 */
const resolveDirection = (
  topic: AlloCallTopic,
  raw: string | null | undefined,
): AlloCallDirection | null => {
  const normalized = nonEmptyString(raw)?.toUpperCase();

  if (
    normalized === ALLO_CALL_DIRECTION_INBOUND ||
    normalized === ALLO_CALL_DIRECTION_OUTBOUND
  ) {
    return normalized;
  }

  if (topic === 'call.received') {
    return ALLO_CALL_DIRECTION_INBOUND;
  }

  if (topic === 'call.triggered') {
    return ALLO_CALL_DIRECTION_OUTBOUND;
  }

  return null;
};

/** On an inbound call the contact is the caller; on an outbound one, the callee. */
const resolveContactNumber = ({
  direction,
  fromNumber,
  toNumber,
}: {
  direction: AlloCallDirection | null;
  fromNumber: string | null;
  toNumber: string | null;
}): string | null =>
  direction === ALLO_CALL_DIRECTION_OUTBOUND ? toNumber : fromNumber;

const resolveAlloNumber = ({
  direction,
  fromNumber,
  toNumber,
}: {
  direction: AlloCallDirection | null;
  fromNumber: string | null;
  toNumber: string | null;
}): string | null =>
  direction === ALLO_CALL_DIRECTION_OUTBOUND ? fromNumber : toNumber;

const mapLifecycleEvent = (
  topic: Exclude<AlloCallTopic, 'call.completed'>,
  data: AlloCallLifecycleData,
): MappedAlloCall => {
  const fromNumber = normalizePhoneNumber(data.from_number);
  const toNumber = normalizePhoneNumber(data.to_number);
  const startedAt = normalizeTimestamp(data.started_at);
  const answeredAt = normalizeTimestamp(data.answered_at);
  const direction = resolveDirection(topic, data.direction);
  const contactNumber = resolveContactNumber({
    direction,
    fromNumber,
    toNumber,
  });
  const alloPerson = data.person ?? null;
  const counterpartName = buildPersonDisplayName(alloPerson);

  const fields: Record<string, unknown> = {
    name: buildCallName({ direction, counterpartName, contactNumber }),
    startedAt: asIsoOrNull(startedAt),
    fromNumber,
    toNumber,
    contactNumber,
    alloNumber: resolveAlloNumber({ direction, fromNumber, toNumber }),
    userEmail: nonEmptyString(data.user_email),
    alloPersonId: nonEmptyString(alloPerson?.id),
    // Ringing until answered; call.completed decides the final state.
    status:
      topic === 'call.answered'
        ? ALLO_CALL_STATUS_IN_PROGRESS
        : ALLO_CALL_STATUS_RINGING,
  };

  if (direction) {
    fields.direction = direction;
  }

  if (answeredAt) {
    fields.answeredAt = answeredAt;
  }

  if (counterpartName) {
    // Fill whichever side the contact is on, so the record reads correctly even
    // before call.completed sends Allo's own from_name/to_name.
    if (direction === ALLO_CALL_DIRECTION_OUTBOUND) {
      fields.toName = counterpartName;
    } else {
      fields.fromName = counterpartName;
    }
  }

  return {
    fields,
    alloCallId: null,
    correlationKey: buildCorrelationKey({ fromNumber, toNumber, startedAt }),
    nearbyMatch: buildNearbyMatch({
      side: 'lifecycle',
      contactNumber,
      alloNumber: fields.alloNumber as string | null,
      startedAt,
    }),
    // The ring start and the contact's name come from these events.
    keepExistingFields: [],
    direction,
    contactNumber,
    userEmail: nonEmptyString(data.user_email),
    alloPerson,
  };
};

const mapCompletedEvent = (data: AlloCallCompletedData): MappedAlloCall => {
  const fromNumber = normalizePhoneNumber(data.from_number);
  // call.completed names the recipient `to`, not `to_number`.
  const toNumber = normalizePhoneNumber(data.to);
  const startedAt = normalizeTimestamp(data.start_date);
  const direction = resolveDirection('call.completed', data.type);
  const contactNumber = resolveContactNumber({
    direction,
    fromNumber,
    toNumber,
  });

  const durationSeconds =
    typeof data.length_in_minutes === 'number' &&
    Number.isFinite(data.length_in_minutes)
      ? Math.round(data.length_in_minutes * 60)
      : null;

  const endedAt =
    startedAt !== null && durationSeconds !== null
      ? new Date(
          new Date(startedAt).getTime() + durationSeconds * 1000,
        ).toISOString()
      : null;

  const recordingUrl = nonEmptyString(data.recording_url);
  const transcript =
    nonEmptyString(data.concatenated_transcript) ??
    buildTranscriptFromEntries(data.transcriptions);

  // Allo sends `tag` (primary) and `tags` (all); `tags` supersedes it.
  const tags =
    Array.isArray(data.tags) && data.tags.length > 0
      ? data.tags.filter((tag): tag is string => typeof tag === 'string')
      : nonEmptyString(data.tag)
        ? [data.tag as string]
        : null;

  const hasTransferDetails =
    hasAnyTransferValue(data.transfer_from) ||
    hasAnyTransferValue(data.transfer_to) ||
    nonEmptyString(data.transfer_original_call_id) !== null;

  const fields: Record<string, unknown> = {
    name: buildCallName({
      direction,
      counterpartName:
        direction === ALLO_CALL_DIRECTION_OUTBOUND
          ? nonEmptyString(data.to_name)
          : nonEmptyString(data.from_name),
      contactNumber,
    }),
    alloCallId: nonEmptyString(data.id),
    alloLink: nonEmptyString(data.id)
      ? {
          primaryLinkUrl: buildAlloCallWebUrl(data.id as string),
          primaryLinkLabel: 'Open in Allo',
        }
      : null,
    startedAt: asIsoOrNull(startedAt),
    endedAt,
    durationSeconds,
    durationLabel: nonEmptyString(data.length),
    fromNumber,
    fromName: nonEmptyString(data.from_name),
    toNumber,
    toName: nonEmptyString(data.to_name),
    contactNumber,
    alloNumber: resolveAlloNumber({ direction, fromNumber, toNumber }),
    status: ALLO_CALL_STATUS_COMPLETED,
    summary: nonEmptyString(data.summary),
    transcript,
    transcriptEntries: Array.isArray(data.transcriptions)
      ? data.transcriptions
      : null,
    recording: recordingUrl
      ? { primaryLinkUrl: recordingUrl, primaryLinkLabel: 'Recording' }
      : null,
    tags,
    dataCollected:
      data.data_collected && Object.keys(data.data_collected).length > 0
        ? data.data_collected
        : null,
    ivrResult:
      Array.isArray(data.ivr_result) && data.ivr_result.length > 0
        ? data.ivr_result
        : null,
    transfer: hasTransferDetails
      ? {
          from: data.transfer_from ?? null,
          to: data.transfer_to ?? null,
          originalCallId: nonEmptyString(data.transfer_original_call_id),
          originalToNumber: nonEmptyString(data.original_to_number),
          originalToName: nonEmptyString(data.original_to_name),
        }
      : null,
    userEmail: nonEmptyString(data.user_email),
  };

  if (direction) {
    fields.direction = direction;
  }

  if (isAlloCallResult(data.result)) {
    fields.result = data.result;
  }

  return {
    fields,
    alloCallId: nonEmptyString(data.id),
    correlationKey: buildCorrelationKey({ fromNumber, toNumber, startedAt }),
    nearbyMatch: buildNearbyMatch({
      side: 'completed',
      contactNumber,
      alloNumber: fields.alloNumber as string | null,
      startedAt,
    }),
    // On a record the ring events created, their start time is the ring start
    // and their name carries the contact's name, which call.completed often
    // leaves out.
    keepExistingFields: ['name', 'startedAt'],
    direction,
    contactNumber,
    userEmail: nonEmptyString(data.user_email),
    // call.completed has no `person` object; the Person link is resolved from
    // the contact number alone.
    alloPerson: null,
  };
};

const hasAnyTransferValue = (
  transfer: { number?: string | null; user_email?: string | null; user_name?: string | null } | null | undefined,
): boolean =>
  transfer !== null &&
  transfer !== undefined &&
  [transfer.number, transfer.user_email, transfer.user_name].some(
    (value) => nonEmptyString(value) !== null,
  );

const buildTranscriptFromEntries = (
  entries: AlloCallCompletedData['transcriptions'],
): string | null => {
  if (!Array.isArray(entries) || entries.length === 0) {
    return null;
  }

  const lines = entries
    .map((entry) => {
      const text = nonEmptyString(entry?.text);

      if (!text) {
        return null;
      }

      const speaker = entry?.source === 'USER' ? 'Agent' : 'Contact';

      return `${speaker}: ${text}`;
    })
    .filter((line): line is string => line !== null);

  return lines.length > 0 ? lines.join('\n') : null;
};

export const mapAlloCall = (
  topic: AlloCallTopic,
  data: AlloCallLifecycleData | AlloCallCompletedData,
): MappedAlloCall =>
  topic === 'call.completed'
    ? mapCompletedEvent(data as AlloCallCompletedData)
    : mapLifecycleEvent(topic, data as AlloCallLifecycleData);
