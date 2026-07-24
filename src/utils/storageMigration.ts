type StorageAdapter = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const migrateStorageKey = (
  storage: StorageAdapter,
  legacyKey: string,
  currentKey: string,
) => {
  if (storage.getItem(currentKey) !== null) return false;

  const legacyValue = storage.getItem(legacyKey);
  if (legacyValue === null) return false;

  storage.setItem(currentKey, legacyValue);
  storage.removeItem(legacyKey);
  return true;
};

export const migrateLocalStorageKey = (legacyKey: string, currentKey: string) => {
  if (typeof window === 'undefined') return false;

  try {
    return migrateStorageKey(window.localStorage, legacyKey, currentKey);
  } catch {
    return false;
  }
};
