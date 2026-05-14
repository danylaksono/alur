import { useEffect, useState } from 'react';
import { Activity, Loader2 } from 'lucide-react';
import type { MapLayer } from '../../store/useStore';
import type { LayerAnalyticsSummary, VisualFilter } from '../../types/visualAnalytics';
import { queryLayerSummary } from '../../services/visualAnalyticsService';

const formatNumber = (value: number | null) => {
  if (value === null) return 'n/a';
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
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
  const [summary, setSummary] = useState<LayerAnalyticsSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!layer) {
        setSummary(null);
        return;
      }
      try {
        setIsLoading(true);
        const result = await queryLayerSummary({ layer, filters, selectedFeatureIds });
        if (!cancelled) setSummary(result);
      } catch {
        if (!cancelled) setSummary(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    run();
    return () => { cancelled = true; };
  }, [layer, filters, selectedFeatureIds]);

  return (
    <section className="border-t bg-white">
      <div className="flex items-center justify-between border-b bg-slate-50 px-4 py-2">
        <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
          <Activity className="h-3.5 w-3.5" />
          Summary
        </h3>
        {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
      </div>

      {!layer ? (
        <div className="px-4 py-3 text-[11px] text-slate-400">Select a layer to summarise.</div>
      ) : !summary ? (
        <div className="px-4 py-3 text-[11px] text-slate-400">No summary available.</div>
      ) : (
        <div className="space-y-3 px-4 py-3 text-[11px]">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Total</div>
              <div className="font-bold text-slate-800">{summary.totalRows.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Active</div>
              <div className="font-bold text-slate-800">{summary.filteredRows.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Selected</div>
              <div className="font-bold text-slate-800">{summary.selectedRows.toLocaleString()}</div>
            </div>
          </div>

          {summary.numericMetrics.slice(0, 2).map((metric) => (
            <div key={metric.field} className="rounded-md border border-slate-200 bg-slate-50 p-2">
              <div className="mb-1 truncate text-[9px] font-bold uppercase tracking-widest text-slate-500">
                {metric.field}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <span>Mean <b>{formatNumber(metric.mean)}</b></span>
                <span>Min <b>{formatNumber(metric.min)}</b></span>
                <span>Max <b>{formatNumber(metric.max)}</b></span>
              </div>
            </div>
          ))}

          {summary.categoryBreakdowns.slice(0, 1).map((category) => (
            <div key={category.field} className="space-y-1">
              <div className="truncate text-[9px] font-bold uppercase tracking-widest text-slate-400">{category.field}</div>
              {category.values.map((value) => (
                <div key={value.label} className="flex justify-between gap-2">
                  <span className="truncate text-slate-600">{value.label}</span>
                  <span className="font-bold text-slate-500">{value.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

