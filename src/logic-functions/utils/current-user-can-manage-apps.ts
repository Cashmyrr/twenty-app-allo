import { MetadataApiClient } from 'twenty-client-sdk/metadata';

/**
 * Connecting or disconnecting Allo changes where a whole workspace's calls go,
 * so it is reserved to members allowed to manage applications, the same
 * permission Twenty requires to edit the API key.
 */
export const currentUserCanManageApps = async (): Promise<boolean> => {
  const { currentUser } = await new MetadataApiClient().query({
    currentUser: { currentUserWorkspace: { permissionFlags: true } },
  });

  return (currentUser?.currentUserWorkspace?.permissionFlags ?? []).includes(
    'APPLICATIONS',
  );
};
