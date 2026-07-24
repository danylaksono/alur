import type { AnalyticalBookmark, CohortComparisonSelection, CohortSpec, KpiSpec, VisualAnalyticsState, VisualChartSpec, VisualFilter } from '../types/visualAnalytics';
import type { LayerVisualisation, LegendSpec } from '../types/visualisation';
import { chartDatasetId } from '../utils/datasetSource';

export type HistoryLayerPresentation = {
  id: string;
  visible: boolean;
  opacity: number;
  color?: string;
  name: string;
  visualisation?: LayerVisualisation;
  legend?: LegendSpec;
  clusterRadius?: number;
  clusterMaxZoom?: number;
};

export type HistoryLayerInteraction = {
  selectedFeatureIds: string[];
  filters: VisualFilter[];
};

export type AnalysisSnapshot = {
  layerPresentation: HistoryLayerPresentation[];
  layerInteractions: Record<string, HistoryLayerInteraction>;
  charts: VisualChartSpec[];
  kpis: KpiSpec[];
  cohorts: CohortSpec[];
  bookmarks: AnalyticalBookmark[];
  comparison?: CohortComparisonSelection;
  dashboard?: VisualAnalyticsState['dashboard'];
  comparisons?: VisualAnalyticsState['comparisons'];
  activeComparisonId?: string;
  explain?: VisualAnalyticsState['explain'];
  variants?: VisualAnalyticsState['variants'];
};

export type AnalysisHistoryEntry = {
  label: string;
  coalesceKey: string;
  createdAt: number;
  snapshot: AnalysisSnapshot;
};

export type AnalysisHistoryState = {
  past: AnalysisHistoryEntry[];
  future: AnalysisHistoryEntry[];
};

type SnapshotLayer = HistoryLayerPresentation & { styleVersion: number };

type SnapshotSource = {
  mapLayers: SnapshotLayer[];
  visualAnalytics: VisualAnalyticsState;
};

export type HistoryAction = {
  label: string;
  coalesceKey?: string;
};

const HISTORY_LIMIT = 50;
const COALESCE_WINDOW_MS = 700;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const emptyAnalysisHistory = (): AnalysisHistoryState => ({ past: [], future: [] });

export const captureAnalysisSnapshot = (source: SnapshotSource): AnalysisSnapshot => ({
  layerPresentation: source.mapLayers.map((layer) => clone({
    id: layer.id,
    visible: layer.visible,
    opacity: layer.opacity,
    color: layer.color,
    name: layer.name,
    visualisation: layer.visualisation,
    legend: layer.legend,
    clusterRadius: layer.clusterRadius,
    clusterMaxZoom: layer.clusterMaxZoom,
  })),
  layerInteractions: Object.fromEntries(
    Object.entries(source.visualAnalytics.datasets).map(([layerId, interaction]) => [layerId, clone({
      selectedFeatureIds: interaction.selectedFeatureIds,
      filters: interaction.filters,
    })]),
  ),
  charts: clone(source.visualAnalytics.charts),
  kpis: clone(source.visualAnalytics.kpis),
  cohorts: clone(source.visualAnalytics.cohorts),
  bookmarks: clone(source.visualAnalytics.bookmarks),
  comparison: source.visualAnalytics.comparison ? clone(source.visualAnalytics.comparison) : undefined,
  dashboard: source.visualAnalytics.dashboard ? clone(source.visualAnalytics.dashboard) : undefined,
  comparisons: clone(source.visualAnalytics.comparisons || []),
  activeComparisonId: source.visualAnalytics.activeComparisonId,
  explain: source.visualAnalytics.explain ? clone(source.visualAnalytics.explain) : undefined,
  variants: clone(source.visualAnalytics.variants || []),
});

export const recordAnalysisHistory = (
  history: AnalysisHistoryState,
  snapshot: AnalysisSnapshot,
  action: HistoryAction,
  now = Date.now(),
): AnalysisHistoryState => {
  const coalesceKey = action.coalesceKey || `${action.label}:${now}`;
  const latest = history.past[history.past.length - 1];
  if (action.coalesceKey && latest && latest.coalesceKey === coalesceKey && now - latest.createdAt <= COALESCE_WINDOW_MS) {
    return {
      past: [...history.past.slice(0, -1), { ...latest, createdAt: now }],
      future: [],
    };
  }

  return {
    past: [...history.past, { label: action.label, coalesceKey, createdAt: now, snapshot }].slice(-HISTORY_LIMIT),
    future: [],
  };
};

type HistoryTransition = {
  history: AnalysisHistoryState;
  snapshot: AnalysisSnapshot;
  label: string;
};

