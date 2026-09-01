import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './useStore';
import type { AnalysisVariant } from '../types/visualAnalytics';

/**
 * Standing in a scenario, as the store enacts it.
 *
 * The unit rules live in `scenarioResolution.test.ts`; these assert that the
 * store actually applies them — that switching a chip moves the map, that a run
 * landing mid-sweep does not leave every result stacked, and that layers no
 * scenario owns are never touched.
 */

const fc = (n: number): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: Array.from({ length: n }, (_, index) => ({
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: [index, index] },
    properties: { id: index },
  })),
});

const variant = (id: string, output?: string): AnalysisVariant => ({
  id,
  name: id,
  baselineDatasetId: 'baseline',
  workflowOutputDatasetId: output,
  parameters: {},
  assumptions: [],
  operations: [],
  createdAt: 1,
  provenance: { workflowNodeIds: [] },
});

const visibility = () =>
  Object.fromEntries(useStore.getState().mapLayers.map((layer) => [layer.id, layer.visible]));

describe('standing in a scenario', () => {
  beforeEach(() => {
    useStore.getState().resetWorkspace();
    const store = useStore.getState();
    store.addMapLayer({ id: 'baseline', name: 'Baseline', geojson: fc(1), sourceKind: 'input' });
    store.addMapLayer({ id: 'result-a', name: 'A', geojson: fc(1), sourceKind: 'workflow' });
    store.addMapLayer({ id: 'result-b', name: 'B', geojson: fc(1), sourceKind: 'workflow' });
    store.addVariant(variant('v-a', 'result-a'));
    store.addVariant(variant('v-b', 'result-b'));
  });

  it('shows the chosen scenario and hides the other', () => {
    useStore.getState().setActiveVariant('v-a');

    expect(visibility()).toEqual({ baseline: true, 'result-a': true, 'result-b': false });
  });

  it('swaps cleanly when the analyst moves to another scenario', () => {
    useStore.getState().setActiveVariant('v-a');
    useStore.getState().setActiveVariant('v-b');

    expect(visibility()).toEqual({ baseline: true, 'result-a': false, 'result-b': true });
  });

  it('hides every result when standing on the baseline', () => {
    useStore.getState().setActiveVariant('v-a');
    useStore.getState().setActiveVariant(undefined);

    expect(visibility()).toEqual({ baseline: true, 'result-a': false, 'result-b': false });
  });

  it('never touches a layer no scenario produced', () => {
    // The analyst hid the baseline on purpose; entering a scenario must not
    // quietly bring it back.
    useStore.getState().toggleMapLayerVisibility('baseline');
    useStore.getState().setActiveVariant('v-a');

    expect(visibility().baseline).toBe(false);
  });

  it('follows the result into the table when there is one', () => {
    useStore.getState().setActiveVariant('v-a');

    expect(useStore.getState().selectedLayerId).toBe('result-a');
  });

  it('leaves the table alone for a scenario that has not run', () => {
    const store = useStore.getState();
    store.addVariant(variant('v-c'));
    store.selectLayer('baseline');

    useStore.getState().setActiveVariant('v-c');

    // Pointing the table at a scenario with no result would empty it to make a
    // point; the bar says "not run" instead.
    expect(useStore.getState().selectedLayerId).toBe('baseline');
  });

  it('reconciles when a run produces a result while a scenario is open', () => {
    const store = useStore.getState();
    store.addVariant(variant('v-c'));
    useStore.getState().setActiveVariant('v-c');
    useStore.getState().addMapLayer({ id: 'result-c', name: 'C', geojson: fc(1), sourceKind: 'workflow' });

    useStore.getState().updateVariant('v-c', { workflowOutputDatasetId: 'result-c' });

    expect(visibility()).toEqual({
      baseline: true,
      'result-a': false,
      'result-b': false,
      'result-c': true,
    });
  });

  it('leaves a sweep showing only the scenario being stood in', () => {
    const store = useStore.getState();
    store.addVariant(variant('v-c'));
    store.addVariant(variant('v-d'));
    useStore.getState().setActiveVariant('v-c');

    // A sweep registers each run's layer as it finishes, all visible by default.
    for (const [layerId, variantId] of [['result-c', 'v-c'], ['result-d', 'v-d']] as const) {
      useStore.getState().addMapLayer({ id: layerId, name: layerId, geojson: fc(1), sourceKind: 'workflow' });
      useStore.getState().updateVariant(variantId, { workflowOutputDatasetId: layerId });
    }

    expect(visibility()).toEqual({
      baseline: true,
      'result-a': false,
      'result-b': false,
      'result-c': true,
      'result-d': false,
    });
  });
});
