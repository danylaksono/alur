import { describe, expect, it } from 'vitest';
import type { VisualAnalyticsState } from '../types/visualAnalytics';
import {
  captureAnalysisSnapshot,
  emptyAnalysisHistory,
  recordAnalysisHistory,
  redoAnalysisHistory,
  restoreAnalysisSnapshot,
  undoAnalysisHistory,
} from './analysisHistory';

const mapLayers = [{
  id: 'areas',
  name: 'Areas',
  visible: true,
  opacity: 0.8,
  styleVersion: 1,
}];

const analytics = (filters: VisualAnalyticsState['datasets'][string]['filters'] = []): VisualAnalyticsState => ({
  datasets: { areas: { selectedFeatureIds: [], filters, hoveredFeatureId: 'hovered' } },
  charts: [],
  kpis: [],
  cohorts: [],
  bookmarks: [],
});

describe('analysis history', () => {
  it('captures only durable interaction and presentation state', () => {
    const snapshot = captureAnalysisSnapshot({ mapLayers, visualAnalytics: analytics() });
    expect(snapshot.layerPresentation[0]).not.toHaveProperty('styleVersion');
    expect(snapshot.layerInteractions.areas).toEqual({ selectedFeatureIds: [], filters: [] });
    expect(snapshot.layerInteractions.areas).not.toHaveProperty('hoveredFeatureId');
  });

  it('coalesces rapid updates with the same key', () => {
    const first = recordAnalysisHistory(emptyAnalysisHistory(), captureAnalysisSnapshot({ mapLayers, visualAnalytics: analytics() }), {
      label: 'Change opacity',
      coalesceKey: 'layer:areas:opacity',
    }, 1_000);
    const second = recordAnalysisHistory(first, captureAnalysisSnapshot({ mapLayers, visualAnalytics: analytics() }), {
      label: 'Change opacity',
      coalesceKey: 'layer:areas:opacity',
    }, 1_500);
    expect(second.past).toHaveLength(1);
  });

  it('moves snapshots between undo and redo stacks', () => {
    const before = captureAnalysisSnapshot({ mapLayers, visualAnalytics: analytics() });
    const after = captureAnalysisSnapshot({
      mapLayers,
      visualAnalytics: analytics([{ kind: 'range', field: 'score', min: 10 }]),
    });
    const recorded = recordAnalysisHistory(emptyAnalysisHistory(), before, { label: 'Filter score' }, 1_000);
    const undone = undoAnalysisHistory(recorded, after, 2_000)!;
    expect(undone.snapshot).toEqual(before);
    expect(undone.history.past).toHaveLength(0);
    expect(undone.history.future).toHaveLength(1);

    const redone = redoAnalysisHistory(undone.history, before, 3_000)!;
    expect(redone.snapshot).toEqual(after);
    expect(redone.history.past).toHaveLength(1);
  });

  it('restores filters while preserving transient hover without invalidating an unchanged style', () => {
    const snapshot = captureAnalysisSnapshot({ mapLayers, visualAnalytics: analytics() });
    const current = analytics([{ kind: 'range', field: 'score', min: 10 }]);
    current.datasets.areas.hoveredFeatureId = 'current-hover';
    const restored = restoreAnalysisSnapshot(mapLayers, current, snapshot);

    expect(restored.visualAnalytics.datasets.areas.filters).toEqual([]);
    expect(restored.visualAnalytics.datasets.areas.hoveredFeatureId).toBe('current-hover');
    expect(restored.mapLayers[0].styleVersion).toBe(1);
  });
});
