import { MetadataApiClient } from 'twenty-client-sdk/metadata';

/**
 * The URL people open the workspace at: its custom domain when it has one,
 * otherwise its subdomain. On Twenty Cloud the API URL is shared by every
 * workspace, so it cannot tell them apart. Best-effort: only a label uses it.
 */
export const readWorkspaceUrl = async (): Promise<string | undefined> => {
  try {
    const { currentWorkspace } = await new MetadataApiClient().query({
      currentWorkspace: { workspaceUrls: { customUrl: true, subdomainUrl: true } },
    });

    return (
      currentWorkspace?.workspaceUrls?.customUrl ??
      currentWorkspace?.workspaceUrls?.subdomainUrl ??
      undefined
    );
  } catch (error) {
    console.warn('[allo] could not read the workspace URL', error);

    return undefined;
  }
};
