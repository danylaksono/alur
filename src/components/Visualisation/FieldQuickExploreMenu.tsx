import { useEffect, useRef, useState } from 'react';
import { BarChart3, Filter, Gauge, MoreHorizontal, Palette, ScanSearch } from 'lucide-react';
import type { DatasetField } from '../../types/datasets';
import type { VisualFilter } from '../../types/visualAnalytics';
import { defaultFilterForField } from '../../utils/visualFilters';

export const FieldQuickExploreMenu = ({
  field,
  onChart,
  onFilter,
  onProfile,
  onStyle,
  onPinMetric,
}: {
  field: DatasetField;
  onChart?: () => void;
  onFilter: (filter: VisualFilter) => void;
  onProfile: () => void;
  onStyle?: () => void;
  onPinMetric?: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const act = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div ref={rootRef} className="relative">
      <button type="button" onClick={() => setOpen((current) => !current)} aria-label={`Explore ${field.name}`} aria-expanded={open} aria-haspopup="menu" title={`Explore ${field.name}`} className="pressable flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div role="menu" aria-label={`Quick Explore ${field.name}`} className="absolute right-0 top-8 z-50 w-52 rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl">
          <div className="border-b border-slate-100 px-2 pb-1.5 pt-1">
            <div className="truncate text-xs font-bold text-slate-700">{field.name}</div>
            <div className="text-[11px] capitalize text-slate-500">{field.semanticType} · {field.type}</div>
          </div>
          {onChart && <button role="menuitem" type="button" onClick={() => act(onChart)} className="pressable mt-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50"><BarChart3 className="h-3.5 w-3.5 text-sky-600" /> Create chart</button>}
          <button role="menuitem" type="button" onClick={() => act(() => onFilter(defaultFilterForField(field)))} className="pressable flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50"><Filter className="h-3.5 w-3.5 text-sky-600" /> Filter field</button>
          <button role="menuitem" type="button" onClick={() => act(onProfile)} className="pressable flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50"><ScanSearch className="h-3.5 w-3.5 text-sky-600" /> Profile field</button>
          {onPinMetric && <button role="menuitem" type="button" onClick={() => act(onPinMetric)} className="pressable flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50"><Gauge className="h-3.5 w-3.5 text-sky-600" /> Pin metric</button>}
          {onStyle && <button role="menuitem" type="button" onClick={() => act(onStyle)} className="pressable flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50"><Palette className="h-3.5 w-3.5 text-sky-600" /> Style map</button>}
        </div>
      )}
    </div>
  );
};
