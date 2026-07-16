import type { LegendSpec } from '../types/visualisation';
import type { VisualFilter } from '../types/visualAnalytics';

export type LegendItemLike = { label: string; value?: string; min?: number; max?: number };

export const visualFilterKey = (filter: VisualFilter) => {
  if (filter.kind === 'category') return `${filter.field}:category:${filter.values.join('|')}`;
  if (filter.kind === 'temporal') return `${filter.field}:temporal:${filter.start ?? ''}:${filter.end ?? ''}`;
  return `${filter.field}:range:${filter.min ?? ''}:${filter.max ?? ''}`;
};

export const buildLegendItemFilter = (
  legend: Pick<LegendSpec, 'title' | 'kind'>,
  item: LegendItemLike,
): VisualFilter => {
  if (item.label === 'No data' && legend.kind === 'categorical') {
    return { kind: 'category', field: legend.title, values: [], includeNull: true };
  }
  if (item.value !== undefined) {
    return { kind: 'category', field: legend.title, values: [item.value], includeNull: item.label === 'No data' };
  }
  return { kind: 'range', field: legend.title, min: item.min, max: item.max, includeNull: item.label === 'No data' };
};

/** Toggle a legend-item filter within an existing filter list. */
export const toggleFilterIn = (existing: VisualFilter[], next: VisualFilter): VisualFilter[] => {
  const nextKey = visualFilterKey(next);
  const without = existing.filter((filter) => visualFilterKey(filter) !== nextKey);
  return without.length === existing.length ? [...existing, next] : without;
};
