import type { TimeGrain } from '../types/visualAnalytics';

export type ResolvedTimeGrain = Exclude<TimeGrain, 'auto'>;

export const TIME_GRAINS: ResolvedTimeGrain[] = ['hour', 'day', 'week', 'month', 'quarter', 'year'];

const approximateMs: Record<ResolvedTimeGrain, number> = {
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30.44 * 24 * 60 * 60 * 1000,
  quarter: 91.31 * 24 * 60 * 60 * 1000,
  year: 365.25 * 24 * 60 * 60 * 1000,
};

export const isTimeGrain = (value: unknown): value is TimeGrain =>
  value === 'auto' || TIME_GRAINS.includes(value as ResolvedTimeGrain);

export const chooseTimeGrain = (
  minDate: string | Date,
  maxDate: string | Date,
  requested: TimeGrain = 'auto',
  targetPoints = 60,
): ResolvedTimeGrain => {
  if (requested !== 'auto') return requested;
  const start = new Date(minDate).getTime();
  const end = new Date(maxDate).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 'day';
  const span = end - start;
  return TIME_GRAINS.find((grain) => span / approximateMs[grain] <= targetPoints) || 'year';
};

const startOfBucket = (date: Date, grain: ResolvedTimeGrain) => {
  const result = new Date(date.getTime());
  result.setUTCMinutes(grain === 'hour' ? 0 : result.getUTCMinutes(), 0, 0);
  if (grain !== 'hour') result.setUTCHours(0, 0, 0, 0);
  if (grain === 'week') {
    const mondayOffset = (result.getUTCDay() + 6) % 7;
    result.setUTCDate(result.getUTCDate() - mondayOffset);
  } else if (grain === 'month') {
    result.setUTCDate(1);
  } else if (grain === 'quarter') {
    result.setUTCMonth(Math.floor(result.getUTCMonth() / 3) * 3, 1);
  } else if (grain === 'year') {
    result.setUTCMonth(0, 1);
  }
  return result;
};

const nextBucket = (date: Date, grain: ResolvedTimeGrain) => {
  const result = new Date(date.getTime());
  if (grain === 'hour') result.setUTCHours(result.getUTCHours() + 1);
  else if (grain === 'day') result.setUTCDate(result.getUTCDate() + 1);
  else if (grain === 'week') result.setUTCDate(result.getUTCDate() + 7);
  else if (grain === 'month') result.setUTCMonth(result.getUTCMonth() + 1);
  else if (grain === 'quarter') result.setUTCMonth(result.getUTCMonth() + 3);
  else result.setUTCFullYear(result.getUTCFullYear() + 1);
  return result;
};

export type TemporalBucket = { start: string; end: string; label: string };

const bucketLabel = (date: Date, grain: ResolvedTimeGrain) => {
  if (grain === 'hour') return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', timeZone: 'UTC' });
  if (grain === 'day' || grain === 'week') return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  if (grain === 'month') return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', timeZone: 'UTC' });
  if (grain === 'quarter') return `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${date.getUTCFullYear()}`;
  return String(date.getUTCFullYear());
};

export const enumerateTimeBuckets = (
  minDate: string | Date,
  maxDate: string | Date,
  grain: ResolvedTimeGrain,
  limit = 1000,
): TemporalBucket[] => {
  const min = new Date(minDate);
  const max = new Date(maxDate);
  if (!Number.isFinite(min.getTime()) || !Number.isFinite(max.getTime()) || max < min) return [];
  const buckets: TemporalBucket[] = [];
  let current = startOfBucket(min, grain);
  const final = startOfBucket(max, grain).getTime();
  while (current.getTime() <= final && buckets.length < limit) {
    const next = nextBucket(current, grain);
    buckets.push({
      start: current.toISOString(),
      end: new Date(next.getTime() - 1).toISOString(),
      label: bucketLabel(current, grain),
    });
    current = next;
  }
  return buckets;
};

export const temporalBucketKey = (value: unknown, grain: ResolvedTimeGrain) => {
  const date = new Date(value instanceof Date ? value : String(value));
  return Number.isFinite(date.getTime()) ? startOfBucket(date, grain).toISOString() : null;
};
