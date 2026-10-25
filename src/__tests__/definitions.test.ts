import { describe, expect, it } from 'vitest';

import * as universalIdentifiers from 'src/constants/universal-identifiers';
import applicationConfig from 'src/application-config';
import alloCallCompanyRelation from 'src/fields/allo-call-company-relation.field';
import alloCallMemberRelation from 'src/fields/allo-call-member-relation.field';
import alloCallPersonRelation from 'src/fields/allo-call-person-relation.field';
import companyAlloCallsRelation from 'src/fields/company-allo-calls-relation.field';
import personAlloCallsRelation from 'src/fields/person-allo-calls-relation.field';
import personLastAlloCallAt from 'src/fields/person-last-allo-call-at.field';
import workspaceMemberAlloCallsRelation from 'src/fields/workspace-member-allo-calls-relation.field';
import alloCallIdIndex from 'src/indexes/allo-call-allo-call-id.index';
import alloCallCorrelationKeyIndex from 'src/indexes/allo-call-correlation-key.index';
import pushToDialerCommandMenuItem from 'src/command-menu-items/push-to-dialer.command-menu-item';
import pushToDialerFrontComponent from 'src/front-components/push-to-dialer.front-component';
import alloWebhook from 'src/logic-functions/allo-webhook';
import alloWebhookReceiver from 'src/logic-functions/allo-webhook-receiver';
import healthCheck from 'src/logic-functions/health-check';
import pushToDialer from 'src/logic-functions/push-to-dialer';
import alloConnect from 'src/logic-functions/allo-connect';
import alloConnectionStatus from 'src/logic-functions/allo-connection-status';
import alloDisconnect from 'src/logic-functions/allo-disconnect';
import alloSettingsFrontComponent from 'src/front-components/allo-settings';
import alloSettingsMenuItem from 'src/settings-menu-items/allo-settings.settings-menu-item';
import uninstall from 'src/logic-functions/uninstall';
import syncLastAlloCallOnCreate from 'src/logic-functions/sync-last-allo-call-on-create';
import syncLastAlloCallOnLink from 'src/logic-functions/sync-last-allo-call-on-link';
import alloCallsNavigationMenuItem from 'src/navigation-menu-items/allo-calls.navigation-menu-item';
import alloCallObject from 'src/objects/allo-call.object';
import defaultRole from 'src/roles/default-role';
import alloCallsView from 'src/views/allo-calls.view';

// Every define*() call returns the SDK's own validation result, so importing a
// definition is enough to check it: a bad relation target, a missing label
// identifier or a mis-quoted default value shows up here rather than at sync.
const definitions = {
  'application-config': applicationConfig,
  'default-role': defaultRole,
  'allo-call.object': alloCallObject,
  'allo-call-member-relation.field': alloCallMemberRelation,
  'workspace-member-allo-calls-relation.field':
    workspaceMemberAlloCallsRelation,
  'allo-call-person-relation.field': alloCallPersonRelation,
  'person-allo-calls-relation.field': personAlloCallsRelation,
  'person-last-allo-call-at.field': personLastAlloCallAt,
  'allo-call-company-relation.field': alloCallCompanyRelation,
  'company-allo-calls-relation.field': companyAlloCallsRelation,
  'allo-call-allo-call-id.index': alloCallIdIndex,
  'allo-call-correlation-key.index': alloCallCorrelationKeyIndex,
  'allo-webhook': alloWebhook,
  'allo-webhook-receiver': alloWebhookReceiver,
  'allo-connect': alloConnect,
  'allo-disconnect': alloDisconnect,
  'allo-connection-status': alloConnectionStatus,
  'allo-settings.front-component': alloSettingsFrontComponent,
  'allo-settings.settings-menu-item': alloSettingsMenuItem,
  uninstall,
  'health-check': healthCheck,
  'sync-last-allo-call-on-create': syncLastAlloCallOnCreate,
  'sync-last-allo-call-on-link': syncLastAlloCallOnLink,
  'push-to-dialer': pushToDialer,
  'push-to-dialer.front-component': pushToDialerFrontComponent,
  'push-to-dialer.command-menu-item': pushToDialerCommandMenuItem,
  'allo-calls.view': alloCallsView,
  'allo-calls.navigation-menu-item': alloCallsNavigationMenuItem,
};

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe.each(Object.entries(definitions))('%s', (_name, definition) => {
  it('validates without errors', () => {
    expect(definition.errors).toEqual([]);
    expect(definition.success).toBe(true);
  });
});

describe('universal identifiers', () => {
  const uuids = Object.entries(universalIdentifiers).filter(([, value]) =>
    UUID_V4.test(String(value)),
  );

  it('are all valid UUID v4', () => {
    const invalid = Object.entries(universalIdentifiers)
      .filter(([name]) => name.endsWith('UNIVERSAL_IDENTIFIER'))
      .filter(([, value]) => !UUID_V4.test(String(value)));

    expect(invalid).toEqual([]);
  });

  it('are unique', () => {
    const values = uuids.map(([, value]) => String(value));

    expect(new Set(values).size).toBe(values.length);
  });
});

