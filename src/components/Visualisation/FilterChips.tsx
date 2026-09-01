import { useState } from 'react';
import { Pencil, X } from 'lucide-react';
import type { VisualFilter } from '../../types/visualAnalytics';
import { visualFilterKey, visualFilterLabel } from '../../utils/visualFilters';
import { FilterEditorDialog } from './FilterEditorDialog';

export const filterLabel = visualFilterLabel;
export const filterKey = visualFilterKey;

export const FilterChips = ({
  filters,
  onRemove,
  onClear,
  onUpdate,
}: {
  filters: VisualFilter[];
  onRemove: (index: number) => void;
  onClear: () => void;
  onUpdate?: (index: number, filter: VisualFilter) => void;
}) => {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  if (!filters.length) return null;
  const editingFilter = editingIndex === null ? null : filters[editingIndex];

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b bg-sky-50 px-3 py-2">
        <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-sky-700">Filters</span>
        {filters.map((filter, index) => (
          <span key={`${visualFilterKey(filter)}-${index}`} className="flex max-w-[280px] items-stretch overflow-hidden rounded-md border border-sky-200 bg-white text-[11px] font-semibold text-sky-800">
            <button type="button" disabled={!onUpdate} onClick={() => setEditingIndex(index)} className="pressable flex min-w-0 items-center gap-1 px-2 py-1 text-left hover:bg-sky-100 disabled:cursor-default" title={onUpdate ? `Edit ${visualFilterLabel(filter)}` : visualFilterLabel(filter)}>
              <span className="truncate">{visualFilterLabel(filter)}</span>
              {onUpdate && <Pencil className="h-2.5 w-2.5 shrink-0 opacity-50" />}
            </button>
            <button type="button" onClick={() => onRemove(index)} className="pressable border-l border-sky-100 px-1.5 hover:bg-sky-100" aria-label={`Remove ${visualFilterLabel(filter)}`} title={`Remove ${visualFilterLabel(filter)}`}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <button type="button" onClick={onClear} className="pressable rounded-md border border-sky-200 bg-sky-100 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-sky-800 hover:bg-sky-200">
          Clear all
        </button>
      </div>
      {editingFilter && onUpdate && editingIndex !== null && (
        <FilterEditorDialog
          filter={editingFilter}
          onApply={(filter) => { onUpdate(editingIndex, filter); setEditingIndex(null); }}
          onCancel={() => setEditingIndex(null)}
          onRemove={() => { onRemove(editingIndex); setEditingIndex(null); }}
        />
      )}
    </>
  );
};
