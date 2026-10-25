import { MetadataApiClient } from 'twenty-client-sdk/metadata';

export type WebhookBaseUrlInputs = {
  /** `TWENTY_API_URL`, used when the server serves a single workspace. */
  apiUrl: string;
  /** From the public `/client-config`. */
  serverUrl?: string | null;
  publicFunctionDomain?: string | null;
  isMultiWorkspaceEnabled?: boolean | null;
  /** From `currentWorkspace`. */
  subdomain?: string | null;
  subdomainUrl?: string | null;
};

const trimSlashes = (url: string): string => url.replace(/\/+$/, '');

/**
 * Where Twenty serves this workspace's public HTTP routes. Twenty picks the
 * workspace from the request host, so the URL must carry it:
 *
 * - Twenty Cloud and servers with a public function domain:
 *   `https://<subdomain>.<publicFunctionDomain>`, the form new functions are
 *   served on.
 * - A single-workspace server: every host resolves to its one workspace, so
 *   `<server>/s`.
 * - Otherwise the workspace's own subdomain URL, under `/s`.
 */
export const pickWebhookBaseUrl = ({
  apiUrl,
  serverUrl,
  publicFunctionDomain,
  isMultiWorkspaceEnabled,
  subdomain,
  subdomainUrl,
}: WebhookBaseUrlInputs): string => {
  if (publicFunctionDomain && subdomain) {
    return `https://${subdomain}.${publicFunctionDomain}`;
  }

  if (isMultiWorkspaceEnabled === false) {
    return `${trimSlashes(serverUrl || apiUrl)}/s`;
  }

  if (subdomainUrl) {
    return `${trimSlashes(subdomainUrl)}/s`;
  }

  throw new Error(
    'Could not work out the public URL of this workspace, so Allo would have nowhere to send calls.',
  );
};

type ClientConfig = {
  serverUrl?: string;
  publicFunctionDomain?: string | null;
  isMultiWorkspaceEnabled?: boolean;
};

/** Reads what `pickWebhookBaseUrl` needs from this Twenty server. */
export const resolveWebhookBaseUrl = async (apiUrl: string): Promise<string> => {
  const response = await fetch(`${trimSlashes(apiUrl)}/client-config`);

  if (!response.ok) {
    throw new Error(
      `Twenty's client config answered HTTP ${response.status}, so the webhook URL cannot be built.`,
    );
  }

  const config = (await response.json()) as ClientConfig;
  const { currentWorkspace } = await new MetadataApiClient().query({
    currentWorkspace: { subdomain: true, workspaceUrls: { subdomainUrl: true } },
  });

  return pickWebhookBaseUrl({
    apiUrl,
    serverUrl: config.serverUrl,
    publicFunctionDomain: config.publicFunctionDomain,
    isMultiWorkspaceEnabled: config.isMultiWorkspaceEnabled,
    subdomain: currentWorkspace?.subdomain,
    subdomainUrl: currentWorkspace?.workspaceUrls?.subdomainUrl,
  });
};
