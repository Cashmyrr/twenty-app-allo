type KvOptions = { scope?: string };

/**
 * In-memory stand-in for `kv` from `twenty-sdk/logic-function`, keeping the
 * WORKSPACE and SERVER scopes apart the way the runtime does.
 *
 * SERVER keys follow Twenty's claim registry: `set` ignores the value and
 * stores the calling workspace's id, a key claimed by another workspace cannot
 * be taken over, and only the claiming workspace can delete it. `actAs`
 * switches the calling workspace.
 */
export const createMemoryKv = ({ workspaceId = 'ws_1' } = {}) => {
  const store = new Map<string, unknown>();
  let callerWorkspaceId = workspaceId;
  const keyOf = (key: string, options?: KvOptions) =>
    `${options?.scope ?? 'WORKSPACE'}:${key}`;

  return {
    store,
    actAs: (id: string) => {
      callerWorkspaceId = id;
    },
    get: async <T>(key: string, options?: KvOptions): Promise<T | null> =>
      (store.get(keyOf(key, options)) as T | undefined) ?? null,
    set: async <T>(key: string, value: T, options?: KvOptions): Promise<void> => {
      if (options?.scope !== 'SERVER') {
        store.set(keyOf(key, options), value);

        return;
      }

      const claimedBy = store.get(keyOf(key, options));

      if (claimedBy !== undefined && claimedBy !== callerWorkspaceId) {
        throw new Error(`Server key "${key}" is claimed by another workspace`);
      }

      store.set(keyOf(key, options), callerWorkspaceId);
    },
    delete: async (key: string, options?: KvOptions): Promise<boolean> => {
      if (
        options?.scope === 'SERVER' &&
        store.get(keyOf(key, options)) !== callerWorkspaceId
      ) {
        return false;
      }

      return store.delete(keyOf(key, options));
    },
  };
};

export type MemoryKv = ReturnType<typeof createMemoryKv>;
