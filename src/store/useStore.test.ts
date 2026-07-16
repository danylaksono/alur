import { beforeEach, describe, expect, it } from 'vitest';
import { useStore, type GISNode } from './useStore';

const fc = (count = 1): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: Array.from({ length: count }, (_, index) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [index, index] },
    properties: { id: index + 1 },
  })),
});

const node = (id: string, tableName?: string): GISNode => ({
  id,
  type: 'input',
  position: { x: 0, y: 0 },
  data: {
    label: id,
    type: 'input',
    config: tableName ? { tableName } : {},
  },
} as GISNode);

describe('layer state', () => {
  beforeEach(() => {
    useStore.getState().resetWorkspace();
    useStore.setState({ toasts: [] });
  });

  it('hydrates added map layers with durable UI metadata and selects them', () => {
    useStore.getState().addMapLayer({
      id: 'roads',
      name: 'Roads',
      geojson: fc(2),
      sourceKind: 'input',
    });

    const state = useStore.getState();
    expect(state.mapLayers[0]).toMatchObject({
      id: 'roads',
      visible: true,
      opacity: 0.8,
      featureCount: 2,
      sourceKind: 'input',
    });
    expect(state.selectedLayerId).toBe('roads');
    expect(state.mapLayers[0].geojson?.features[0].properties?._ymn_feature_id).toBe('1');
  });

  it('replaces repeated execution layers while preserving layer preferences', () => {
    const store = useStore.getState();
    store.addMapLayer({ id: 'exec-buffer', name: 'Buffer', geojson: fc(1), opacity: 0.5 });
    store.toggleMapLayerVisibility('exec-buffer');
    store.addMapLayer({ id: 'exec-buffer', name: 'Buffer rerun', geojson: fc(3) });

    const layer = useStore.getState().mapLayers[0];
    expect(useStore.getState().mapLayers).toHaveLength(1);
    expect(layer.name).toBe('Buffer rerun');
    expect(layer.featureCount).toBe(3);
    expect(layer.opacity).toBe(0.5);
    expect(layer.visible).toBe(false);
  });

  it('selecting a layer also selects the linked source node', () => {
    useStore.setState({ nodes: [node('input-a', 'a')] });
    useStore.getState().addMapLayer({
      id: 'a',
      name: 'A',
      geojson: fc(),
      sourceNodeId: 'input-a',
      sourceKind: 'input',
    });
    useStore.getState().setSelectedNodeId(null);

    useStore.getState().selectLayer('a');

    expect(useStore.getState().selectedLayerId).toBe('a');
    expect(useStore.getState().selectedNodeId).toBe('input-a');
  });

  it('creates a fresh focus request when zooming to a layer', () => {
    useStore.setState({ nodes: [node('input-a', 'a')] });
    useStore.getState().addMapLayer({
      id: 'a',
      name: 'A',
      geojson: fc(),
      sourceNodeId: 'input-a',
      sourceKind: 'input',
    });

    useStore.getState().focusLayer('a');

    const state = useStore.getState();
    expect(state.selectedLayerId).toBe('a');
    expect(state.selectedNodeId).toBe('input-a');
    expect(state.layerFocusRequest?.layerId).toBe('a');
    expect(state.layerFocusRequest?.requestedAt).toBeGreaterThan(0);
  });

  it('stores layer visualisations and can clear them', () => {
    const store = useStore.getState();
    store.addMapLayer({ id: 'areas', name: 'Areas', geojson: fc(3), sourceKind: 'manual' });

    store.updateLayerVisualisation('areas', {
      kind: 'categorical',
      field: 'id',
      method: 'categorical_top_n',
      categories: [{ value: '1', color: '#2563eb', count: 1 }],
      otherColor: '#94a3b8',
      nullColor: '#e2e8f0',
      opacity: 0.8,
    }, {
      title: 'id',
      kind: 'categorical',
      items: [{ label: '1', color: '#2563eb' }],
    });

    expect(useStore.getState().mapLayers[0].visualisation?.kind).toBe('categorical');
    expect(useStore.getState().mapLayers[0].legend?.title).toBe('id');

    store.clearLayerVisualisation('areas');

    expect(useStore.getState().mapLayers[0].visualisation).toBeUndefined();
    expect(useStore.getState().mapLayers[0].legend).toBeUndefined();
  });

  it('stores hover and feature selection independently from layer selection', () => {
    const store = useStore.getState();
    store.addMapLayer({ id: 'areas', name: 'Areas', geojson: fc(3), sourceKind: 'manual' });

    store.setHoveredFeature('areas', '2');
    store.toggleSelectedFeature('areas', '1');
    store.toggleSelectedFeature('areas', '3');

    expect(useStore.getState().visualAnalytics.layers.areas.hoveredFeatureId).toBe('2');
    expect(useStore.getState().visualAnalytics.layers.areas.selectedFeatureIds).toEqual(['1', '3']);
    expect(useStore.getState().selectedLayerId).toBe('areas');

    store.toggleSelectedFeature('areas', '1');
    expect(useStore.getState().visualAnalytics.layers.areas.selectedFeatureIds).toEqual(['3']);

    store.clearFeatureSelection('areas');
    expect(useStore.getState().visualAnalytics.layers.areas.selectedFeatureIds).toEqual([]);
  });

  it('sets multi-row selection atomically and focuses explicit bounds', () => {
    const store = useStore.getState();
    store.addMapLayer({ id: 'areas', name: 'Areas', geojson: fc(3), sourceKind: 'manual' });

    store.setFeatureSelection('areas', ['1', '2', '2', '3']);
    expect(useStore.getState().visualAnalytics.layers.areas.selectedFeatureIds).toEqual(['1', '2', '3']);

    const bounds: [[number, number], [number, number]] = [[-1, 50], [1, 52]];
    store.focusLayerBounds('areas', bounds);
    expect(useStore.getState().layerFocusRequest).toMatchObject({ layerId: 'areas', bounds });
  });

  it('removes visual analytics state when a layer is removed', () => {
    const store = useStore.getState();
    store.addMapLayer({ id: 'areas', name: 'Areas', geojson: fc(1), sourceKind: 'manual' });
    store.toggleSelectedFeature('areas', '1');
    store.addChart({
      id: 'chart-areas',
      title: 'Areas chart',
      layerId: 'areas',
      type: 'bar',
      dimensionField: 'id',
      aggregation: 'count',
      paletteId: 'categorical',
      maxCategories: 8,
    });

    store.removeMapLayer('areas');

    expect(useStore.getState().visualAnalytics.layers.areas).toBeUndefined();
    expect(useStore.getState().visualAnalytics.charts).toEqual([]);
  });

  it('stores chart specs and hover highlights alongside layer filters', () => {
    const store = useStore.getState();
    store.addMapLayer({ id: 'areas', name: 'Areas', geojson: fc(3), sourceKind: 'manual' });

    store.addChart({
      id: 'chart-1',
      title: 'ID distribution',
      layerId: 'areas',
      type: 'bar',
      dimensionField: 'id',
      aggregation: 'count',
      paletteId: 'categorical',
      maxCategories: 8,
    });
    store.updateChart('chart-1', { type: 'donut', title: 'ID share' });
    store.setHighlightedFeatures('areas', ['1', '2']);

    expect(useStore.getState().visualAnalytics.charts[0]).toMatchObject({
      id: 'chart-1',
      title: 'ID share',
      type: 'donut',
    });
    expect(useStore.getState().visualAnalytics.layers.areas.highlightedFeatureIds).toEqual(['1', '2']);

    store.removeChart('chart-1');
    expect(useStore.getState().visualAnalytics.charts).toEqual([]);
  });

  it('removing a node cleans up linked layers and active layer selection', () => {
    useStore.setState({
      nodes: [node('input-a', 'roads'), node('input-b', 'parcels')],
      selectedLayerId: 'roads',
    });
    useStore.getState().addMapLayer({
      id: 'roads',
      name: 'Roads',
      geojson: fc(),
      sourceNodeId: 'input-a',
      sourceKind: 'input',
    });
    useStore.getState().addMapLayer({
      id: 'parcels',
      name: 'Parcels',
      geojson: fc(),
      sourceNodeId: 'input-b',
      sourceKind: 'input',
    });
    useStore.getState().selectLayer('roads');

    useStore.getState().removeNode('input-a');

    expect(useStore.getState().mapLayers.map((layer) => layer.id)).toEqual(['parcels']);
    expect(useStore.getState().selectedLayerId).toBeNull();
  });
});
