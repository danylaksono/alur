import { useCallback, useMemo } from 'react';
import { queryLayerSelectionBounds } from '../services/visualAnalyticsService';
import { useStore } from '../store/useStore';
import type { AnalyticsCommand } from '../types/analyticsCommands';
import { executeAnalyticsCommand } from '../utils/analyticsCommands';
import { metadataForLayer } from '../utils/datasetMetadata';

export const useAnalyticsCommands = () => {
  const mapLayers = useStore((state) => state.mapLayers);
  const datasets = useMemo(() => mapLayers.map(metadataForLayer), [mapLayers]);

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
      selectDataset: state.selectLayer,
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
