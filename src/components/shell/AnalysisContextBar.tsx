import { Database, Filter, GitCompareArrows, MousePointer2, RefreshCw, X } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { cn } from '../../utils/cn';

/**
 * Renders only when there is context to report. A permanent bar reading
 * "No active dataset · 0 filters · 0 selected" costs a row of vertical chrome
 * to say nothing, so each chip appears only once it carries a value.
 */
export const AnalysisContextBar = () => {
  const selectedLayerId = useStore((state) => state.selectedLayerId);
  const selectedNodeId = useStore((state) => state.selectedNodeId);
  const datasets = useStore((state) => state.datasetRegistry);
  const interactions = useStore((state) => state.visualAnalytics.datasets);
  const activeComparisonId = useStore((state) => state.visualAnalytics.activeComparisonId);
  const comparison = useStore((state) => state.visualAnalytics.comparisons.find((item) => item.id === activeComparisonId));
  const clearLayerFilters = useStore((state) => state.clearLayerFilters);
  const clearFeatureSelection = useStore((state) => state.clearFeatureSelection);

  const datasetId = selectedLayerId || (selectedNodeId ? `workflow:${selectedNodeId}` : null);
  const dataset = datasetId ? datasets[datasetId] : undefined;
  const state = datasetId ? interactions[datasetId] : undefined;
  const filters = state?.filters || [];
  const selectionCount = state?.selectedFeatureIds.length || 0;

  if (!dataset && !comparison) return null;

  const isClearable = Boolean(datasetId) && (filters.length > 0 || selectionCount > 0);

  return (
    <div
      className="flex min-h-9 shrink-0 items-center gap-2 overflow-x-auto border-b border-slate-200 bg-white px-3 py-1.5 text-[10px]"
      role="region"
      aria-label="Analysis context"
      tabIndex={0}
    >
      {dataset && (
        <span className="flex items-center gap-1.5 whitespace-nowrap font-bold text-slate-700">
          <Database className="h-3.5 w-3.5 text-slate-400" />{dataset.name}
        </span>
      )}

      {filters.length > 0 && (
        <span className="flex items-center gap-1 whitespace-nowrap rounded-full bg-sky-50 px-2 py-1 font-semibold text-sky-700" title="Dataset-wide filters">
          <Filter className="h-3 w-3" />{filters.length} dataset {filters.length === 1 ? 'filter' : 'filters'}
        </span>
      )}

      {selectionCount > 0 && (
        <span className="flex items-center gap-1 whitespace-nowrap rounded-full bg-violet-50 px-2 py-1 font-semibold text-violet-700">
          <MousePointer2 className="h-3 w-3" />{selectionCount.toLocaleString()} selected
        </span>
      )}

      {comparison && (
        <span className="flex items-center gap-1 whitespace-nowrap rounded-full bg-rose-50 px-2 py-1 font-semibold text-rose-700">
          <GitCompareArrows className="h-3 w-3" />{comparison.name}
        </span>
      )}

      {dataset?.sourceUpdatedAt && (
        <span
          className="ml-auto flex items-center gap-1 whitespace-nowrap text-slate-500"
          title={new Date(dataset.sourceUpdatedAt).toLocaleString()}
        >
          <RefreshCw className="h-3 w-3" />Source {new Date(dataset.sourceUpdatedAt).toLocaleDateString()}
        </span>
      )}

      {isClearable && (
        <button
          type="button"
          onClick={() => {
            clearLayerFilters(datasetId!);
            clearFeatureSelection(datasetId!);
          }}
          className={cn(
            'flex items-center gap-1 whitespace-nowrap rounded-md border border-slate-200 px-2 py-1 font-bold text-slate-500 hover:bg-slate-50',
            !dataset?.sourceUpdatedAt && 'ml-auto',
          )}
        >
          <X className="h-3 w-3" /> Clear context
        </button>
      )}
    </div>
  );
};
