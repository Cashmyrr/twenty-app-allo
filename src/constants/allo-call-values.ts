// Stored values for the Allo call SELECT fields. Kept apart from the universal
// identifiers so the mapper and the object definition agree on one source.

export const ALLO_CALL_DIRECTION_INBOUND = 'INBOUND';
export const ALLO_CALL_DIRECTION_OUTBOUND = 'OUTBOUND';

export const ALLO_CALL_STATUS_RINGING = 'RINGING';
export const ALLO_CALL_STATUS_IN_PROGRESS = 'IN_PROGRESS';
export const ALLO_CALL_STATUS_COMPLETED = 'COMPLETED';

// Mirrors Allo's `result` values on call.completed.
export const ALLO_CALL_RESULT_VALUES = [
  'ANSWERED',
  'VOICEMAIL',
  'TRANSFERRED_AI',
  'TRANSFERRED_EXTERNAL',
  'BLOCKED',
  'FAILED',
] as const;

export type AlloCallResult = (typeof ALLO_CALL_RESULT_VALUES)[number];

export const isAlloCallResult = (value: unknown): value is AlloCallResult =>
  typeof value === 'string' &&
  (ALLO_CALL_RESULT_VALUES as readonly string[]).includes(value);
