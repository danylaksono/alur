import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import { LayerManager } from '../LayerManager';
import { ErrorBoundary } from '../ErrorBoundary';

const VisualisationPanel = lazy(() => import('../Visualisation/VisualisationPanel').then((module) => ({ default: module.VisualisationPanel })));

/**
 * Two views in one panel: the layer list, and — when the user asks to style a
 * layer — the style editor with a back header. The editor never competes with
 * the list for space.
 */
export const LayersTab = () => {
  const [stylingLayerId, setStylingLayerId] = useState<string | null>(null);
  const [initialStyleField, setInitialStyleField] = useState<string | undefined>();
  const mapLayers = useStore((s) => s.mapLayers);
  const selectLayer = useStore((s) => s.selectLayer);
  const layerStyleRequest = useStore((s) => s.ui.layerStyleRequest);

  const stylingLayer = useMemo(
    () => mapLayers.find((layer) => layer.id === stylingLayerId) || null,
    [mapLayers, stylingLayerId]
  );

  // If the styled layer is removed, fall back to the list.
  useEffect(() => {
    if (stylingLayerId && !stylingLayer) setStylingLayerId(null);
  }, [stylingLayerId, stylingLayer]);

  useEffect(() => {
    if (!layerStyleRequest || !mapLayers.some((layer) => layer.id === layerStyleRequest.layerId)) return;
    selectLayer(layerStyleRequest.layerId);
    setInitialStyleField(layerStyleRequest.field);
    setStylingLayerId(layerStyleRequest.layerId);
  }, [layerStyleRequest, mapLayers, selectLayer]);

  if (stylingLayer) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <ErrorBoundary name="Visualisation Panel">
          <Suspense fallback={<div className="p-4 text-xs text-slate-400" role="status">Loading style editor…</div>}><VisualisationPanel
            layer={stylingLayer}
            initialField={initialStyleField}
            onBack={() => {
              setInitialStyleField(undefined);
              setStylingLayerId(null);
            }}
          /></Suspense>
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
            setInitialStyleField(undefined);
            setStylingLayerId(layerId);
          }}
        />
      </ErrorBoundary>
    </div>
  );
};
