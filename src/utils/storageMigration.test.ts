import { describe, expect, it } from 'vitest';
import { migrateStorageKey } from './storageMigration';

const createStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    values,
  };
};

describe('migrateStorageKey', () => {
  it('moves a legacy value to the current key', () => {
    const storage = createStorage({ 'ymnngis-settings': '{"state":{}}' });

    expect(migrateStorageKey(storage, 'ymnngis-settings', 'alur-settings')).toBe(true);
    expect(storage.values.get('alur-settings')).toBe('{"state":{}}');
    expect(storage.values.has('ymnngis-settings')).toBe(false);
  });

  it('does not overwrite an existing current value', () => {
    const storage = createStorage({
      'ymnngis-settings': 'legacy',
      'alur-settings': 'current',
    });

    expect(migrateStorageKey(storage, 'ymnngis-settings', 'alur-settings')).toBe(false);
    expect(storage.values.get('alur-settings')).toBe('current');
    expect(storage.values.get('ymnngis-settings')).toBe('legacy');
  });
});
