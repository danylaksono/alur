import { describe, it, expect } from 'vitest';
import { evictionPlan, sourceCacheKey, SOURCE_CACHE_BUDGET_BYTES, type CachedSourceEntry } from './sourceCache';

const entry = (over: Partial<CachedSourceEntry> = {}): CachedSourceEntry => ({
  key: 'k',
  name: 'a.parquet',
  size: 100,
  cachedAt: 0,
  lastUsedAt: 0,
  ...over,
});

describe('sourceCacheKey', () => {
  it('is stable for the same file', () => {
    const file = { name: 'need_london.parquet', size: 2578406, lastModified: 1700000000000 };
    expect(sourceCacheKey(file)).toBe(sourceCacheKey({ ...file }));
  });

  it('separates files that differ in any part of the identity the relink check uses', () => {
    const base = { name: 'a.parquet', size: 10, lastModified: 1 };
    const keys = new Set([
      sourceCacheKey(base),
      sourceCacheKey({ ...base, size: 11 }),
      sourceCacheKey({ ...base, lastModified: 2 }),
      sourceCacheKey({ ...base, name: 'b.parquet' }),
    ]);
    expect(keys.size).toBe(4);
  });

  it('produces a filesystem-safe name', () => {
    const key = sourceCacheKey({ name: '../../etc/pass wd?.parquet', size: 1 });
    expect(key).not.toMatch(/[/\\?<>:*|"]/);
    expect(key).not.toContain('..');
  });

  it('keeps long names bounded', () => {
    expect(sourceCacheKey({ name: `${'x'.repeat(500)}.parquet`, size: 1 }).length).toBeLessThan(80);
  });

  it('tolerates a manifest source with no size or timestamp', () => {
    expect(sourceCacheKey({ name: 'a.parquet' })).toBeTruthy();
    expect(sourceCacheKey({ name: 'a.parquet' })).not.toBe(sourceCacheKey({ name: 'a.parquet', size: 1 }));
  });
});

describe('evictionPlan', () => {
  it('evicts nothing when everything fits', () => {
    expect(evictionPlan([entry({ size: 10 })], 10, 100)).toEqual([]);
  });

  it('evicts least recently used first', () => {
    const plan = evictionPlan(
      [entry({ key: 'old', size: 50, lastUsedAt: 1 }), entry({ key: 'new', size: 50, lastUsedAt: 9 })],
      50,
      100,
    );
    expect(plan.map((item) => item.key)).toEqual(['old']);
  });

  it('stops as soon as the incoming file fits, rather than clearing the cache', () => {
    const plan = evictionPlan(
      [entry({ key: 'a', size: 30, lastUsedAt: 1 }), entry({ key: 'b', size: 30, lastUsedAt: 2 }), entry({ key: 'c', size: 30, lastUsedAt: 3 })],
      20,
      100,
    );
    expect(plan.map((item) => item.key)).toEqual(['a']);
  });

  it('evicts everything when the incoming file needs the whole budget', () => {
    const plan = evictionPlan([entry({ key: 'a', size: 40 }), entry({ key: 'b', size: 40, lastUsedAt: 1 })], 100, 100);
    expect(plan.map((item) => item.key).sort()).toEqual(['a', 'b']);
  });

  it('does not mutate the caller\'s list', () => {
    const entries = [entry({ key: 'a', lastUsedAt: 9 }), entry({ key: 'b', lastUsedAt: 1 })];
    evictionPlan(entries, SOURCE_CACHE_BUDGET_BYTES, 10);
    expect(entries.map((item) => item.key)).toEqual(['a', 'b']);
  });
});