export const undoAnalysisHistory = (
  history: AnalysisHistoryState,
  current: AnalysisSnapshot,
  now = Date.now(),
): HistoryTransition | null => {
  const entry = history.past[history.past.length - 1];
  if (!entry) return null;
  return {
    snapshot: entry.snapshot,
    label: entry.label,
    history: {
      past: history.past.slice(0, -1),
      future: [{ ...entry, createdAt: now, snapshot: current }, ...history.future],
    },
  };
};

export const redoAnalysisHistory = (
  history: AnalysisHistoryState,
  current: AnalysisSnapshot,
  now = Date.now(),
): HistoryTransition | null => {
  const entry = history.future[0];
  if (!entry) return null;
  return {
    snapshot: entry.snapshot,
    label: entry.label,
    history: {
      past: [...history.past, { ...entry, createdAt: now, snapshot: current }].slice(-HISTORY_LIMIT),
      future: history.future.slice(1),
    },
  };
};

export const restoreAnalysisSnapshot = <T extends SnapshotLayer, A extends VisualAnalyticsState>(
  mapLayers: T[],
  visualAnalytics: A,
  snapshot: AnalysisSnapshot,
  registeredDatasetIds: string[] = [],
): { mapLayers: T[]; visualAnalytics: A } => {
  const presentationById = new Map(snapshot.layerPresentation.map((layer) => [layer.id, layer]));
  const currentById = new Map(mapLayers.map((layer) => [layer.id, layer]));
  const orderedIds = [
    ...snapshot.layerPresentation.map((layer) => layer.id).filter((id) => currentById.has(id)),
    ...mapLayers.map((layer) => layer.id).filter((id) => !presentationById.has(id)),
  ];

  const restoredLayers = orderedIds.map((id) => {
    const layer = currentById.get(id)!;
    const presentation = presentationById.get(id);
    if (!presentation) return layer;
    const currentPresentation = {
      id: layer.id,
      visible: layer.visible,
      opacity: layer.opacity,
      color: layer.color,
      name: layer.name,
      visualisation: layer.visualisation,
      legend: layer.legend,
      clusterRadius: layer.clusterRadius,
      clusterMaxZoom: layer.clusterMaxZoom,
    };
    const presentationChanged = JSON.stringify(currentPresentation) !== JSON.stringify(presentation);
    return {
      ...layer,
      ...clone(presentation),
      styleVersion: presentationChanged ? layer.styleVersion + 1 : layer.styleVersion,
    };
  });

  const interactionIds = new Set([
    ...Object.keys(visualAnalytics.datasets),
    ...Object.keys(snapshot.layerInteractions),
  ]);
  const layers = Object.fromEntries([...interactionIds].map((layerId) => {
    const current = visualAnalytics.datasets[layerId] || { selectedFeatureIds: [], filters: [] };
    const restored = snapshot.layerInteractions[layerId] || { selectedFeatureIds: [], filters: [] };
    return [layerId, {
      ...current,
      selectedFeatureIds: clone(restored.selectedFeatureIds),
      filters: clone(restored.filters),
    }];
  }));
  const availableDatasetIds = new Set([...mapLayers.map((layer) => layer.id), ...Object.keys(visualAnalytics.datasets), ...registeredDatasetIds]);

  return {
    mapLayers: restoredLayers,
    visualAnalytics: {
      datasets: layers,
      charts: clone(snapshot.charts).filter((chart) => availableDatasetIds.has(chartDatasetId(chart))),
      kpis: clone(snapshot.kpis || []).filter((kpi) => availableDatasetIds.has(kpi.datasetId)),
      cohorts: clone(snapshot.cohorts || []).filter((cohort) => availableDatasetIds.has(cohort.datasetId)),
      bookmarks: clone(snapshot.bookmarks || []),
      comparison: snapshot.comparison && availableDatasetIds.has(snapshot.comparison.datasetId)
        ? clone(snapshot.comparison)
        : undefined,
      dashboard: snapshot.dashboard ? clone(snapshot.dashboard) : visualAnalytics.dashboard,
      comparisons: clone(snapshot.comparisons || []).filter((comparison) => comparison.operands.every((operand) => availableDatasetIds.has(operand.datasetId))),
      activeComparisonId: snapshot.activeComparisonId,
      explain: snapshot.explain ? clone(snapshot.explain) : visualAnalytics.explain,
      variants: clone(snapshot.variants || []).filter((variant) => availableDatasetIds.has(variant.baselineDatasetId)),
    } as A,
  };
};
