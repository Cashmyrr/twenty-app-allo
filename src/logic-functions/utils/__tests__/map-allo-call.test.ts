import { describe, expect, it } from 'vitest';

import {
  buildCorrelationKey,
  mapAlloCall,
  normalizePhoneNumber,
  normalizeTimestamp,
} from 'src/logic-functions/utils/map-allo-call';
import {
  type AlloCallCompletedData,
  type AlloCallLifecycleData,
} from 'src/types/allo-webhook.type';

// Payloads copied from Allo's event catalog.
const CONTACT_NUMBER = '+33612345678';
const ALLO_NUMBER = '+33112345678';
const STARTED_AT = '2025-03-15T14:30:00.000Z';

const receivedData: AlloCallLifecycleData = {
  from_number: CONTACT_NUMBER,
  to_number: ALLO_NUMBER,
  started_at: STARTED_AT,
  user_email: 'john@acme.com',
  person: {
    id: 'con_5MiGNHp2vI1AN6sTu4Cw',
    name: 'Marie',
    last_name: 'Dupont',
    email: 'marie.dupont@acme.com',
    emails: ['marie.dupont@acme.com'],
    numbers: [CONTACT_NUMBER],
    job_title: 'Head of Sales',
  },
  company: { id: 'com-a1b2c3d4e5f6', name: 'Acme Corp' },
  deals: null,
};

const completedData: AlloCallCompletedData = {
  id: 'cll_2NfDKEm9sF8xK3pQr1Zt',
  start_date: STARTED_AT,
  recording_url: 'https://storage.withallo.com/recordings/abc123.mp3',
  from_number: CONTACT_NUMBER,
  from_name: 'Marie Dupont',
  to: ALLO_NUMBER,
  to_name: 'Support Acme',
  length_in_minutes: 5.5,
  length: '5m 30s',
  tag: 'support',
  tags: ['support', 'urgent'],
  summary: 'The customer called about a billing issue.',
  transcriptions: [
    { source: 'EXTERNAL', time: '2025-03-15T14:30:05.000Z', text: 'Hi.' },
    { source: 'USER', time: '2025-03-15T14:30:12.000Z', text: 'Of course.' },
  ],
  concatenated_transcript: 'Hi.\nOf course.',
  data_collected: { account_number: '12345' },
  type: 'INBOUND',
  result: 'ANSWERED',
  transfer_from: { number: null, user_email: null, user_name: null },
  transfer_to: { number: null, user_email: null, user_name: null },
  user_email: 'john@acme.com',
  original_to_number: null,
  original_to_name: null,
  transfer_original_call_id: null,
  ivr_result: [{ dtmf_key: '2', text_key: 'Support' }],
};

describe('normalizePhoneNumber', () => {
  it.each([
    ['+33 6 12 34 56 78', '+33612345678'],
    ['+33-612-345-678', '+33612345678'],
    ['33612345678', '+33612345678'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizePhoneNumber(input)).toBe(expected);
  });

  it.each([null, undefined, '', 'not a number'])(
    'returns null for %s',
    (input) => {
      expect(normalizePhoneNumber(input as string | null)).toBeNull();
    },
  );
});

describe('normalizeTimestamp', () => {
  it('normalizes a timestamp without a zone to an ISO instant', () => {
    expect(normalizeTimestamp('2026-07-13T10:00:00.000Z')).toBe(
      '2026-07-13T10:00:00.000Z',
    );
  });

  it.each([null, undefined, '', 'never'])('returns null for %s', (input) => {
    expect(normalizeTimestamp(input as string | null)).toBeNull();
  });
});

describe('buildCorrelationKey', () => {
  it('builds a key from the two numbers and the start time', () => {
    expect(
      buildCorrelationKey({
        fromNumber: CONTACT_NUMBER,
        toNumber: ALLO_NUMBER,
        startedAt: STARTED_AT,
      }),
    ).toBe(`${CONTACT_NUMBER}|${ALLO_NUMBER}|${STARTED_AT}`);
  });

  it.each([
    [{ fromNumber: null, toNumber: ALLO_NUMBER, startedAt: STARTED_AT }],
    [{ fromNumber: CONTACT_NUMBER, toNumber: null, startedAt: STARTED_AT }],
    [{ fromNumber: CONTACT_NUMBER, toNumber: ALLO_NUMBER, startedAt: null }],
  ])('returns null when a component is missing (%o)', (input) => {
    expect(buildCorrelationKey(input)).toBeNull();
  });
});

