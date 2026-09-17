import { useCallback, useMemo } from 'react';
import { queryLayerSelectionBounds } from '../services/visualAnalyticsService';
import { useStore } from '../store/useStore';
import type { AnalyticsCommand } from '../types/analyticsCommands';
import { executeAnalyticsCommand } from '../utils/analyticsCommands';
import { metadataForDataset, metadataForLayer } from '../utils/datasetMetadata';

export const useAnalyticsCommands = () => {
  const mapLayers = useStore((state) => state.mapLayers);
  const datasetRegistry = useStore((state) => state.datasetRegistry);
  // Layers describe themselves more richly (CRS, geometry), so they win over
  // their registry entry; everything else registered is a table to explore.
  const datasets = useMemo(() => {
    const layerIds = new Set(mapLayers.map((layer) => layer.id));
    return [
      ...mapLayers.map(metadataForLayer),
      ...Object.values(datasetRegistry).filter((dataset) => !layerIds.has(dataset.id)).map(metadataForDataset),
    ];
  }, [mapLayers, datasetRegistry]);

  return useCallback(async (command: AnalyticsCommand) => {
    const state = useStore.getState();
    return executeAnalyticsCommand(command, {
      datasets,
      visualAnalytics: state.visualAnalytics,
      addChart: state.addChart,
      addKpi: state.addKpi,
      setLayerFilters: state.setLayerFilters,
      clearLayerFilters: state.clearLayerFilters,
      updateLayerVisualisation: state.updateLayerVisualisation,
      openLayerStyle: state.requestLayerStyle,
      openChartsPanel: () => state.setActiveRailTab('charts'),
      selectDataset: (datasetId) => {
        const latest = useStore.getState();
        const source = latest.datasetRegistry[datasetId]?.source;
        if (source?.kind === 'workflow-node') latest.setSelectedNodeId(source.nodeId);
        else if (latest.mapLayers.some((layer) => layer.id === datasetId)) latest.selectLayer(datasetId);
      },
      focusSelection: async (datasetId) => {
        const latest = useStore.getState();
        const layer = latest.mapLayers.find((candidate) => candidate.id === datasetId);
        const featureIds = latest.visualAnalytics.datasets[datasetId]?.selectedFeatureIds || [];
        if (!layer || !featureIds.length) return false;
        const bounds = await queryLayerSelectionBounds(layer, featureIds);
        if (!bounds) return false;
        useStore.getState().focusLayerBounds(datasetId, bounds);
        return true;
      },
    });
  }, [datasets]);
};
