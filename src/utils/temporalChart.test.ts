import { describe, expect, it } from 'vitest';
import { chooseTimeGrain, enumerateTimeBuckets, isTimeGrain, temporalBucketKey } from './temporalChart';

describe('temporal chart utilities', () => {
  it('validates and automatically selects a readable grain', () => {
    expect(isTimeGrain('quarter')).toBe(true);
    expect(isTimeGrain('fortnight')).toBe(false);
    expect(chooseTimeGrain('2026-01-01', '2026-01-02', 'auto')).toBe('hour');
    expect(chooseTimeGrain('2020-01-01', '2026-01-01', 'auto')).toBe('quarter');
    expect(chooseTimeGrain('2020-01-01', '2026-01-01', 'month')).toBe('month');
  });

  it('enumerates explicit UTC periods and inclusive filter bounds', () => {
    const buckets = enumerateTimeBuckets('2026-01-10', '2026-03-04', 'month');
    expect(buckets.map((bucket) => bucket.start)).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
      '2026-03-01T00:00:00.000Z',
    ]);
    expect(buckets[0].end).toBe('2026-01-31T23:59:59.999Z');
  });

  it('normalises DuckDB bucket values to stable keys', () => {
    expect(temporalBucketKey('2026-04-15 09:30:00', 'quarter')).toBe('2026-04-01T00:00:00.000Z');
    expect(temporalBucketKey('not-a-date', 'day')).toBeNull();
  });
});
