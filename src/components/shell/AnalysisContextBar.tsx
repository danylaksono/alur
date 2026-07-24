import { Database, Filter, GitCompareArrows, MousePointer2, RefreshCw, X } from 'lucide-react';
import { useStore } from '../../store/useStore';

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
  return <div className="flex min-h-10 shrink-0 items-center gap-2 overflow-x-auto border-b border-slate-200 bg-white px-3 py-1.5 text-[10px]" role="region" aria-label="Analysis context" tabIndex={0}>
    <span className="flex items-center gap-1.5 whitespace-nowrap font-bold text-slate-700"><Database className="h-3.5 w-3.5 text-slate-400" />{dataset?.name || 'No active dataset'}</span>
    <span className="h-4 w-px bg-slate-200" />
    <span className="flex items-center gap-1 whitespace-nowrap rounded-full bg-sky-50 px-2 py-1 font-semibold text-sky-700" title="Dataset-wide filters"><Filter className="h-3 w-3" />{filters.length} dataset {filters.length === 1 ? 'filter' : 'filters'}</span>
    <span className="flex items-center gap-1 whitespace-nowrap rounded-full bg-violet-50 px-2 py-1 font-semibold text-violet-700"><MousePointer2 className="h-3 w-3" />{selectionCount.toLocaleString()} selected</span>
    {comparison && <span className="flex items-center gap-1 whitespace-nowrap rounded-full bg-rose-50 px-2 py-1 font-semibold text-rose-700"><GitCompareArrows className="h-3 w-3" />{comparison.name}</span>}
    <span className="ml-auto flex items-center gap-1 whitespace-nowrap text-slate-600" title={dataset?.sourceUpdatedAt ? new Date(dataset.sourceUpdatedAt).toLocaleString() : 'Source freshness unavailable'}><RefreshCw className="h-3 w-3" />{dataset?.sourceUpdatedAt ? `Source ${new Date(dataset.sourceUpdatedAt).toLocaleDateString()}` : 'Freshness unknown'}</span>
    {datasetId && (filters.length > 0 || selectionCount > 0) && <button type="button" onClick={() => { clearLayerFilters(datasetId); clearFeatureSelection(datasetId); }} className="flex items-center gap-1 whitespace-nowrap rounded-md border border-slate-200 px-2 py-1 font-bold text-slate-500 hover:bg-slate-50"><X className="h-3 w-3" /> Clear context</button>}
  </div>;
};
