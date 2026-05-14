import { X } from 'lucide-react';
import type { VisualFilter } from '../../types/visualAnalytics';

const formatNumber = (value: number | undefined) =>
  value === undefined ? null : value.toLocaleString(undefined, { maximumFractionDigits: 2 });

export const filterLabel = (filter: VisualFilter) => {
  if (filter.kind === 'category') {
    const values = filter.values.length ? filter.values.join(', ') : 'No data';
    return `${filter.field}: ${values}`;
  }

  if (filter.kind === 'temporal') {
    if (filter.start && filter.end) return `${filter.field}: ${filter.start} to ${filter.end}`;
    if (filter.start) return `${filter.field}: from ${filter.start}`;
    if (filter.end) return `${filter.field}: until ${filter.end}`;
    return `${filter.field}: No date`;
  }

  const min = formatNumber(filter.min);
  const max = formatNumber(filter.max);
  if (min && max) return `${filter.field}: ${min} to ${max}`;
  if (min) return `${filter.field}: >= ${min}`;
  if (max) return `${filter.field}: <= ${max}`;
  return `${filter.field}: No data`;
};

export const filterKey = (filter: VisualFilter) => {
  if (filter.kind === 'category') return `${filter.field}:category:${filter.values.join('|')}:${filter.includeNull ? 'null' : ''}`;
  if (filter.kind === 'temporal') return `${filter.field}:temporal:${filter.start ?? ''}:${filter.end ?? ''}:${filter.includeNull ? 'null' : ''}`;
  return `${filter.field}:range:${filter.min ?? ''}:${filter.max ?? ''}:${filter.includeNull ? 'null' : ''}`;
};

export const FilterChips = ({
  filters,
  onRemove,
  onClear,
}: {
  filters: VisualFilter[];
  onRemove: (index: number) => void;
  onClear: () => void;
}) => {
  if (!filters.length) return null;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b bg-sky-50 px-3 py-2">
      <span className="mr-1 text-[9px] font-bold uppercase tracking-widest text-sky-700">Filters</span>
      {filters.map((filter, index) => (
        <button
          type="button"
          key={`${filterKey(filter)}-${index}`}
          onClick={() => onRemove(index)}
          className="flex max-w-[240px] items-center gap-1 rounded-md border border-sky-200 bg-white px-2 py-1 text-[10px] font-semibold text-sky-800 hover:bg-sky-100"
          title={`Remove ${filterLabel(filter)}`}
        >
          <span className="truncate">{filterLabel(filter)}</span>
          <X className="h-3 w-3 shrink-0" />
        </button>
      ))}
      <button
        type="button"
        onClick={onClear}
        className="rounded-md border border-sky-200 bg-sky-100 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-sky-800 hover:bg-sky-200"
      >
        Clear all
      </button>
    </div>
  );
};
