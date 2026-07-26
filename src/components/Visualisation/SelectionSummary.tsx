import { useEffect, useMemo, useState } from 'react';
import { Activity, Gauge, Loader2, Settings2 } from 'lucide-react';
import type { MapLayer } from '../../store/useStore';
import { useStore } from '../../store/useStore';
import type { LayerAnalyticsSummary, VisualFilter } from '../../types/visualAnalytics';
import { queryLayerSummary } from '../../services/visualAnalyticsService';
import { metadataForLayer } from '../../utils/datasetMetadata';

const STORAGE_KEY = 'alur-selection-summary-fields';

const loadPreferences = (): Record<string, string[]> => {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const formatNumber = (value: number | null) => {
  if (value === null) return 'n/a';
  return value.toLocaleString(undefined, { maximumFractionDigits: 2, notation: Math.abs(value) >= 100_000 ? 'compact' : 'standard' });
};

export const SelectionSummary = ({
  layer,
  filters,
  selectedFeatureIds,
}: {
  layer: MapLayer | null;
  filters: VisualFilter[];
  selectedFeatureIds: string[];
}) => {
  const addKpi = useStore((state) => state.addKpi);
  const [summary, setSummary] = useState<LayerAnalyticsSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [preferences, setPreferences] = useState<Record<string, string[]>>(loadPreferences);
  const [configuring, setConfiguring] = useState(false);
  const metadata = useMemo(() => layer ? metadataForLayer(layer) : null, [layer]);
  const defaults = useMemo(() => {
    if (!metadata) return [];
    const numeric = metadata.fields.filter((field) => field.semanticType === 'numeric').slice(0, 2);
    const categorical = metadata.fields.filter((field) => ['categorical', 'boolean'].includes(field.semanticType)).slice(0, 1);
    const selected = [...numeric, ...categorical].map((field) => field.name);
    return selected.length ? selected : metadata.fields.slice(0, 3).map((field) => field.name);
  }, [metadata]);
  const summaryFields = layer ? preferences[layer.id] || defaults : [];
  const filterKey = JSON.stringify(filters);
  const selectionKey = selectedFeatureIds.join('|');
  const fieldsKey = summaryFields.join('|');

  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  }, [preferences]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!layer) { setSummary(null); return; }
      try {
        setIsLoading(true);
        const result = await queryLayerSummary({ layer, filters, selectedFeatureIds, summaryFields });
        if (!cancelled) setSummary(result);
      } catch {
        if (!cancelled) setSummary(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [layer?.id, layer?.styleVersion, filterKey, selectionKey, fieldsKey]);

  const toggleField = (field: string) => {
    if (!layer) return;
    const current = preferences[layer.id] || defaults;
    const next = current.includes(field) ? current.filter((item) => item !== field) : current.length < 8 ? [...current, field] : current;
    setPreferences((value) => ({ ...value, [layer.id]: next }));
  };

  return (
    <section className="border-t bg-white">
      <div className="relative flex items-center justify-between border-b bg-slate-50 px-4 py-2">
        <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><Activity className="h-3.5 w-3.5" /> Summary</h3>
        <div className="flex items-center gap-1">
          {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
          {metadata && <button type="button" onClick={() => setConfiguring((value) => !value)} aria-expanded={configuring} className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700" title="Choose summary fields"><Settings2 className="h-3.5 w-3.5" /></button>}
        </div>
        {configuring && metadata && (
          <div className="absolute right-2 top-9 z-20 w-64 rounded-lg border border-slate-200 bg-white p-2 shadow-xl">
            <div className="px-1 pb-1 text-[9px] font-semibold uppercase tracking-wide text-slate-400">Pinned summary fields · up to 8</div>
            <div className="max-h-52 overflow-y-auto">
              {metadata.fields.map((field) => <label key={field.name} className="flex items-center gap-2 rounded px-1 py-1.5 text-[10px] text-slate-600 hover:bg-slate-50"><input type="checkbox" checked={summaryFields.includes(field.name)} onChange={() => toggleField(field.name)} className="h-3.5 w-3.5 accent-sky-600" /><span className="min-w-0 flex-1 truncate">{field.name}</span><span className="capitalize text-slate-300">{field.semanticType}</span></label>)}
            </div>
          </div>
        )}
      </div>

      {!layer ? <div className="px-4 py-3 text-[11px] text-slate-400">Select a layer to summarise.</div> : !summary ? <div className="px-4 py-3 text-[11px] text-slate-400">No summary available.</div> : (
        <div className="space-y-3 px-4 py-3 text-[11px]">
          <div className="grid grid-cols-3 gap-2">
            {[['Selected', summary.selectedRows], ['Active', summary.filteredRows], ['Total', summary.totalRows]].map(([label, value]) => <div key={String(label)}><div className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">{label}</div><div className="font-bold tabular-nums text-slate-800">{Number(value).toLocaleString()}</div></div>)}
          </div>
          {summary.selectedRows > 0 && summary.selectedRows < 5 && <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] leading-relaxed text-amber-800">This selection has fewer than five records; comparisons may be unstable and should be treated cautiously.</div>}

          {summary.numericMetrics.map((metric) => (
            <div key={metric.field} className="rounded-md border border-slate-200 bg-slate-50 p-2">
              <div className="mb-1.5 flex items-center justify-between gap-2"><div className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500">{metric.field} · mean</div><button type="button" onClick={() => addKpi({ id: `kpi-${Date.now()}`, datasetId: layer.id, title: `${metric.field} mean`, field: metric.field, aggregation: 'avg', comparison: 'total', format: 'compact' })} className="rounded p-1 text-slate-400 hover:bg-sky-100 hover:text-sky-700" title={`Pin mean ${metric.field}`}><Gauge className="h-3 w-3" /></button></div>
              <div className="grid grid-cols-3 gap-2 tabular-nums"><span><span className="block text-[9px] uppercase text-slate-400">Selected</span><b>{formatNumber(metric.selected.mean)}</b></span><span><span className="block text-[9px] uppercase text-slate-400">Active</span><b>{formatNumber(metric.active.mean)}</b></span><span><span className="block text-[9px] uppercase text-slate-400">Total</span><b>{formatNumber(metric.total.mean)}</b></span></div>
              <div className="mt-1 text-[9px] text-slate-400">Selected range {formatNumber(metric.selected.min)}–{formatNumber(metric.selected.max)}</div>
            </div>
          ))}

          {summary.categoryBreakdowns.map((category) => (
            <div key={category.field} className="space-y-1">
              <div className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400">{category.field}</div>
              <div className="grid grid-cols-[minmax(0,1fr)_2.5rem_2.5rem_2.5rem] gap-1 text-[9px] text-slate-400"><span>Value</span><span className="text-right">Sel.</span><span className="text-right">Act.</span><span className="text-right">All</span></div>
              {category.values.map((value) => <div key={value.label} className="grid grid-cols-[minmax(0,1fr)_2.5rem_2.5rem_2.5rem] gap-1 tabular-nums"><span className="truncate text-slate-600">{value.label}</span><b className="text-right text-slate-600">{value.selectedCount.toLocaleString()}</b><span className="text-right text-slate-400">{value.activeCount.toLocaleString()}</span><span className="text-right text-slate-400">{value.totalCount.toLocaleString()}</span></div>)}
            </div>
          ))}
          {!summary.numericMetrics.length && !summary.categoryBreakdowns.length && <div className="text-[10px] text-slate-400">Choose at least one summary field.</div>}
        </div>
      )}
    </section>
  );
};
