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
