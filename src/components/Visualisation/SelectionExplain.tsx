import { useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import type { MapLayer } from '../../store/useStore';
import type { SelectionExplanation } from '../../types/visualAnalytics';
import { explainLayerSelection } from '../../services/visualAnalyticsService';

const formatNumber = (value: number) =>
  Math.abs(value) >= 1000
    ? value.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : value.toLocaleString(undefined, { maximumFractionDigits: 2 });

const formatShare = (value: number) => `${(value * 100).toFixed(value >= 0.1 ? 0 : 1)}%`;

const PairBars = ({
  selectedValue,
  restValue,
  selectedLabel,
  restLabel,
}: {
  selectedValue: number;
  restValue: number;
  selectedLabel: string;
  restLabel: string;
}) => {
  const max = Math.max(Math.abs(selectedValue), Math.abs(restValue), 1e-9);
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1.5">
        <span className="w-10 shrink-0 text-[11px] text-sky-700">sel</span>
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
          <span
            className="block h-full rounded-full bg-sky-500"
            style={{ width: `${(Math.abs(selectedValue) / max) * 100}%` }}
          />
        </span>
        <span className="w-14 shrink-0 text-right text-[11px] font-bold tabular-nums text-slate-700">{selectedLabel}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-10 shrink-0 text-[11px] text-slate-400">rest</span>
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
          <span
            className="block h-full rounded-full bg-slate-300"
            style={{ width: `${(Math.abs(restValue) / max) * 100}%` }}
          />
        </span>
        <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-slate-500">{restLabel}</span>
      </div>
    </div>
  );
};

export const SelectionExplain = ({
  layer,
  selectedFeatureIds,
}: {
  layer: MapLayer;
  selectedFeatureIds: string[];
}) => {
  const [explanation, setExplanation] = useState<SelectionExplanation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const selectionKey = selectedFeatureIds.join('|');

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (selectedFeatureIds.length < 2) {
        setExplanation(null);
        return;
      }
      try {
        setIsLoading(true);
        const result = await explainLayerSelection({ layer, selectedFeatureIds });
        if (!cancelled) setExplanation(result);
      } catch {
        if (!cancelled) setExplanation(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [layer.id, layer.styleVersion, selectionKey]);

  if (selectedFeatureIds.length < 2) return null;

  return (
    <section className="border-t bg-white">
      <div className="flex items-center justify-between border-b bg-slate-50 px-4 py-2">
        <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <Sparkles className="h-3.5 w-3.5" />
          What sets it apart
        </h3>
        {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
      </div>

      {!explanation || !explanation.fields.length ? (
        <div className="px-4 py-3 text-[11px] text-slate-400">
          {isLoading ? 'Comparing selection against the rest…' : 'No clear differences found.'}
        </div>
      ) : (
        <div className="space-y-2.5 px-4 py-3">
          {explanation.fields.filter((item) => item.score > 0.05).slice(0, 5).map((item) => (
            <div key={item.field} className="rounded-md border border-slate-200 bg-slate-50 p-2">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500">{item.field}</span>
                <span
                  className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-sky-700"
                  title={item.kind === 'numeric' ? 'Standardized mean difference' : 'Share divergence'}
                >
                  {item.score >= 10 ? '10+' : item.score.toFixed(2)}
                </span>
              </div>
              {item.kind === 'numeric' ? (
                <PairBars
                  selectedValue={item.selectedMean}
                  restValue={item.restMean}
                  selectedLabel={formatNumber(item.selectedMean)}
                  restLabel={formatNumber(item.restMean)}
                />
              ) : (
                <div className="space-y-1.5">
                  {item.categories.map((category) => (
                    <div key={category.label}>
                      <div className="mb-0.5 truncate text-[11px] text-slate-600">{category.label}</div>
                      <PairBars
                        selectedValue={category.selectedShare}
                        restValue={category.restShare}
                        selectedLabel={formatShare(category.selectedShare)}
                        restLabel={formatShare(category.restShare)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          <p className="text-[10px] leading-relaxed text-slate-400">
            {explanation.selectedCount.toLocaleString()} selected vs {explanation.restCount.toLocaleString()} others.
            Ranked by effect size.
          </p>
        </div>
      )}
    </section>
  );
};
