// Maps an Allo REST call item onto the Allo Call record fields.
//
// The webhook and the API describe the same call differently: the API gives
// `duration` in seconds where the webhook gives `length_in_minutes`, nests the
// user email, states `contact_number`/`allo_number` instead of from/to, and
// exposes a narrower `result` enum. Both paths converge on the same record
// because they share Allo's call id.

import { type AlloApiCallItem } from './allo-api.mts';

const RESULT_VALUES = [
  'ANSWERED',
  'VOICEMAIL',
  'TRANSFERRED_AI',
  'TRANSFERRED_EXTERNAL',
  'BLOCKED',
  'FAILED',
] as const;

const nonEmpty = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

const normalizeNumber = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/[^\d]/g, '');
  return digits.length > 0 ? `+${digits}` : null;
};

const normalizeTimestamp = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Allo's own rendering, e.g. "5m 30s". Derived here since the API sends seconds. */
const formatDuration = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
};

export type MappedApiCall = {
  alloCallId: string;
  correlationKey: string | null;
  contactNumber: string | null;
  userEmail: string | null;
  tags: string[];
  fields: Record<string, unknown>;
};

export const mapApiCall = (item: AlloApiCallItem): MappedApiCall | null => {
  const alloCallId = nonEmpty(item.id);

  if (!alloCallId) {
    return null;
  }

  const direction = nonEmpty(item.direction)?.toUpperCase() ?? null;
  const isOutbound = direction === 'OUTBOUND';
  const contactNumber = normalizeNumber(item.contact_number);
  const alloNumber = normalizeNumber(item.allo_number);
  const startedAt = normalizeTimestamp(item.date);

  // Same from/to convention as the webhook, so the correlation key matches.
  const fromNumber = isOutbound ? alloNumber : contactNumber;
  const toNumber = isOutbound ? contactNumber : alloNumber;

  const durationSeconds =
    typeof item.duration === 'number' && Number.isFinite(item.duration)
      ? Math.round(item.duration)
      : null;

  const endedAt =
    startedAt !== null && durationSeconds !== null
      ? new Date(new Date(startedAt).getTime() + durationSeconds * 1000).toISOString()
      : null;

  const transcriptEntries = Array.isArray(item.transcript) ? item.transcript : null;

  const transcript =
    transcriptEntries && transcriptEntries.length > 0
      ? transcriptEntries
          .map((entry) => {
            const text = nonEmpty(entry?.text);
            if (!text) return null;
            return `${entry?.source === 'USER' ? 'Agent' : 'Contact'}: ${text}`;
          })
          .filter((line): line is string => line !== null)
          .join('\n')
      : null;

  const tags = Array.isArray(item.tags)
    ? item.tags.filter((t): t is string => typeof t === 'string')
    : [];

  const counterpartName = nonEmpty(item.contacts?.[0]?.name);
  const recordingUrl = nonEmpty(item.recording_url);
  const result = nonEmpty(item.result)?.toUpperCase();
  const userEmail = nonEmpty(item.user?.email);

  const fields: Record<string, unknown> = {
    name: `${isOutbound ? 'Outbound call to' : 'Inbound call from'} ${counterpartName ?? contactNumber ?? 'unknown number'}`,
    alloCallId,
    // Same link as the webhook builds (buildAlloCallWebUrl in src/constants).
    alloLink: alloCallId
      ? {
          primaryLinkUrl: `https://web.withallo.com/calls?callId=${encodeURIComponent(alloCallId)}`,
          primaryLinkLabel: 'Open in Allo',
        }
      : null,
    startedAt,
    endedAt,
    durationSeconds,
    durationLabel: durationSeconds !== null ? formatDuration(durationSeconds) : null,
    fromNumber,
    toNumber,
    contactNumber,
    alloNumber,
    // Backfilled calls are historical, so they are complete by definition.
    status: 'COMPLETED',
    summary: nonEmpty(item.summary),
    transcript,
    transcriptEntries,
    recording: recordingUrl
      ? { primaryLinkUrl: recordingUrl, primaryLinkLabel: 'Recording' }
      : null,
    tags: tags.length > 0 ? tags : null,
    userEmail,
    alloPersonId: nonEmpty(item.contacts?.[0]?.id),
  };

  if (direction === 'INBOUND' || direction === 'OUTBOUND') {
    fields.direction = direction;
  }

  if (result && (RESULT_VALUES as readonly string[]).includes(result)) {
    fields.result = result;
  }

  if (counterpartName) {
    fields[isOutbound ? 'toName' : 'fromName'] = counterpartName;
  }

  return {
    alloCallId,
    correlationKey:
      fromNumber && toNumber && startedAt
        ? `${fromNumber}|${toNumber}|${startedAt}`
        : null,
    contactNumber,
    userEmail,
    tags,
    fields,
  };
};
