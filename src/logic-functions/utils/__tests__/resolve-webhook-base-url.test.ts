import { describe, expect, it } from 'vitest';

import { pickWebhookBaseUrl } from 'src/logic-functions/utils/resolve-webhook-base-url';

const API_URL = 'https://api.twenty.com';

describe('pickWebhookBaseUrl', () => {
  it('uses the public function domain, as on Twenty Cloud', () => {
    expect(
      pickWebhookBaseUrl({
        apiUrl: API_URL,
        serverUrl: API_URL,
        publicFunctionDomain: 'withtwenty.com',
        isMultiWorkspaceEnabled: true,
        subdomain: 'acme',
        subdomainUrl: 'https://acme.twenty.com/',
      }),
    ).toBe('https://acme.withtwenty.com');
  });

  it('uses the public server URL of a single-workspace server', () => {
    expect(
      pickWebhookBaseUrl({
        apiUrl: 'http://twenty-server:3000',
        serverUrl: 'https://crm.example.com/',
        isMultiWorkspaceEnabled: false,
        subdomain: 'acme',
      }),
    ).toBe('https://crm.example.com/s');
  });

  it("uses the workspace's subdomain URL on a multi-workspace server", () => {
    expect(
      pickWebhookBaseUrl({
        apiUrl: 'https://crm.example.com',
        isMultiWorkspaceEnabled: true,
        subdomain: 'acme',
        subdomainUrl: 'https://acme.crm.example.com/',
      }),
    ).toBe('https://acme.crm.example.com/s');
  });

  // On a shared host Twenty would not know which workspace a delivery is for.
  it('refuses to guess when nothing names the workspace', () => {
    expect(() =>
      pickWebhookBaseUrl({ apiUrl: API_URL, isMultiWorkspaceEnabled: true }),
    ).toThrow(/public URL of this workspace/);
  });
});
