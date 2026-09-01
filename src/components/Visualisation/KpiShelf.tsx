import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Gauge, Loader2, Trash2 } from 'lucide-react';
import { useStore, type MapLayer } from '../../store/useStore';
import type { KpiFormat, KpiResult, KpiSpec } from '../../types/visualAnalytics';
import { queryLayerKpi, queryTableKpi } from '../../services/visualAnalyticsService';
import type { DatasetDescriptor } from '../../types/datasets';

const formatKpiValue = (value: number | null, spec: KpiSpec) => {
  if (value === null || !Number.isFinite(value)) return 'n/a';
  if (spec.format === 'percent') return new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 }).format(value);
  if (spec.format === 'currency') return new Intl.NumberFormat(undefined, { style: 'currency', currency: spec.unit || 'GBP', maximumFractionDigits: 0 }).format(value);
  return new Intl.NumberFormat(undefined, {
    notation: spec.format === 'compact' ? 'compact' : 'standard',
    maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0,
  }).format(value);
};

const KpiCard = ({ spec, dataset, layer, index, count }: { spec: KpiSpec; dataset: DatasetDescriptor; layer?: MapLayer; index: number; count: number }) => {
  const filters = useStore((state) => state.visualAnalytics.datasets[spec.datasetId]?.filters || []);
  const selectedFeatureIds = useStore((state) => state.visualAnalytics.datasets[spec.datasetId]?.selectedFeatureIds || []);
  const updateKpi = useStore((state) => state.updateKpi);
  const removeKpi = useStore((state) => state.removeKpi);
  const reorderKpi = useStore((state) => state.reorderKpi);
  const [result, setResult] = useState<KpiResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const filterKey = JSON.stringify(filters);
  const selectionKey = selectedFeatureIds.join('|');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    const query = layer
      ? queryLayerKpi({ layer, filters, spec, selectedFeatureIds })
      : dataset.relationName
        ? queryTableKpi({ tableName: dataset.relationName, rowIdColumn: dataset.rowIdColumn, filters, spec, selectedFeatureIds })
        : Promise.reject(new Error('Dataset relation is unavailable'));
    query
      .then((next) => { if (!cancelled) setResult(next); })
      .catch(() => { if (!cancelled) { setResult(null); setError(true); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [layer, dataset, filterKey, selectionKey, spec]);

  const delta = result?.delta;
  return (
    <article className="group relative w-56 shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm" aria-label={`${spec.title} metric`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <input value={spec.title} onChange={(event) => updateKpi(spec.id, { title: event.target.value })} aria-label="Metric title" className="w-full truncate bg-transparent text-[10px] font-semibold uppercase tracking-wide text-slate-500 outline-none focus-visible:ring-2 focus-visible:ring-sky-400" />
          <div className="mt-0.5 truncate text-[9px] text-slate-400" title={dataset.name}>{dataset.name} · {spec.aggregation}{spec.field ? ` ${spec.field}` : ' rows'}</div>
        </div>
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-300" /> : <Gauge className="h-3.5 w-3.5 text-sky-500" />}
      </div>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        <div className="truncate text-xl font-extrabold tabular-nums text-slate-800">{error ? 'error' : formatKpiValue(result?.value ?? null, spec)}{spec.unit && spec.format !== 'currency' ? <span className="ml-1 text-[10px] font-semibold text-slate-400">{spec.unit}</span> : null}</div>
        {delta !== null && delta !== undefined && (
          <span className={`rounded px-1 py-0.5 text-[9px] font-bold tabular-nums ${delta > 0 ? 'bg-emerald-50 text-emerald-700' : delta < 0 ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-500'}`} title="Difference from unfiltered total">
            {delta > 0 ? '+' : ''}{new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 }).format(delta)}
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-[9px] text-slate-400">
        <span>{result ? `${result.activeRows.toLocaleString()} active / ${result.totalRows.toLocaleString()} total rows` : 'Loading scope…'}</span>
        {result?.comparisonNote && <span title={result.comparisonNote}>comparison n/a</span>}
      </div>
      <div className="mt-2 flex items-center gap-1 border-t border-slate-100 pt-1.5">
        <label className="sr-only" htmlFor={`kpi-comparison-${spec.id}`}>Comparison</label>
        <select id={`kpi-comparison-${spec.id}`} value={spec.comparison} onChange={(event) => updateKpi(spec.id, { comparison: event.target.value as KpiSpec['comparison'] })} className="h-6 min-w-0 flex-1 rounded border border-slate-200 bg-white px-1 text-[9px] text-slate-500 outline-none focus:border-sky-400">
          <option value="none">No comparison</option>
          <option value="total">Compare total</option>
          <option value="previous-period">Previous period</option>
          <option value="cohort">Cohort</option>
        </select>
        <label className="sr-only" htmlFor={`kpi-format-${spec.id}`}>Number format</label>
        <select id={`kpi-format-${spec.id}`} value={spec.format || 'number'} onChange={(event) => updateKpi(spec.id, { format: event.target.value as KpiFormat })} className="h-6 w-16 rounded border border-slate-200 bg-white px-1 text-[9px] text-slate-500 outline-none focus:border-sky-400">
          <option value="number">Number</option><option value="compact">Compact</option><option value="percent">Percent</option><option value="currency">Currency</option>
        </select>
        <button type="button" disabled={index === 0} onClick={() => reorderKpi(spec.id, index - 1)} aria-label={`Move ${spec.title} left`} className="pressable rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-25"><ArrowLeft className="h-3 w-3" /></button>
        <button type="button" disabled={index === count - 1} onClick={() => reorderKpi(spec.id, index + 1)} aria-label={`Move ${spec.title} right`} className="pressable rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-25"><ArrowRight className="h-3 w-3" /></button>
        <button type="button" onClick={() => removeKpi(spec.id)} aria-label={`Remove ${spec.title}`} className="pressable rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-3 w-3" /></button>
      </div>
    </article>
  );
};

export const KpiShelf = () => {
  const kpis = useStore((state) => state.visualAnalytics.kpis);
  const layers = useStore((state) => state.mapLayers);
  const datasetRegistry = useStore((state) => state.datasetRegistry);
  if (!kpis.length) return null;
  return (
    <section aria-label="Pinned metrics" className="flex shrink-0 items-stretch gap-2 overflow-x-auto border-b border-slate-200 bg-slate-50/90 px-3 py-2">
      {kpis.map((spec, index) => {
        const layer = layers.find((item) => item.id === spec.datasetId);
        const dataset = datasetRegistry[spec.datasetId];
        return dataset ? <KpiCard key={spec.id} spec={spec} dataset={dataset} layer={layer} index={index} count={kpis.length} /> : null;
      })}
    </section>
  );
};
