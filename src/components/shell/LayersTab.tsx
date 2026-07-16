import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import { LayerManager } from '../LayerManager';
import { VisualisationPanel } from '../Visualisation/VisualisationPanel';
import { ErrorBoundary } from '../ErrorBoundary';

/**
 * Two views in one panel: the layer list, and — when the user asks to style a
 * layer — the style editor with a back header. The editor never competes with
 * the list for space.
 */
export const LayersTab = () => {
  const [stylingLayerId, setStylingLayerId] = useState<string | null>(null);
  const mapLayers = useStore((s) => s.mapLayers);
  const selectLayer = useStore((s) => s.selectLayer);

  const stylingLayer = useMemo(
    () => mapLayers.find((layer) => layer.id === stylingLayerId) || null,
    [mapLayers, stylingLayerId]
  );

  // If the styled layer is removed, fall back to the list.
  useEffect(() => {
    if (stylingLayerId && !stylingLayer) setStylingLayerId(null);
  }, [stylingLayerId, stylingLayer]);

  if (stylingLayer) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <ErrorBoundary name="Visualisation Panel">
          <VisualisationPanel layer={stylingLayer} onBack={() => setStylingLayerId(null)} />
        </ErrorBoundary>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <ErrorBoundary name="Layer Manager">
        <LayerManager
          onEditStyle={(layerId) => {
            selectLayer(layerId);
            setStylingLayerId(layerId);
          }}
        />
      </ErrorBoundary>
    </div>
  );
};
