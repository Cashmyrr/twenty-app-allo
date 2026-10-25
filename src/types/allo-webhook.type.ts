// Shape of the Allo v2 webhook payloads we consume.
// Source: https://help.withallo.com/fr/v2/api-reference/webhooks/event-catalog
// Everything is optional-by-default because Allo omits `person`/`company` when
// there is no match, and only `call.completed` carries the call id and content.

export const ALLO_CALL_TOPICS = [
  'call.received',
  'call.triggered',
  'call.answered',
  'call.completed',
] as const;

export type AlloCallTopic = (typeof ALLO_CALL_TOPICS)[number];

export const isAlloCallTopic = (topic: unknown): topic is AlloCallTopic =>
  typeof topic === 'string' &&
  (ALLO_CALL_TOPICS as readonly string[]).includes(topic);

// Tags are usually applied after the agent hangs up, so they arrive on their own
// events rather than inside call.completed.
export const ALLO_TAG_TOPICS = ['tag.added', 'tag.removed'] as const;

export type AlloTagTopic = (typeof ALLO_TAG_TOPICS)[number];

export const isAlloTagTopic = (topic: unknown): topic is AlloTagTopic =>
  typeof topic === 'string' &&
  (ALLO_TAG_TOPICS as readonly string[]).includes(topic);

export type AlloTagData = {
  call_id?: string | null;
  tag_key?: string | null;
  tag_name?: string | null;
  user_email?: string | null;
};

export type AlloPerson = {
  id?: string | null;
  name?: string | null;
  last_name?: string | null;
  email?: string | null;
  emails?: string[] | null;
  numbers?: string[] | null;
  job_title?: string | null;
  linkedin_url?: string | null;
  lead_source?: string | null;
};

export type AlloCompany = {
  id?: string | null;
  name?: string | null;
};

export type AlloTranscriptionEntry = {
  source?: 'USER' | 'EXTERNAL' | string | null;
  time?: string | null;
  text?: string | null;
};

export type AlloTransfer = {
  number?: string | null;
  user_email?: string | null;
  user_name?: string | null;
};

export type AlloIvrResultEntry = {
  dtmf_key?: string | null;
  text_key?: string | null;
};

/** call.received, call.triggered and call.answered share this shape. */
export type AlloCallLifecycleData = {
  from_number?: string | null;
  to_number?: string | null;
  direction?: string | null;
  started_at?: string | null;
  answered_at?: string | null;
  user_email?: string | null;
  person?: AlloPerson | null;
  company?: AlloCompany | null;
  deals?: unknown[] | null;
};

/** call.completed carries the full record: id, content, outcome. */
export type AlloCallCompletedData = {
  id?: string | null;
  start_date?: string | null;
  recording_url?: string | null;
  from_number?: string | null;
  from_name?: string | null;
  to?: string | null;
  to_name?: string | null;
  length_in_minutes?: number | null;
  length?: string | null;
  tag?: string | null;
  tags?: string[] | null;
  summary?: string | null;
  transcriptions?: AlloTranscriptionEntry[] | null;
  concatenated_transcript?: string | null;
  data_collected?: Record<string, unknown> | null;
  type?: string | null;
  result?: string | null;
  integration_id?: string | null;
  transfer_from?: AlloTransfer | null;
  transfer_to?: AlloTransfer | null;
  user_email?: string | null;
  original_to_number?: string | null;
  original_to_name?: string | null;
  transfer_original_call_id?: string | null;
  ivr_result?: AlloIvrResultEntry[] | null;
};

export type AlloWebhookEvent = {
  topic?: string | null;
  version?: string | null;
  timestamp?: string | null;
  data?: AlloCallLifecycleData | AlloCallCompletedData | AlloTagData | null;
};

/**
 * What `allo-webhook` processes: a delivery `allo-webhook-receiver` has already
 * checked against this workspace's signing secret, or one `allo-webhook`
 * re-queued itself to retry later. Only this app's functions can queue it.
 */
export type AlloVerifiedDeliveryPayload = {
  kind: 'verified-delivery';
  registrationId: string;
  webhookId: string | null;
  event: AlloWebhookEvent;
  /** How many times this delivery has been put back in the queue. */
  deferredAttempt?: number;
};
