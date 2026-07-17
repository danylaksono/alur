import { useMemo } from 'react';
import { X } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { SelectionSummary } from '../Visualisation/SelectionSummary';
import { SelectionExplain } from '../Visualisation/SelectionExplain';
import { ErrorBoundary } from '../ErrorBoundary';

/**
 * Floating overlay over the map showing details for the current feature
 * selection. Replaces the old fixed right-hand "Details" column.
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
  const layerState = selectedLayer ? visualAnalytics.layers[selectedLayer.id] : undefined;
  const selectedFeatureIds = layerState?.selectedFeatureIds || [];
  const filters = layerState?.filters || [];

  if (!selectedLayer || selectedFeatureIds.length === 0) return null;

  return (
    <div className="pointer-events-auto absolute left-4 top-4 z-10 max-h-[60%] w-80 overflow-y-auto rounded-lg border border-slate-200 bg-white/95 shadow-lg backdrop-blur">
      <div className="flex items-center justify-between border-b bg-slate-50/80 px-3 py-2">
        <span className="truncate text-xs font-semibold text-slate-600">
          Selection — {selectedLayer.name}
        </span>
        <button
          type="button"
          onClick={() => clearFeatureSelection(selectedLayer.id)}
          className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600"
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
    </div>
  );
};