describe('mapAlloCall', () => {
  it('derives INBOUND from call.received, which carries no direction', () => {
    const mapped = mapAlloCall('call.received', receivedData);

    expect(mapped.direction).toBe('INBOUND');
    expect(mapped.fields.status).toBe('RINGING');
    expect(mapped.contactNumber).toBe(CONTACT_NUMBER);
    expect(mapped.fields.alloNumber).toBe(ALLO_NUMBER);
    expect(mapped.fields.name).toBe('Inbound call from Marie Dupont');
    expect(mapped.fields.fromName).toBe('Marie Dupont');
    expect(mapped.alloCallId).toBeNull();
    expect(mapped.alloPerson?.id).toBe('con_5MiGNHp2vI1AN6sTu4Cw');
  });

  it('derives OUTBOUND from call.triggered and flips the contact side', () => {
    const mapped = mapAlloCall('call.triggered', {
      ...receivedData,
      from_number: ALLO_NUMBER,
      to_number: CONTACT_NUMBER,
    });

    expect(mapped.direction).toBe('OUTBOUND');
    expect(mapped.contactNumber).toBe(CONTACT_NUMBER);
    expect(mapped.fields.alloNumber).toBe(ALLO_NUMBER);
    expect(mapped.fields.toName).toBe('Marie Dupont');
    expect(mapped.fields.name).toBe('Outbound call to Marie Dupont');
  });

  it('marks call.answered in progress and keeps the answer time', () => {
    const mapped = mapAlloCall('call.answered', {
      ...receivedData,
      direction: 'INBOUND',
      answered_at: '2025-03-15T14:30:08.000Z',
    });

    expect(mapped.fields.status).toBe('IN_PROGRESS');
    expect(mapped.fields.answeredAt).toBe('2025-03-15T14:30:08.000Z');
  });

  it('maps the full call.completed payload', () => {
    const mapped = mapAlloCall('call.completed', completedData);

    expect(mapped.alloCallId).toBe('cll_2NfDKEm9sF8xK3pQr1Zt');
    expect(mapped.direction).toBe('INBOUND');
    expect(mapped.fields.status).toBe('COMPLETED');
    expect(mapped.fields.result).toBe('ANSWERED');
    expect(mapped.fields.durationSeconds).toBe(330);
    expect(mapped.fields.durationLabel).toBe('5m 30s');
    expect(mapped.fields.endedAt).toBe('2025-03-15T14:35:30.000Z');
    expect(mapped.fields.summary).toBe(
      'The customer called about a billing issue.',
    );
    expect(mapped.fields.transcript).toBe('Hi.\nOf course.');
    expect(mapped.fields.tags).toEqual(['support', 'urgent']);
    expect(mapped.fields.recording).toEqual({
      primaryLinkUrl: 'https://storage.withallo.com/recordings/abc123.mp3',
      primaryLinkLabel: 'Recording',
    });
    expect(mapped.fields.alloLink).toEqual({
      primaryLinkUrl:
        'https://web.withallo.com/calls?callId=cll_2NfDKEm9sF8xK3pQr1Zt',
      primaryLinkLabel: 'Open in Allo',
    });
    expect(mapped.fields.dataCollected).toEqual({ account_number: '12345' });
    expect(mapped.fields.ivrResult).toEqual([
      { dtmf_key: '2', text_key: 'Support' },
    ]);
    // Every transfer subfield is null in this payload, so no transfer is stored.
    expect(mapped.fields.transfer).toBeNull();
    expect(mapped.fields.userEmail).toBe('john@acme.com');
  });

  it('produces the same correlation key across all four events', () => {
    const keys = [
      mapAlloCall('call.received', receivedData).correlationKey,
      mapAlloCall('call.triggered', receivedData).correlationKey,
      mapAlloCall('call.answered', {
        ...receivedData,
        direction: 'INBOUND',
        answered_at: '2025-03-15T14:30:08.000Z',
      }).correlationKey,
      mapAlloCall('call.completed', completedData).correlationKey,
    ];

    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe(`${CONTACT_NUMBER}|${ALLO_NUMBER}|${STARTED_AT}`);
  });

  it('falls back to the primary tag when tags is empty', () => {
    const mapped = mapAlloCall('call.completed', {
      ...completedData,
      tags: [],
    });

    expect(mapped.fields.tags).toEqual(['support']);
  });

  it('rebuilds the transcript from entries when the concatenation is absent', () => {
    const mapped = mapAlloCall('call.completed', {
      ...completedData,
      concatenated_transcript: null,
    });

    expect(mapped.fields.transcript).toBe('Contact: Hi.\nAgent: Of course.');
  });

  it('keeps a transfer when any of its subfields is set', () => {
    const mapped = mapAlloCall('call.completed', {
      ...completedData,
      transfer_to: {
        number: ALLO_NUMBER,
        user_email: 'jane@acme.com',
        user_name: 'Jane Doe',
      },
      transfer_original_call_id: 'cll_original',
    });

    expect(mapped.fields.transfer).toEqual({
      from: { number: null, user_email: null, user_name: null },
      to: {
        number: ALLO_NUMBER,
        user_email: 'jane@acme.com',
        user_name: 'Jane Doe',
      },
      originalCallId: 'cll_original',
      originalToNumber: null,
      originalToName: null,
    });
  });

  it('drops an unknown result rather than writing an invalid select value', () => {
    const mapped = mapAlloCall('call.completed', {
      ...completedData,
      result: 'SOMETHING_NEW',
    });

    expect(mapped.fields.result).toBeUndefined();
    expect(mapped.fields.status).toBe('COMPLETED');
  });

  // Allo sends no result when nobody picks up, however long it rang.
  it.each([
    ['missing', undefined],
    ['null', null],
    ['empty', ''],
  ])('marks a call with a %s result as not answered', (_label, result) => {
    const mapped = mapAlloCall('call.completed', {
      ...completedData,
      result,
      length_in_minutes: 0.83,
    } as never);

    expect(mapped.fields.result).toBe('NOT_ANSWERED');
  });

  it('keeps a short call Allo reports as answered', () => {
    const mapped = mapAlloCall('call.completed', {
      ...completedData,
      result: 'ANSWERED',
      length_in_minutes: 0.02,
    });

    expect(mapped.fields.result).toBe('ANSWERED');
  });

  it('sets no result on ringing events', () => {
    expect(
      mapAlloCall('call.received', receivedData).fields.result,
    ).toBeUndefined();
  });

  it('handles a call with no matched Allo contact', () => {
    const mapped = mapAlloCall('call.received', {
      ...receivedData,
      person: null,
      company: null,
    });

    expect(mapped.alloPerson).toBeNull();
    expect(mapped.fields.alloPersonId).toBeNull();
    expect(mapped.fields.name).toBe(`Inbound call from ${CONTACT_NUMBER}`);
  });

  it('has no correlation key when the payload lacks a start time', () => {
    const mapped = mapAlloCall('call.received', {
      ...receivedData,
      started_at: null,
    });

    expect(mapped.correlationKey).toBeNull();
  });
});
