import { useStore } from '../store/useStore';
import type { MapEvidenceCapture } from '../types/story';
import type { ExplainCard } from '../types/visualAnalytics';
import { captureMapSnapshot } from './mapRegistry';

/**
 * Pins the current map view to the explanation.
 *
 * Lives in Explore rather than in the Report workspace because that is where
 * the map exists — the same rule charts, KPIs and comparisons already follow.
 * Capture has to happen while the thing being captured is on screen.
 */
export const pinMapEvidence = async (): Promise<boolean> => {
  const state = useStore.getState();
  const snapshot = await captureMapSnapshot();

  if (!snapshot) {
    state.addToast({ type: 'warning', message: 'The map is not available to capture right now.' });
    return false;
  }

  const visibleLayers = state.mapLayers.filter((layer) => layer.visible);
  const capture: MapEvidenceCapture = {
    ...snapshot,
    basemapId: state.selectedBasemapId,
    layers: visibleLayers.map((layer) => ({ name: layer.name, legend: layer.legend })),
  };

  const card: ExplainCard = {
    id: `explain-map-${Date.now()}`,
    sectionId: 'evidence',
    kind: 'map',
    title: visibleLayers.length ? `Map — ${visibleLayers.map((layer) => layer.name).join(', ')}`.slice(0, 90) : 'Map view',
    width: 12,
    height: 'tall',
    behaviour: 'frozen',
    frozenValues: capture,
    provenance: {
      capturedAt: snapshot.capturedAt,
      datasetIds: visibleLayers.map((layer) => layer.id),
      sourceVersions: Object.fromEntries(visibleLayers.map((layer) => [layer.id, state.datasetRegistry[layer.id]?.sourceUpdatedAt])),
      filtersByDataset: Object.fromEntries(
        visibleLayers
          .map((layer) => [layer.id, state.visualAnalytics.datasets[layer.id]?.filters || []] as const)
          .filter(([, filters]) => filters.length),
      ),
      caveats: snapshot.failureReason ? [snapshot.failureReason] : [],
    },
  };

  state.addExplainCard(card);
  state.addToast({
    type: snapshot.failureReason ? 'warning' : 'success',
    message: snapshot.failureReason
      ? `Pinned the map view, but without an image: ${snapshot.failureReason}`
      : 'Pinned the current map view to your explanation.',
  });
  return !snapshot.failureReason;
};
