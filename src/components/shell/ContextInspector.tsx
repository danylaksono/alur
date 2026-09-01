import { useMemo } from 'react';
import { X } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { SelectionSummary } from '../Visualisation/SelectionSummary';
import { SelectionExplain } from '../Visualisation/SelectionExplain';
import { ErrorBoundary } from '../ErrorBoundary';

/**
 * Docked on desktop so evidence never obscures the map; a bottom sheet on
 * compact viewports where a side dock would leave too little map.
 */
export const ContextInspector = () => {
  const mapLayers = useStore((s) => s.mapLayers);
  const selectedLayerId = useStore((s) => s.selectedLayerId);
  const visualAnalytics = useStore((s) => s.visualAnalytics);
  const clearFeatureSelection = useStore((s) => s.clearFeatureSelection);

  const selectedLayer = useMemo(
    () => mapLayers.find((layer) => layer.id === selectedLayerId) || null,
    [mapLayers, selectedLayerId]
  );
  const layerState = selectedLayer ? visualAnalytics.datasets[selectedLayer.id] : undefined;
  const selectedFeatureIds = layerState?.selectedFeatureIds || [];
  const filters = layerState?.filters || [];

  if (!selectedLayer || selectedFeatureIds.length === 0) return null;

  return (
    <aside className="pointer-events-auto absolute inset-x-2 bottom-2 z-20 max-h-[55%] overflow-y-auto rounded-xl border border-slate-200 bg-white/95 shadow-xl backdrop-blur xl:static xl:z-auto xl:h-full xl:max-h-none xl:w-80 xl:shrink-0 xl:rounded-none xl:border-y-0 xl:border-r-0 xl:bg-white xl:shadow-none">
      <div className="flex items-center justify-between border-b bg-slate-50/80 px-3 py-2">
        <span className="truncate text-xs font-semibold text-slate-600">
          Selection — {selectedLayer.name}
        </span>
        <button
          type="button"
          onClick={() => clearFeatureSelection(selectedLayer.id)}
          className="pressable rounded p-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600"
          title="Clear selection"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <ErrorBoundary name="Selection Summary">
        <SelectionSummary
          layer={selectedLayer}
          filters={filters}
          selectedFeatureIds={selectedFeatureIds}
        />
      </ErrorBoundary>
      <ErrorBoundary name="Selection Explain">
        <SelectionExplain layer={selectedLayer} selectedFeatureIds={selectedFeatureIds} />
      </ErrorBoundary>
    </aside>
  );
};
