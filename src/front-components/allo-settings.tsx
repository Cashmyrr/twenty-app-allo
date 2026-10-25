import { useCallback, useEffect, useId, useState } from 'react';
import { MetadataApiClient } from 'twenty-client-sdk/metadata';
import { RestApiClient } from 'twenty-client-sdk/rest';
import { defineFrontComponent } from 'twenty-sdk/define';
import { enqueueSnackbar } from 'twenty-sdk/front-component';
import { MainButton } from 'twenty-ui/components/input';
import { Section } from 'twenty-ui/components/layout';
import { Input } from 'twenty-ui/primitives/input';
import { Text } from 'twenty-ui/primitives/typography';

import {
  ALLO_API_KEY_ENV_VAR_NAME,
  ALLO_CONNECT_ROUTE_PATH,
  ALLO_CONNECTION_STATUS_ROUTE_PATH,
  ALLO_DISCONNECT_ROUTE_PATH,
} from 'src/constants/allo-api';
import {
  APPLICATION_UNIVERSAL_IDENTIFIER,
  SETTINGS_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';
import { type AlloConnectResponse } from 'src/logic-functions/allo-connect';
import { type AlloConnectionStatusResponse } from 'src/logic-functions/allo-connection-status';
import { type AlloDisconnectResponse } from 'src/logic-functions/allo-disconnect';

type Busy = 'loading' | 'connecting' | 'disconnecting' | null;

/** One line an admin can act on, for each state the status route reports. */
export const describeConnectionStatus = (
  status: AlloConnectionStatusResponse | null,
): string => {
  switch (status?.state) {
    case undefined:
      return 'Checking the connection…';
    case 'connected':
      return `Connected since ${new Date(status.connectedAt).toLocaleString()}. Calls sync as they happen.`;
    case 'missing-api-key':
      return 'Not connected. Enter an Allo API key to start syncing calls.';
    case 'disconnected':
      return 'Not connected. Calls are not syncing.';
    case 'api-key-changed':
      return 'The API key changed since the webhook was registered. Connect again to use the new key.';
    case 'webhook-missing':
      return 'The webhook was deleted or disabled in Allo, so calls are not syncing. Connect again to re-create it.';
    case 'secret-missing':
      return 'The webhook signing secret is missing, so calls are not syncing. Connect again to re-create the webhook.';
    case 'unknown':
      return `Could not check the connection: ${status.error}`;
  }
};

// Twenty keeps the API key in an application variable. Saving it through the
// metadata API is what the built-in variables tab does, and it requires the
// same permission to manage applications.
const saveApiKey = async (apiKey: string): Promise<void> => {
  const client = new MetadataApiClient();
  const { findOneApplication } = await client.query({
    findOneApplication: {
      __args: { universalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER },
      id: true,
    },
  });

  if (!findOneApplication?.id) {
    throw new Error('Could not find the Allo application.');
  }

  await client.mutation({
    updateOneApplicationVariable: {
      __args: {
        key: ALLO_API_KEY_ENV_VAR_NAME,
        value: apiKey,
        applicationId: findOneApplication.id,
      },
    },
  });
};

const AlloSettings = () => {
  const inputId = useId();
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [status, setStatus] = useState<AlloConnectionStatusResponse | null>(
    null,
  );
  const [busy, setBusy] = useState<Busy>('loading');

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(
        await new RestApiClient().get<AlloConnectionStatusResponse>(
          `/s${ALLO_CONNECTION_STATUS_ROUTE_PATH}`,
        ),
      );
    } catch {
      setStatus({ state: 'unknown', error: 'the server did not answer.' });
    }
  }, []);

  useEffect(() => {
    refreshStatus().finally(() => setBusy(null));
  }, [refreshStatus]);

  const connect = async () => {
    setBusy('connecting');

    try {
      const apiKey = apiKeyDraft.trim();

      if (apiKey.length > 0) {
        await saveApiKey(apiKey);
        setApiKeyDraft('');
      }

      const result = await new RestApiClient().post<AlloConnectResponse>(
        `/s${ALLO_CONNECT_ROUTE_PATH}`,
        {},
      );

      enqueueSnackbar(
        result.success
          ? { message: 'Allo is connected.', variant: 'success' }
          : { message: result.error, variant: 'error' },
      );
    } catch (error) {
      enqueueSnackbar({
        message: `Could not connect Allo: ${error instanceof Error ? error.message : String(error)}`,
        variant: 'error',
      });
    } finally {
      await refreshStatus();
      setBusy(null);
    }
  };

  const disconnect = async () => {
    setBusy('disconnecting');

    try {
      const result = await new RestApiClient().post<AlloDisconnectResponse>(
        `/s${ALLO_DISCONNECT_ROUTE_PATH}`,
        {},
      );

      enqueueSnackbar(
        !result.success
          ? { message: result.error, variant: 'error' }
          : result.removedFromAllo
            ? { message: 'Allo is disconnected.', variant: 'success' }
            : {
                message:
                  'Disconnected in Twenty. Remove the webhook in Allo > Settings > Webhooks.',
                variant: 'warning',
              },
      );
    } catch (error) {
      enqueueSnackbar({
        message: `Could not disconnect Allo: ${error instanceof Error ? error.message : String(error)}`,
        variant: 'error',
      });
    } finally {
      await refreshStatus();
      setBusy(null);
    }
  };

  const state = status?.state;
  const isRegistered =
    state === 'connected' ||
    state === 'webhook-missing' ||
    state === 'secret-missing' ||
    state === 'api-key-changed';
  const hasApiKey = state !== undefined && state !== 'missing-api-key';
  const canConnect =
    busy === null && (apiKeyDraft.trim().length > 0 || hasApiKey);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      <Section.Root>
        <Section.Header
          title="Connection"
          description="Twenty registers a webhook in Allo so every call is recorded as it happens."
        />
        <Text color="secondary">{describeConnectionStatus(status)}</Text>
      </Section.Root>

      <Section.Root>
        <Section.Header
          title="Allo API key"
          description="Create a key in Allo > Settings > API with the WEBHOOKS_READ_WRITE scope, and DIALING_QUEUE_READ_WRITE for Send to Power Dialer."
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label htmlFor={inputId}>
            <Text size="sm" color="tertiary">
              {hasApiKey
                ? 'A key is saved. Enter a new one only to replace it.'
                : 'API key'}
            </Text>
          </label>
          <Input
            id={inputId}
            type="password"
            autoComplete="off"
            placeholder={hasApiKey ? '••••••••' : 'Paste your Allo API key'}
            value={apiKeyDraft}
            onChange={(event) => setApiKeyDraft(event.target.value)}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <MainButton
              onClick={connect}
              disabled={!canConnect}
              loading={busy === 'connecting'}
            >
              {state === 'connected' && apiKeyDraft.trim().length === 0
                ? 'Check and repair'
                : 'Connect'}
            </MainButton>
            {isRegistered && (
              <MainButton
                variant="outline"
                color="danger"
                onClick={disconnect}
                disabled={busy !== null}
                loading={busy === 'disconnecting'}
              >
                Disconnect
              </MainButton>
            )}
          </div>
        </div>
      </Section.Root>
    </div>
  );
};

export default defineFrontComponent({
  universalIdentifier: SETTINGS_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  name: 'allo-settings',
  description:
    'Settings tab: Allo API key, connection status, connect and disconnect.',
  component: AlloSettings,
});