describe('allo call object', () => {
  const fields = alloCallObject.config.fields;

  it('points its label identifier at a field it declares', () => {
    const labelIdentifier =
      alloCallObject.config.labelIdentifierFieldMetadataUniversalIdentifier;

    expect(
      fields.some((field) => field.universalIdentifier === labelIdentifier),
    ).toBe(true);
  });

  it('declares unique field names', () => {
    const names = fields.map((field) => field.name);

    expect(new Set(names).size).toBe(names.length);
  });

  it('carries the fields the webhook writes', () => {
    const names = new Set(fields.map((field) => field.name));

    for (const expected of [
      'alloCallId',
      'correlationKey',
      'startedAt',
      'answeredAt',
      'endedAt',
      'durationSeconds',
      'direction',
      'contactNumber',
      'status',
      'result',
      'summary',
      'transcript',
      'recording',
      'tags',
      'userEmail',
    ]) {
      expect(names).toContain(expected);
    }
  });
});

describe('allo webhook', () => {
  // The receiver is public because Allo cannot authenticate; it checks the
  // signature itself. The function that writes has no trigger at all, so only
  // a job queued by this app reaches it.
  it('is reached only through the receiver route', () => {
    expect(alloWebhookReceiver.config.httpRouteTriggerSettings).toMatchObject({
      httpMethod: 'POST',
      isAuthRequired: false,
    });
    expect(
      alloWebhookReceiver.config.httpRouteTriggerSettings?.forwardedRequestHeaders,
    ).toEqual(
      expect.arrayContaining(['webhook-id', 'webhook-timestamp', 'webhook-signature']),
    );
    expect(alloWebhookReceiver.config.serverRouteTriggerSettings).toBeUndefined();
    expect(alloWebhook.config.serverRouteTriggerSettings).toBeUndefined();
    expect(alloWebhook.config.httpRouteTriggerSettings).toBeUndefined();
  });
});

describe('routes', () => {
  it.each([
    ['push-to-dialer', pushToDialer],
    ['allo-connect', alloConnect],
    ['allo-disconnect', alloDisconnect],
    ['allo-connection-status', alloConnectionStatus],
  ])('%s requires an authenticated caller', (_name, definition) => {
    expect(definition.config.httpRouteTriggerSettings?.isAuthRequired).toBe(
      true,
    );
  });

  // The app must not wake up on a schedule: everything it does is triggered by
  // Allo, a record change or a person.
  it('declares no cron', () => {
    for (const definition of [
      alloWebhook,
      alloWebhookReceiver,
      alloConnect,
      alloDisconnect,
      alloConnectionStatus,
      pushToDialer,
    ]) {
      expect(definition.config.cronTriggerSettings).toBeUndefined();
    }
  });
});

describe('settings tab', () => {
  it('renders the settings front component', () => {
    expect(alloSettingsMenuItem.config.frontComponentUniversalIdentifier).toBe(
      alloSettingsFrontComponent.config.universalIdentifier,
    );
  });
});

describe('allo calls view', () => {
  it('every view field references a field on the allo call object', () => {
    const objectFieldIds = new Set(
      alloCallObject.config.fields.map((field) => field.universalIdentifier),
    );
    const relationFieldIds = new Set([
      alloCallMemberRelation.config.universalIdentifier,
      alloCallPersonRelation.config.universalIdentifier,
      alloCallCompanyRelation.config.universalIdentifier,
    ]);

    for (const viewField of alloCallsView.config.fields ?? []) {
      const id = viewField.fieldMetadataUniversalIdentifier;

      expect(objectFieldIds.has(id) || relationFieldIds.has(id)).toBe(true);
    }
  });

  it('is reachable from the navigation menu', () => {
    expect(
      alloCallsNavigationMenuItem.config.viewUniversalIdentifier,
    ).toBe(alloCallsView.config.universalIdentifier);
  });
});

// defineField() returns a union over every field type, so the relation-only
// properties need narrowing before they can be read.
type RelationSide = {
  universalIdentifier: string;
  objectUniversalIdentifier: string;
  relationTargetFieldMetadataUniversalIdentifier: string;
  relationTargetObjectMetadataUniversalIdentifier: string;
};

const asRelationSide = (definition: {
  config: unknown;
}): RelationSide => definition.config as RelationSide;

describe('relations', () => {
  it.each([
    ['member', alloCallMemberRelation, workspaceMemberAlloCallsRelation],
    ['person', alloCallPersonRelation, personAlloCallsRelation],
    ['company', alloCallCompanyRelation, companyAlloCallsRelation],
  ])(
    'both sides of the %s relation point at each other',
    (_name, manySide, oneSide) => {
      const many = asRelationSide(manySide);
      const one = asRelationSide(oneSide);

      expect(many.relationTargetFieldMetadataUniversalIdentifier).toBe(
        one.universalIdentifier,
      );
      expect(one.relationTargetFieldMetadataUniversalIdentifier).toBe(
        many.universalIdentifier,
      );
      expect(many.relationTargetObjectMetadataUniversalIdentifier).toBe(
        one.objectUniversalIdentifier,
      );
      expect(one.relationTargetObjectMetadataUniversalIdentifier).toBe(
        many.objectUniversalIdentifier,
      );
    },
  );
});
