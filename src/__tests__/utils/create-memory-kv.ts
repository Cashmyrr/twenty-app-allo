type KvOptions = { scope?: string };

/**
 * In-memory stand-in for `kv` from `twenty-sdk/logic-function`, keeping the
 * WORKSPACE and SERVER scopes apart the way the runtime does.
 */
export const createMemoryKv = () => {
  const store = new Map<string, unknown>();
  const keyOf = (key: string, options?: KvOptions) =>
    `${options?.scope ?? 'WORKSPACE'}:${key}`;

  return {
    store,
    get: async <T>(key: string, options?: KvOptions): Promise<T | null> =>
      (store.get(keyOf(key, options)) as T | undefined) ?? null,
    set: async <T>(key: string, value: T, options?: KvOptions): Promise<void> => {
      store.set(keyOf(key, options), value);
    },
    delete: async (key: string, options?: KvOptions): Promise<boolean> =>
      store.delete(keyOf(key, options)),
  };
};

export type MemoryKv = ReturnType<typeof createMemoryKv>;
