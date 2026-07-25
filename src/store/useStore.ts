import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  Connection,
  Edge,
  EdgeChange,
  MarkerType,
  Node,
  NodeChange,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges
} from '@xyflow/react';
import { DEFAULT_BASEMAP_ID, type BasemapId } from '../utils/basemaps';
import type { LayerVisualisation, LegendSpec } from '../types/visualisation';
import { ensureFeatureIds } from '../utils/featureIdentity';
import type {
  AnalysisVariant,
  AnalyticalBookmark,
  CohortComparisonSelection,
  CohortSpec,
  ComparisonSpec,
  DashboardCard,
  ExplainCard,
  ExplainDocument,
  ExplainSection,
  KpiSpec,
  VisualAnalyticsState,
  VisualChartSpec,
  VisualFilter,
} from '../types/visualAnalytics';

type HydratedVisualAnalyticsState = VisualAnalyticsState & {
  comparisons: ComparisonSpec[];
  explain: ExplainDocument;
  variants: AnalysisVariant[];
};
import type { MvtTileSource } from '../services/duckdb';
import type { LayerSource } from '../types/layers';
import type { LayerBounds } from '../types/layers';
import { DATASET_SOURCE_VERSION, type DatasetDescriptor } from '../types/datasets';
import { migrateLocalStorageKey } from '../utils/storageMigration';
import {
  captureAnalysisSnapshot,
  emptyAnalysisHistory,
  recordAnalysisHistory,
  redoAnalysisHistory,
  restoreAnalysisSnapshot,
  undoAnalysisHistory,
  type AnalysisHistoryState,
  type HistoryAction,
} from './analysisHistory';
import { chartDatasetId, chartDatasetSource, kpiDatasetSource } from '../utils/datasetSource';

export type NodeExecutionState = {
  status: 'idle' | 'running' | 'done' | 'error';
  error?: string;
  featureCount?: number;
};

const initialChatMessages: ChatMessage[] = [
  { role: 'assistant', content: "I can help you build spatial workflows. Try asking 'Create a 500m buffer around the input'." }
];

export type MapLayer = {
  id: string;
  name: string;
  source: LayerSource;
  geojson?: GeoJSON.FeatureCollection;
  tileSource?: MvtTileSource;
  visible: boolean;
  sourceNodeId?: string;
  sourceKind?: 'input' | 'workflow' | 'step' | 'output' | 'manual' | 'llm' | 'h3';
  color?: string;
  opacity: number;
  createdAt: number;
  featureCount: number;
  visualisation?: LayerVisualisation;
  legend?: LegendSpec;
  styleVersion: number;
  clusterRadius?: number;
  clusterMaxZoom?: number;
  dotDensityLayerId?: string;
  hexbinLayerId?: string;
};

export type WorkflowNode = Node & {
  data: {
    label: string;
    type: 'input' | 'analysis' | 'attribute' | 'aggregate' | 'filter' | 'join' | 'visualisation' | 'output';
    config: any;
  }
};

export type Toast = {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
};

export type LoadingOperation = {
  id: string;
  title: string;
  detail: string;
  progress?: number;
  fileName?: string;
  /** When set, MapView completes the operation once this layer has rendered. */
  waitForLayerId?: string;
  startedAt: number;
};

export type RailTab = 'layers' | 'charts' | 'cohorts' | 'chat' | 'nodes';
export type DrawerTab = 'workflow' | 'table' | 'sql';
export type DrawerMode = 'collapsed' | 'open' | 'maximized';

/**
 * Every place the rail can send you. One list replaces what used to be three
 * competing navigations (workspace mode, panel tab, drawer tab): each entry
 * knows which surface it lives on, so picking a destination sets all of them.
 */
export type NavDestination = RailTab | DrawerTab | 'compare' | 'explain';

const PANEL_DESTINATIONS: RailTab[] = ['layers', 'charts', 'cohorts', 'chat', 'nodes'];

/** The workflow canvas keeps its node palette in the left panel. */
const PANEL_FOR_DRAWER_TAB: Partial<Record<DrawerTab, RailTab>> = { workflow: 'nodes' };
const DRAWER_TAB_FOR_PANEL: Partial<Record<RailTab, DrawerTab>> = { nodes: 'workflow' };

export type UIState = {
  activeRailTab: RailTab;
  isPanelCollapsed: boolean;
  /** Rail shows labels when expanded, icons only when collapsed. */
  isRailExpanded: boolean;
  drawerMode: DrawerMode;
  drawerHeight: number;
  activeDrawerTab: DrawerTab;
  isSettingsOpen: boolean;
  isAboutOpen: boolean;
  isCommandPaletteOpen: boolean;
  datasetOverviewLayerId: string | null;
  layerStyleRequest?: { layerId: string; field?: string; requestedAt: number };
  recoverySave: { status: 'idle' | 'saving' | 'saved' | 'error'; savedAt?: number };
  mapCamera: { longitude: number; latitude: number; zoom: number; bearing: number; pitch: number };
  workspaceMode: 'explore' | 'compare' | 'explain' | 'board';
  isPresentationMode: boolean;
};

export type SettingsState = {
  openRouterApiKey: string;
  openRouterModelId: string;
};

export type ChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  kind?: 'tool_call' | 'tool_result';
  data?: {
    toolName?: string;
    summary?: string;
    icon?: string;
  };
};

export type ProjectState = {
  /** Empty until the user names it; the UI falls back to "Untitled project". */
  name: string;
};

export const UNTITLED_PROJECT_NAME = 'Untitled project';

export interface AppState {
  project: ProjectState;
  nodes: WorkflowNode[];
  edges: Edge[];
  duckdbReady: boolean;
  selectedBasemapId: BasemapId;
  mapLayers: MapLayer[];
  datasetRegistry: Record<string, DatasetDescriptor>;
  chatMessages: ChatMessage[];
  manualSQL: string;
  isManualSQL: boolean;
  selectedNodeId: string | null;
  selectedLayerId: string | null;
  layerFocusRequest: { layerId: string; requestedAt: number; bounds?: LayerBounds } | null;
  /**
   * Bumped when something outside the canvas (the node palette, now in the
   * left panel) wants the graph refitted. The palette no longer sits inside
   * ReactFlowProvider, so it cannot call fitView itself.
   */
  workflowFitRequest: number;
  nodeSchemas: Record<string, any[]>;
  nodeExecutionStates: Record<string, NodeExecutionState>;
  visualAnalytics: HydratedVisualAnalyticsState;
  toasts: Toast[];
  loadingOperations: Record<string, LoadingOperation>;
  ui: UIState;
  settings: SettingsState;
  /** Layers whose map source/tiles are currently re-rendering after a style or filter change. */
  restylingLayerIds: Record<string, true>;
  analysisHistory: AnalysisHistoryState;

  setProjectName: (name: string) => void;
  navigate: (destination: NavDestination) => void;
  requestWorkflowFit: () => void;
  setActiveRailTab: (tab: RailTab) => void;
  togglePanelCollapsed: () => void;
  toggleRailExpanded: () => void;
  setDrawerMode: (mode: DrawerMode) => void;
  setDrawerHeight: (height: number) => void;
  setActiveDrawerTab: (tab: DrawerTab) => void;
  openDrawerTab: (tab: DrawerTab) => void;
  setSettingsOpen: (open: boolean) => void;
  setAboutOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setDatasetOverviewLayerId: (layerId: string | null) => void;
  setRecoverySave: (status: UIState['recoverySave']) => void;
  setMapCamera: (camera: UIState['mapCamera']) => void;
  setWorkspaceMode: (mode: UIState['workspaceMode']) => void;
  setPresentationMode: (presenting: boolean) => void;
  requestLayerStyle: (layerId: string, field?: string) => void;
  updateSettings: (patch: Partial<SettingsState>) => void;
  setDuckDBReady: (ready: boolean) => void;
  setSelectedBasemapId: (id: BasemapId) => void;
  setManualSQL: (sql: string) => void;
  setIsManualSQL: (isManual: boolean) => void;
  setSelectedNodeId: (id: string | null) => void;
  setSelectedLayerId: (id: string | null) => void;
  selectLayer: (layerId: string | null) => void;
  focusLayer: (layerId: string) => void;
  focusLayerBounds: (layerId: string, bounds: LayerBounds) => void;
  setNodeSchema: (id: string, schema: any[]) => void;
  setNodeExecutionState: (id: string, state: NodeExecutionState) => void;
  resetNodeExecutionStates: () => void;
  resetWorkspace: () => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (node: WorkflowNode) => void;
  updateNode: (id: string, config: any) => void;
  removeNode: (id: string) => void;
  duplicateNode: (id: string, newId?: string, position?: { x: number; y: number }) => void;
  addMapLayer: (layer: NewMapLayer) => void;
  registerDataset: (dataset: DatasetDescriptor) => void;
  rebindDataset: (fromDatasetId: string, dataset: DatasetDescriptor) => void;
  removeDataset: (datasetId: string) => void;
  removeMapLayer: (layerId: string) => void;
  toggleMapLayerVisibility: (layerId: string) => void;
  updateMapLayer: (layerId: string, patch: Partial<Pick<MapLayer, 'visible' | 'opacity' | 'color' | 'name' | 'clusterRadius' | 'clusterMaxZoom' | 'dotDensityLayerId' | 'hexbinLayerId'>>) => void;
  setLayerRestyling: (layerId: string, restyling: boolean) => void;
  updateLayerVisualisation: (layerId: string, visualisation: LayerVisualisation, legend?: LegendSpec) => void;
  clearLayerVisualisation: (layerId: string) => void;
  reorderMapLayer: (layerId: string, targetIndex: number) => void;
  setHoveredFeature: (layerId: string, featureId: string | null) => void;
  setHighlightedFeatures: (layerId: string, featureIds: string[]) => void;
  toggleSelectedFeature: (layerId: string, featureId: string) => void;
  setFeatureSelection: (layerId: string, featureIds: string[]) => void;
  clearFeatureSelection: (layerId: string) => void;
  setLayerFilters: (layerId: string, filters: VisualFilter[]) => void;
  clearLayerFilters: (layerId: string) => void;
  addChart: (chart: VisualChartSpec) => void;
  updateChart: (chartId: string, patch: Partial<Omit<VisualChartSpec, 'id'>>) => void;
  removeChart: (chartId: string) => void;
  addKpi: (kpi: KpiSpec) => void;
  updateKpi: (kpiId: string, patch: Partial<Omit<KpiSpec, 'id' | 'datasetId'>>) => void;
  removeKpi: (kpiId: string) => void;
  reorderKpi: (kpiId: string, targetIndex: number) => void;
  addCohort: (cohort: CohortSpec) => void;
  updateCohort: (cohortId: string, patch: Partial<Pick<CohortSpec, 'name' | 'colour'>>) => void;
  duplicateCohort: (cohortId: string, newId?: string) => void;
  removeCohort: (cohortId: string) => void;
  setCohortComparison: (comparison?: CohortComparisonSelection) => void;
  addComparison: (comparison: ComparisonSpec) => void;
  updateComparison: (comparisonId: string, patch: Partial<Omit<ComparisonSpec, 'id' | 'createdAt'>>) => void;
  duplicateComparison: (comparisonId: string, newId?: string) => void;
  removeComparison: (comparisonId: string) => void;
  setActiveComparison: (comparisonId?: string) => void;
  addBookmark: (bookmark: AnalyticalBookmark) => void;
  updateBookmark: (bookmarkId: string, patch: Partial<Pick<AnalyticalBookmark, 'name' | 'note'>>) => void;
  removeBookmark: (bookmarkId: string) => void;
  restoreBookmark: (bookmarkId: string) => void;
  setDashboardTitle: (title: string) => void;
  addDashboardCard: (card: DashboardCard) => void;
  updateDashboardCard: (cardId: string, patch: Partial<Omit<DashboardCard, 'id' | 'kind'>>) => void;
  removeDashboardCard: (cardId: string) => void;
  setExplainTitle: (title: string) => void;
  updateExplainDocument: (patch: Partial<Pick<ExplainDocument, 'audience' | 'summary'>>) => void;
  addExplainSection: (section: ExplainSection) => void;
  updateExplainSection: (sectionId: string, patch: Partial<Omit<ExplainSection, 'id'>>) => void;
  reorderExplainSection: (sectionId: string, targetIndex: number) => void;
  removeExplainSection: (sectionId: string) => void;
  addExplainCard: (card: ExplainCard) => void;
  updateExplainCard: (cardId: string, patch: Partial<Omit<ExplainCard, 'id' | 'kind'>>) => void;
  reorderExplainCard: (cardId: string, sectionId: string, targetIndex: number) => void;
  removeExplainCard: (cardId: string) => void;
  addVariant: (variant: AnalysisVariant) => void;
  branchVariant: (variantId: string, newId?: string) => void;
  updateVariant: (variantId: string, patch: Partial<Omit<AnalysisVariant, 'id' | 'createdAt' | 'parentVariantId'>>) => void;
  removeVariant: (variantId: string) => void;
  addChatMessage: (role: 'user' | 'assistant' | 'system', content: string, data?: { kind?: string; toolName?: string; summary?: string; icon?: string }) => void;
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  startLoadingOperation: (operation: Omit<LoadingOperation, 'startedAt'>) => void;
  updateLoadingOperation: (id: string, patch: Partial<Omit<LoadingOperation, 'id' | 'startedAt'>>) => void;
  finishLoadingOperation: (id: string) => void;
  undoAnalysis: () => void;
  redoAnalysis: () => void;
  clearAnalysisHistory: () => void;
}

export type NewMapLayer = Omit<MapLayer, 'visible' | 'opacity' | 'createdAt' | 'featureCount' | 'styleVersion' | 'source'> &
  Partial<Pick<MapLayer, 'visible' | 'opacity' | 'createdAt' | 'featureCount' | 'styleVersion' | 'source'>>;

migrateLocalStorageKey('ymnngis-settings', 'alur-settings');

const removeRecordKeys = <T>(record: Record<string, T>, ids: Set<string>) =>
  Object.fromEntries(Object.entries(record).filter(([id]) => !ids.has(id)));

const inferLegacyGeometryKind = (geojson?: GeoJSON.FeatureCollection) => {
  const geomType = geojson?.features.find((feature) => feature.geometry)?.geometry?.type || 'Point';
  if (geomType.includes('Line')) return 'line' as const;
  if (geomType.includes('Polygon')) return 'polygon' as const;
  return 'point' as const;
};

const legacyFields = (geojson?: GeoJSON.FeatureCollection) => {
  const names = new Set<string>();
  geojson?.features.slice(0, 200).forEach((feature) => {
    Object.keys(feature.properties || {}).forEach((name) => names.add(name));
  });
  return [...names].sort((a, b) => a.localeCompare(b)).map((name) => ({ name, type: 'UNKNOWN' }));
};

const hydrateLayer = (layer: NewMapLayer, previous?: MapLayer): MapLayer => {
  const legacyGeojson = layer.geojson
    ? ensureFeatureIds(layer.geojson, layer.id)
    : previous?.geojson;
  const source = layer.source ?? previous?.source ?? {
    kind: 'legacy-geojson' as const,
    geometryKind: inferLegacyGeometryKind(legacyGeojson),
    fields: legacyFields(legacyGeojson),
  };

  return {
    ...previous,
    ...layer,
    source,
    visible: layer.visible ?? previous?.visible ?? true,
    opacity: layer.opacity ?? previous?.opacity ?? 0.8,
    createdAt: layer.createdAt ?? previous?.createdAt ?? Date.now(),
    featureCount: layer.featureCount ?? legacyGeojson?.features.length ?? previous?.featureCount ?? 0,
    geojson: legacyGeojson,
    visualisation: layer.visualisation ?? previous?.visualisation,
    legend: layer.legend ?? previous?.legend,
    styleVersion: layer.styleVersion ?? (previous ? previous.styleVersion + 1 : 1),
  };
};

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const noopStorage: Storage = {
  length: 0,
  clear: () => {},
  getItem: () => null,
  key: () => null,
  removeItem: () => {},
  setItem: () => {},
};

const initialUIState: UIState = {
  activeRailTab: 'layers',
  isPanelCollapsed: typeof window !== 'undefined' && window.innerWidth < 768,
  isRailExpanded: typeof window === 'undefined' || window.innerWidth >= 1280,
  drawerMode: 'open',
  drawerHeight: 320,
  activeDrawerTab: 'workflow',
  isSettingsOpen: false,
  isAboutOpen: false,
  isCommandPaletteOpen: false,
  datasetOverviewLayerId: null,
  layerStyleRequest: undefined,
  recoverySave: { status: 'idle' },
  mapCamera: { longitude: 0, latitude: 20, zoom: 1.5, bearing: 0, pitch: 0 },
  workspaceMode: 'explore',
  isPresentationMode: false,
};

/**
 * Whether a rail destination's surface is currently showing.
 *
 * Workflow spans two surfaces (canvas in the drawer, palette in the panel) and
 * counts as active only when both are. The drawer boots open on the workflow
 * tab, so a looser test would mark it active before its palette is showing and
 * the first click would close the canvas instead of completing the pairing.
 */
export const isDestinationActive = (ui: UIState, destination: NavDestination): boolean => {
  if (destination === 'compare') return ui.workspaceMode === 'compare';
  if (destination === 'explain') return ui.workspaceMode === 'explain' || ui.workspaceMode === 'board';

  const isExplore = ui.workspaceMode === 'explore';
  const panelShowing = (tab: RailTab) => isExplore && ui.activeRailTab === tab && !ui.isPanelCollapsed;
  const drawerShowing = (tab: DrawerTab) => isExplore && ui.activeDrawerTab === tab && ui.drawerMode !== 'collapsed';

  if (destination === 'workflow') return drawerShowing('workflow') && panelShowing('nodes');
  if (destination === 'table' || destination === 'sql') return drawerShowing(destination);
  return panelShowing(destination);
};

const clampDrawerHeight = (height: number) => {
  const maxHeight = typeof window === 'undefined' ? 800 : window.innerHeight - 160;
  return Math.max(160, Math.min(height, maxHeight));
};

/** UI keys that represent a deliberate layout choice and are safe to restore. */
export type LayoutPreferences = Pick<
  UIState,
  'activeRailTab' | 'isPanelCollapsed' | 'isRailExpanded' | 'drawerMode' | 'drawerHeight' | 'activeDrawerTab'
>;

const RAIL_TAB_VALUES: RailTab[] = [...PANEL_DESTINATIONS];
const DRAWER_TAB_VALUES: DrawerTab[] = ['workflow', 'table', 'sql'];
const DRAWER_MODE_VALUES: DrawerMode[] = ['collapsed', 'open', 'maximized'];

/**
 * Narrows persisted UI state to the layout keys, discarding anything malformed.
 * Values come from localStorage, so every field is validated rather than trusted.
 */
export const pickLayoutPreferences = (ui?: Partial<UIState>): Partial<LayoutPreferences> => {
  if (!ui) return {};
  const preferences: Partial<LayoutPreferences> = {};
  if (RAIL_TAB_VALUES.includes(ui.activeRailTab as RailTab)) preferences.activeRailTab = ui.activeRailTab;
  if (typeof ui.isPanelCollapsed === 'boolean') preferences.isPanelCollapsed = ui.isPanelCollapsed;
  if (typeof ui.isRailExpanded === 'boolean') preferences.isRailExpanded = ui.isRailExpanded;
  if (DRAWER_MODE_VALUES.includes(ui.drawerMode as DrawerMode)) preferences.drawerMode = ui.drawerMode;
  if (DRAWER_TAB_VALUES.includes(ui.activeDrawerTab as DrawerTab)) preferences.activeDrawerTab = ui.activeDrawerTab;
  if (typeof ui.drawerHeight === 'number' && Number.isFinite(ui.drawerHeight)) {
    preferences.drawerHeight = clampDrawerHeight(ui.drawerHeight);
  }
  return preferences;
};

const initialSettings: SettingsState = {
  openRouterApiKey: '',
  openRouterModelId: 'openai/gpt-4o-mini',
};

const defaultExplainDocument = (): ExplainDocument => ({
  title: 'Analysis explanation',
  sections: [
    { id: 'question', title: 'Question', purpose: 'State the decision, hypothesis, or analytical question.' },
    { id: 'evidence', title: 'Evidence', purpose: 'Present the strongest observations with denominators and context.' },
    { id: 'interpretation', title: 'Interpretation', purpose: 'Explain what the evidence means and connect competing signals.' },
    { id: 'conclusion', title: 'Conclusion', purpose: 'State the answer, confidence, and decision implication.' },
    { id: 'limitations', title: 'Limitations / Next steps', purpose: 'Record uncertainty, missing evidence, and the next analytical action.' },
  ],
  cards: [],
});

const emptyVisualAnalytics = (): HydratedVisualAnalyticsState => ({
  datasets: {},
  charts: [],
  kpis: [],
  cohorts: [],
  bookmarks: [],
  comparisons: [],
  explain: defaultExplainDocument(),
  variants: [],
});

const datasetFieldsForLayer = (layer: MapLayer) => {
  const source = layer.source;
  if (source.kind !== 'duckdb-table' && source.kind !== 'duckdb-query') return source.fields;
  return [{ name: source.featureIdColumn, type: 'BIGINT' }, ...source.fields.filter((field) => field.name !== source.featureIdColumn)];
};

const datasetDescriptorForLayer = (layer: MapLayer): DatasetDescriptor => ({
  id: layer.id,
  name: layer.name,
  sourceVersion: DATASET_SOURCE_VERSION,
  source: { kind: 'layer', layerId: layer.id },
  fields: datasetFieldsForLayer(layer),
  rowCount: layer.featureCount,
  rowIdColumn: layer.source.kind === 'duckdb-table' || layer.source.kind === 'duckdb-query' ? layer.source.featureIdColumn : '_alur_feature_id',
  rowIdQuality: 'map-feature-id',
  sourceUpdatedAt: layer.source.kind === 'duckdb-table' || layer.source.kind === 'duckdb-query' ? layer.source.renderVersion : layer.createdAt,
  spatial: true,
  geometryColumn: layer.source.kind === 'duckdb-table' || layer.source.kind === 'duckdb-query' ? '__alur_tile_geom' : undefined,
  geometryCrs: layer.source.kind === 'duckdb-table' || layer.source.kind === 'duckdb-query' ? 'EPSG:3857' : 'EPSG:4326',
  geometryKind: layer.source.geometryKind,
  bounds: layer.source.bounds,
  relationName: layer.source.kind === 'duckdb-table' || layer.source.kind === 'duckdb-query' ? layer.source.tileSource.tableName : undefined,
  originTableName: layer.source.kind === 'duckdb-table' || layer.source.kind === 'duckdb-query' ? layer.source.tableName : undefined,
});

const recordCurrentAnalysis = (state: AppState, action: HistoryAction) =>
  recordAnalysisHistory(state.analysisHistory, captureAnalysisSnapshot(state), action);

const PRESENTATION_PATCH_KEYS = new Set([
  'visible',
  'opacity',
  'color',
  'name',
  'clusterRadius',
  'clusterMaxZoom',
]);

const historyActionForMapPatch = (layerId: string, patch: Record<string, unknown>): HistoryAction | null => {
  const keys = Object.keys(patch).filter((key) => PRESENTATION_PATCH_KEYS.has(key));
  if (!keys.length) return null;
  if (keys.length === 1 && keys[0] === 'opacity') {
    return { label: 'Change layer opacity', coalesceKey: `layer:${layerId}:opacity` };
  }
  return { label: 'Edit layer presentation', coalesceKey: `layer:${layerId}:${keys.sort().join(',')}` };
};

export const useStore = create<AppState>()(persist((set, get) => ({
  project: { name: '' },
  nodes: [],
  edges: [],
  duckdbReady: false,
  selectedBasemapId: DEFAULT_BASEMAP_ID,
  mapLayers: [],
  datasetRegistry: {},
  chatMessages: initialChatMessages,
  manualSQL: '',
  isManualSQL: false,
  selectedNodeId: null,
  selectedLayerId: null,
  layerFocusRequest: null,
  workflowFitRequest: 0,
  nodeSchemas: {},
  nodeExecutionStates: {},
  visualAnalytics: emptyVisualAnalytics(),
  toasts: [],
  loadingOperations: {},
  ui: initialUIState,
  settings: initialSettings,
  restylingLayerIds: {},
  analysisHistory: emptyAnalysisHistory(),

  setLayerRestyling: (layerId, restyling) => set((state) => {
    const isRestyling = Boolean(state.restylingLayerIds[layerId]);
    if (isRestyling === restyling) return state;
    if (restyling) {
      return { restylingLayerIds: { ...state.restylingLayerIds, [layerId]: true as const } };
    }
    return { restylingLayerIds: removeRecordKeys(state.restylingLayerIds, new Set([layerId])) };
  }),

  startLoadingOperation: (operation) => set((state) => ({
    loadingOperations: {
      ...state.loadingOperations,
      [operation.id]: { ...operation, startedAt: Date.now() },
    },
  })),
  updateLoadingOperation: (id, patch) => set((state) => {
    const current = state.loadingOperations[id];
    if (!current) return state;
    return {
      loadingOperations: {
        ...state.loadingOperations,
        [id]: { ...current, ...patch },
      },
    };
  }),
  finishLoadingOperation: (id) => set((state) => ({
    loadingOperations: removeRecordKeys(state.loadingOperations, new Set([id])),
  })),

  // Single entry point for the rail: resolves a destination onto whichever
  // surface owns it, so the caller never has to know which of the three it is.
  navigate: (destination) => set((state) => {
    if (destination === 'compare' || destination === 'explain') {
      return { ui: { ...state.ui, workspaceMode: destination, isPresentationMode: false } };
    }

    if (PANEL_DESTINATIONS.includes(destination as RailTab)) {
      const tab = destination as RailTab;
      const pairedDrawerTab = DRAWER_TAB_FOR_PANEL[tab];
      return {
        ui: {
          ...state.ui,
          workspaceMode: 'explore',
          isPresentationMode: false,
          activeRailTab: tab,
          isPanelCollapsed: false,
          ...(pairedDrawerTab
            ? {
                activeDrawerTab: pairedDrawerTab,
                drawerMode: state.ui.drawerMode === 'collapsed' ? 'open' : state.ui.drawerMode,
              }
            : {}),
        },
      };
    }

    const tab = destination as DrawerTab;
    const pairedPanelTab = PANEL_FOR_DRAWER_TAB[tab];
    return {
      ui: {
        ...state.ui,
        workspaceMode: 'explore',
        isPresentationMode: false,
        activeDrawerTab: tab,
        drawerMode: state.ui.drawerMode === 'collapsed' ? 'open' : state.ui.drawerMode,
        ...(pairedPanelTab ? { activeRailTab: pairedPanelTab, isPanelCollapsed: false } : {}),
      },
    };
  }),
  setActiveRailTab: (tab) => set((state) => ({
    ui: { ...state.ui, activeRailTab: tab, isPanelCollapsed: false },
  })),
  togglePanelCollapsed: () => set((state) => ({
    ui: { ...state.ui, isPanelCollapsed: !state.ui.isPanelCollapsed },
  })),
  toggleRailExpanded: () => set((state) => ({
    ui: { ...state.ui, isRailExpanded: !state.ui.isRailExpanded },
  })),
  requestWorkflowFit: () => set({ workflowFitRequest: Date.now() }),
  setDrawerMode: (mode) => set((state) => ({
    ui: { ...state.ui, drawerMode: mode },
  })),
  setDrawerHeight: (height) => set((state) => ({
    ui: { ...state.ui, drawerHeight: clampDrawerHeight(height) },
  })),
  setActiveDrawerTab: (tab) => set((state) => ({
    ui: { ...state.ui, activeDrawerTab: tab },
  })),
  openDrawerTab: (tab) => set((state) => {
    const pairedPanelTab = PANEL_FOR_DRAWER_TAB[tab];
    return {
      ui: {
        ...state.ui,
        activeDrawerTab: tab,
        drawerMode: state.ui.drawerMode === 'collapsed' ? 'open' : state.ui.drawerMode,
        ...(pairedPanelTab ? { activeRailTab: pairedPanelTab } : {}),
      },
    };
  }),
  setSettingsOpen: (open) => set((state) => ({
    ui: { ...state.ui, isSettingsOpen: open },
  })),
  setAboutOpen: (open) => set((state) => ({
    ui: { ...state.ui, isAboutOpen: open },
  })),
  setCommandPaletteOpen: (open) => set((state) => ({
    ui: { ...state.ui, isCommandPaletteOpen: open },
  })),
  setDatasetOverviewLayerId: (layerId) => set((state) => ({
    selectedLayerId: layerId || state.selectedLayerId,
    ui: { ...state.ui, datasetOverviewLayerId: layerId },
  })),
  setRecoverySave: (recoverySave) => set((state) => ({
    ui: { ...state.ui, recoverySave },
  })),
  setMapCamera: (mapCamera) => set((state) => ({
    ui: { ...state.ui, mapCamera },
  })),
  setWorkspaceMode: (workspaceMode) => set((state) => ({
    ui: { ...state.ui, workspaceMode, isPresentationMode: false },
  })),
  setPresentationMode: (isPresentationMode) => set((state) => ({
    ui: { ...state.ui, isPresentationMode, workspaceMode: isPresentationMode ? 'board' : state.ui.workspaceMode },
    visualAnalytics: {
      ...state.visualAnalytics,
      explain: { ...state.visualAnalytics.explain, presentationMode: isPresentationMode },
    },
  })),
  requestLayerStyle: (layerId, field) => set((state) => ({
    selectedLayerId: layerId,
    ui: {
      ...state.ui,
      activeRailTab: 'layers',
      isPanelCollapsed: false,
      layerStyleRequest: { layerId, field, requestedAt: Date.now() },
    },
  })),
  updateSettings: (patch) => set((state) => ({
    settings: { ...state.settings, ...patch },
  })),
  setDuckDBReady: (ready) => set({ duckdbReady: ready }),
  setSelectedBasemapId: (id) => set({ selectedBasemapId: id }),
  setManualSQL: (sql) => set({ manualSQL: sql }),
  setIsManualSQL: (isManual) => set({ isManualSQL: isManual }),
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),
  setSelectedLayerId: (id) => set({ selectedLayerId: id }),
  selectLayer: (layerId) => set((state) => {
    const layer = layerId ? state.mapLayers.find((item) => item.id === layerId) : null;
    return {
      selectedLayerId: layerId,
      selectedNodeId: layer?.sourceNodeId ?? state.selectedNodeId,
    };
  }),
  focusLayer: (layerId) => set((state) => {
    const layer = state.mapLayers.find((item) => item.id === layerId);
    return {
      selectedLayerId: layerId,
      selectedNodeId: layer?.sourceNodeId ?? state.selectedNodeId,
      layerFocusRequest: { layerId, requestedAt: Date.now() },
    };
  }),
  focusLayerBounds: (layerId, bounds) => set((state) => {
    const layer = state.mapLayers.find((item) => item.id === layerId);
    return {
      selectedLayerId: layerId,
      selectedNodeId: layer?.sourceNodeId ?? state.selectedNodeId,
      layerFocusRequest: { layerId, bounds, requestedAt: Date.now() },
    };
  }),
  setNodeSchema: (id, schema) => set((state) => ({
    nodeSchemas: { ...state.nodeSchemas, [id]: schema }
  })),

  setNodeExecutionState: (id, execState) => set((state) => ({
    nodeExecutionStates: { ...state.nodeExecutionStates, [id]: execState }
  })),

  resetNodeExecutionStates: () => set({ nodeExecutionStates: {} }),

  setProjectName: (name) => set({ project: { name: name.slice(0, 120) } }),

  resetWorkspace: () => set({
    project: { name: '' },
    nodes: [],
    edges: [],
    selectedBasemapId: DEFAULT_BASEMAP_ID,
    mapLayers: [],
    datasetRegistry: {},
    chatMessages: initialChatMessages,
    manualSQL: '',
    isManualSQL: false,
    selectedNodeId: null,
    selectedLayerId: null,
    layerFocusRequest: null,
  workflowFitRequest: 0,
    nodeSchemas: {},
    nodeExecutionStates: {},
    visualAnalytics: emptyVisualAnalytics(),
    restylingLayerIds: {},
    loadingOperations: {},
    ui: { ...get().ui, datasetOverviewLayerId: null, isCommandPaletteOpen: false, workspaceMode: 'explore', isPresentationMode: false },
    analysisHistory: emptyAnalysisHistory(),
  }),

  undoAnalysis: () => set((state) => {
    const transition = undoAnalysisHistory(state.analysisHistory, captureAnalysisSnapshot(state));
    if (!transition) return state;
    return {
      ...restoreAnalysisSnapshot(state.mapLayers, state.visualAnalytics, transition.snapshot, Object.keys(state.datasetRegistry)),
      analysisHistory: transition.history,
    };
  }),

  redoAnalysis: () => set((state) => {
    const transition = redoAnalysisHistory(state.analysisHistory, captureAnalysisSnapshot(state));
    if (!transition) return state;
    return {
      ...restoreAnalysisSnapshot(state.mapLayers, state.visualAnalytics, transition.snapshot, Object.keys(state.datasetRegistry)),
      analysisHistory: transition.history,
    };
  }),

  clearAnalysisHistory: () => set({ analysisHistory: emptyAnalysisHistory() }),

  onNodesChange: (changes) => {
    const removedNodeIds = new Set(
      changes
        .filter((change) => change.type === 'remove')
        .map((change) => change.id)
    );
    const nextNodes = applyNodeChanges(changes, get().nodes) as WorkflowNode[];
    const nextNodeIds = new Set(nextNodes.map((node) => node.id));

    const nextLayers = removedNodeIds.size
      ? get().mapLayers.filter((layer) => !layer.sourceNodeId || !removedNodeIds.has(layer.sourceNodeId))
      : get().mapLayers;
    const nextLayerIds = new Set(nextLayers.map((layer) => layer.id));

    set({
      nodes: nextNodes,
      edges: get().edges.filter((edge) => nextNodeIds.has(edge.source) && nextNodeIds.has(edge.target)),
      mapLayers: nextLayers,
      datasetRegistry: Object.fromEntries(Object.entries(get().datasetRegistry).filter(([, dataset]) => (
        dataset.source.kind === 'layer' ? nextLayerIds.has(dataset.source.layerId) : dataset.source.kind !== 'workflow-node' || nextNodeIds.has(dataset.source.nodeId)
      ))),
      visualAnalytics: {
        ...get().visualAnalytics,
        datasets: Object.fromEntries(
          Object.entries(get().visualAnalytics.datasets).filter(([layerId]) => nextLayerIds.has(layerId))
        ),
        charts: get().visualAnalytics.charts.filter((chart) => {
          const source = chartDatasetSource(chart);
          return source.kind === 'layer' ? nextLayerIds.has(source.layerId) : source.kind !== 'workflow-node' || nextNodeIds.has(source.nodeId);
        }),
        kpis: get().visualAnalytics.kpis.filter((kpi) => {
          const source = kpiDatasetSource(kpi);
          return source.kind === 'layer' ? nextLayerIds.has(source.layerId) : source.kind !== 'workflow-node' || nextNodeIds.has(source.nodeId);
        }),
        cohorts: get().visualAnalytics.cohorts.filter((cohort) => nextLayerIds.has(cohort.datasetId) || Boolean(get().datasetRegistry[cohort.datasetId])),
        comparison: get().visualAnalytics.comparison && (nextLayerIds.has(get().visualAnalytics.comparison!.datasetId) || Boolean(get().datasetRegistry[get().visualAnalytics.comparison!.datasetId])) ? get().visualAnalytics.comparison : undefined,
      },
      selectedNodeId: get().selectedNodeId && nextNodeIds.has(get().selectedNodeId!)
        ? get().selectedNodeId
        : null,
      selectedLayerId: get().selectedLayerId && nextLayerIds.has(get().selectedLayerId!)
        ? get().selectedLayerId
        : null,
      nodeSchemas: removeRecordKeys(get().nodeSchemas, removedNodeIds),
      nodeExecutionStates: removeRecordKeys(get().nodeExecutionStates, removedNodeIds),
      ...(removedNodeIds.size ? { analysisHistory: emptyAnalysisHistory() } : {}),
    });
  },

  onEdgesChange: (changes) => {
    set({
      edges: applyEdgeChanges(changes, get().edges),
    });
  },

  onConnect: (connection) => {
    set({
      edges: addEdge({
        ...connection,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#94a3b8' },
      }, get().edges),
    });
  },

  addNode: (node) => set((state) => ({ nodes: [...state.nodes, node] })),

  updateNode: (id, config) => set((state) => ({
    nodes: state.nodes.map((node) =>
      node.id === id ? { ...node, data: { ...node.data, config } } : node
    )
  })),

  removeNode: (id) => set((state) => {
    const node = state.nodes.find((n) => n.id === id);
    const tableName = node?.data?.config?.tableName as string | undefined;
    const removedIds = new Set([id]);
    const mapLayers = state.mapLayers.filter((layer) => (
      layer.sourceNodeId !== id && (!tableName || layer.id !== tableName)
    ));
    const layerIds = new Set(mapLayers.map((layer) => layer.id));
    const removedLayerIds = new Set(
      state.mapLayers
        .filter((layer) => layer.sourceNodeId === id || (tableName && layer.id === tableName))
        .map((layer) => layer.id)
    );
    const visualAnalyticsLayers = removeRecordKeys(state.visualAnalytics.datasets, removedLayerIds);
    const removedDatasetIds = new Set(Object.values(state.datasetRegistry)
      .filter((dataset) => dataset.source.kind === 'workflow-node' && dataset.source.nodeId === id)
      .map((dataset) => dataset.id));
    removedLayerIds.forEach((layerId) => removedDatasetIds.add(layerId));

    return {
      nodes: state.nodes.filter((n) => n.id !== id),
      edges: state.edges.filter((edge) => edge.source !== id && edge.target !== id),
      mapLayers,
      datasetRegistry: removeRecordKeys(state.datasetRegistry, removedDatasetIds),
      visualAnalytics: {
        ...state.visualAnalytics,
        datasets: removeRecordKeys(visualAnalyticsLayers, removedDatasetIds),
        charts: state.visualAnalytics.charts.filter((chart) => {
          const source = chartDatasetSource(chart);
          return source.kind === 'workflow-node' ? source.nodeId !== id : !removedDatasetIds.has(source.kind === 'layer' ? source.layerId : source.datasetId);
        }),
        kpis: state.visualAnalytics.kpis.filter((kpi) => !removedDatasetIds.has(kpi.datasetId)),
        cohorts: state.visualAnalytics.cohorts.filter((cohort) => !removedDatasetIds.has(cohort.datasetId)),
        comparison: state.visualAnalytics.comparison && removedDatasetIds.has(state.visualAnalytics.comparison.datasetId) ? undefined : state.visualAnalytics.comparison,
      },
      selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
      selectedLayerId: state.selectedLayerId && layerIds.has(state.selectedLayerId) ? state.selectedLayerId : null,
      nodeSchemas: removeRecordKeys(state.nodeSchemas, removedIds),
      nodeExecutionStates: removeRecordKeys(state.nodeExecutionStates, removedIds),
      analysisHistory: emptyAnalysisHistory(),
    };
  }),

  duplicateNode: (id, newId = `node-${Date.now()}`, position) => set((state) => {
    const node = state.nodes.find((item) => item.id === id);
    if (!node) return {};

    const sourcePosition = node.position ?? { x: 0, y: 0 };
    const nextPosition = position ?? { x: sourcePosition.x + 40, y: sourcePosition.y + 40 };

    const clonedNode: WorkflowNode = {
      ...node,
      id: newId,
      position: nextPosition,
      data: {
        ...node.data,
        label: `${node.data.label} Copy`,
      },
    };

    return {
      nodes: [...state.nodes, clonedNode],
    };
  }),

  addMapLayer: (layer) => set((state) => {
    const previous = state.mapLayers.find((item) => item.id === layer.id);
    const nextLayer = hydrateLayer(layer, previous);
    return {
      mapLayers: [...state.mapLayers.filter((item) => item.id !== layer.id), nextLayer],
      datasetRegistry: { ...state.datasetRegistry, [nextLayer.id]: datasetDescriptorForLayer(nextLayer) },
      // Only auto-select genuinely new layers; updates (style bumps, re-materialization)
      // must not hijack whatever the user currently has selected.
      selectedLayerId: previous ? state.selectedLayerId : nextLayer.id,
      selectedNodeId: previous ? state.selectedNodeId : nextLayer.sourceNodeId ?? state.selectedNodeId,
      analysisHistory: previous ? state.analysisHistory : emptyAnalysisHistory(),
    };
  }),

  registerDataset: (dataset) => set((state) => ({
    datasetRegistry: { ...state.datasetRegistry, [dataset.id]: dataset },
  })),

  rebindDataset: (fromDatasetId, dataset) => set((state) => {
    if (fromDatasetId === dataset.id) return { datasetRegistry: { ...state.datasetRegistry, [dataset.id]: dataset } };
    const previousInteraction = state.visualAnalytics.datasets[fromDatasetId];
    const currentInteraction = state.visualAnalytics.datasets[dataset.id];
    const datasets = removeRecordKeys(state.visualAnalytics.datasets, new Set([fromDatasetId]));
    if (previousInteraction || currentInteraction) datasets[dataset.id] = currentInteraction || previousInteraction;
    const migrateBookmark = (bookmark: AnalyticalBookmark): AnalyticalBookmark => {
      const filtersByDataset = { ...bookmark.filtersByDataset };
      if (filtersByDataset[fromDatasetId] && !filtersByDataset[dataset.id]) filtersByDataset[dataset.id] = filtersByDataset[fromDatasetId];
      delete filtersByDataset[fromDatasetId];
      return {
        ...bookmark,
        datasetId: bookmark.datasetId === fromDatasetId ? dataset.id : bookmark.datasetId,
        filtersByDataset,
        cohorts: bookmark.cohorts.map((cohort) => cohort.datasetId === fromDatasetId ? { ...cohort, datasetId: dataset.id } : cohort),
        charts: bookmark.charts.map((chart) => chartDatasetId(chart) === fromDatasetId ? { ...chart, source: dataset.source, tableName: dataset.relationName } : chart),
        kpis: bookmark.kpis.map((kpi) => kpi.datasetId === fromDatasetId ? { ...kpi, datasetId: dataset.id, source: dataset.source } : kpi),
      };
    };
    return {
      datasetRegistry: { ...removeRecordKeys(state.datasetRegistry, new Set([fromDatasetId])), [dataset.id]: dataset },
      visualAnalytics: {
        ...state.visualAnalytics,
        datasets,
        charts: state.visualAnalytics.charts.map((chart) => chartDatasetId(chart) === fromDatasetId ? { ...chart, source: dataset.source, tableName: dataset.relationName } : chart),
        kpis: state.visualAnalytics.kpis.map((kpi) => kpi.datasetId === fromDatasetId ? { ...kpi, datasetId: dataset.id, source: dataset.source } : kpi),
        cohorts: state.visualAnalytics.cohorts.map((cohort) => cohort.datasetId === fromDatasetId ? { ...cohort, datasetId: dataset.id } : cohort),
        bookmarks: state.visualAnalytics.bookmarks.map(migrateBookmark),
        comparison: state.visualAnalytics.comparison?.datasetId === fromDatasetId ? { ...state.visualAnalytics.comparison, datasetId: dataset.id } : state.visualAnalytics.comparison,
      },
    };
  }),

  removeDataset: (datasetId) => set((state) => ({
    datasetRegistry: removeRecordKeys(state.datasetRegistry, new Set([datasetId])),
    visualAnalytics: {
      ...state.visualAnalytics,
      datasets: removeRecordKeys(state.visualAnalytics.datasets, new Set([datasetId])),
      charts: state.visualAnalytics.charts.filter((chart) => {
        const source = chart.source;
        return source?.kind === 'layer' ? source.layerId !== datasetId : source?.kind ? source.datasetId !== datasetId : chart.layerId !== datasetId;
      }),
      kpis: state.visualAnalytics.kpis.filter((kpi) => kpi.datasetId !== datasetId),
      cohorts: state.visualAnalytics.cohorts.filter((cohort) => cohort.datasetId !== datasetId),
    },
  })),

  removeMapLayer: (layerId) => set((state) => {
    const layer = state.mapLayers.find((item) => item.id === layerId);
    const dotDensityLayerId = layer?.dotDensityLayerId;
    const hexbinLayerId = layer?.hexbinLayerId;
    const keysToRemove = new Set([layerId]);
    if (dotDensityLayerId) keysToRemove.add(dotDensityLayerId);
    if (hexbinLayerId) keysToRemove.add(hexbinLayerId);
    return {
      mapLayers: state.mapLayers
        .filter((item) => !keysToRemove.has(item.id))
        .map((item) => item.dotDensityLayerId === layerId || item.hexbinLayerId === layerId
          ? { ...item, dotDensityLayerId: undefined, hexbinLayerId: undefined, visualisation: undefined, legend: undefined }
          : item),
      datasetRegistry: removeRecordKeys(state.datasetRegistry, keysToRemove),
      visualAnalytics: {
        ...state.visualAnalytics,
        datasets: removeRecordKeys(state.visualAnalytics.datasets, keysToRemove),
        charts: state.visualAnalytics.charts.filter((chart) => !keysToRemove.has(chart.layerId)),
        kpis: state.visualAnalytics.kpis.filter((kpi) => !keysToRemove.has(kpi.datasetId)),
        cohorts: state.visualAnalytics.cohorts.filter((cohort) => !keysToRemove.has(cohort.datasetId)),
        comparison: state.visualAnalytics.comparison && keysToRemove.has(state.visualAnalytics.comparison.datasetId) ? undefined : state.visualAnalytics.comparison,
      },
      selectedLayerId: state.selectedLayerId === layerId ? null : state.selectedLayerId,
      analysisHistory: emptyAnalysisHistory(),
    };
  }),

  toggleMapLayerVisibility: (layerId) => set((state) => {
    if (!state.mapLayers.some((layer) => layer.id === layerId)) return state;
    return {
      mapLayers: state.mapLayers.map((layer) =>
        layer.id === layerId ? { ...layer, visible: !layer.visible } : layer
      ),
      analysisHistory: recordCurrentAnalysis(state, {
        label: 'Toggle layer visibility',
      }),
    };
  }),

  updateMapLayer: (layerId, patch) => set((state) => {
    const layer = state.mapLayers.find((candidate) => candidate.id === layerId);
    if (!layer) return state;
    const unchanged = Object.entries(patch).every(([key, value]) =>
      sameJson((layer as unknown as Record<string, unknown>)[key], value));
    if (unchanged) return state;
    const action = historyActionForMapPatch(layerId, patch);
    return {
      mapLayers: state.mapLayers.map((candidate) =>
        candidate.id === layerId ? { ...candidate, ...patch, styleVersion: candidate.styleVersion + 1 } : candidate
      ),
      ...(action ? { analysisHistory: recordCurrentAnalysis(state, action) } : {}),
    };
  }),

  updateLayerVisualisation: (layerId, visualisation, legend) => set((state) => {
    const layer = state.mapLayers.find((candidate) => candidate.id === layerId);
    if (!layer || (sameJson(layer.visualisation, visualisation) && sameJson(layer.legend, legend))) return state;
    return {
      mapLayers: state.mapLayers.map((candidate) =>
        candidate.id === layerId
          ? { ...candidate, visualisation, legend, styleVersion: candidate.styleVersion + 1 }
          : candidate),
      analysisHistory: recordCurrentAnalysis(state, {
        label: 'Style layer',
        coalesceKey: `layer:${layerId}:visualisation`,
      }),
    };
  }),

  clearLayerVisualisation: (layerId) => set((state) => {
    const layer = state.mapLayers.find((candidate) => candidate.id === layerId);
    if (!layer?.visualisation && !layer?.legend) return state;
    return {
      mapLayers: state.mapLayers.map((candidate) => {
        if (candidate.id !== layerId) return candidate;
        const { visualisation: _visualisation, legend: _legend, ...rest } = candidate;
        return { ...rest, styleVersion: candidate.styleVersion + 1 };
      }),
      analysisHistory: recordCurrentAnalysis(state, {
        label: 'Clear layer style',
      }),
    };
  }),

  reorderMapLayer: (layerId, targetIndex) => set((state) => {
    const sourceIndex = state.mapLayers.findIndex((layer) => layer.id === layerId);
    if (sourceIndex < 0) return {};
    const boundedTarget = Math.max(0, Math.min(targetIndex, state.mapLayers.length - 1));
    if (sourceIndex === boundedTarget) return state;
    const nextLayers = [...state.mapLayers];
    const [layer] = nextLayers.splice(sourceIndex, 1);
    nextLayers.splice(Math.max(0, Math.min(boundedTarget, nextLayers.length)), 0, layer);
    return {
      mapLayers: nextLayers,
      analysisHistory: recordCurrentAnalysis(state, {
        label: 'Reorder layers',
      }),
    };
  }),

  setHoveredFeature: (layerId, featureId) => set((state) => {
    const current = state.visualAnalytics.datasets[layerId] || { selectedFeatureIds: [], filters: [] };
    return {
      visualAnalytics: {
        ...state.visualAnalytics,
        datasets: {
          ...state.visualAnalytics.datasets,
          [layerId]: {
            ...current,
            hoveredFeatureId: featureId || undefined,
          },
        },
      },
    };
  }),

  setHighlightedFeatures: (layerId, featureIds) => set((state) => {
    const current = state.visualAnalytics.datasets[layerId] || { selectedFeatureIds: [], filters: [] };
    return {
      visualAnalytics: {
        ...state.visualAnalytics,
        datasets: {
          ...state.visualAnalytics.datasets,
          [layerId]: {
            ...current,
            highlightedFeatureIds: featureIds,
          },
        },
      },
    };
  }),

  toggleSelectedFeature: (layerId, featureId) => set((state) => {
    const current = state.visualAnalytics.datasets[layerId] || { selectedFeatureIds: [], filters: [] };
    const selected = new Set(current.selectedFeatureIds);
    if (selected.has(featureId)) {
      selected.delete(featureId);
    } else {
      selected.add(featureId);
    }
    return {
      selectedLayerId: layerId,
      visualAnalytics: {
        ...state.visualAnalytics,
        datasets: {
          ...state.visualAnalytics.datasets,
          [layerId]: {
            ...current,
            selectedFeatureIds: [...selected],
          },
        },
      },
      analysisHistory: recordCurrentAnalysis(state, {
        label: 'Change selection',
      }),
    };
  }),

  setFeatureSelection: (layerId, featureIds) => set((state) => {
    const current = state.visualAnalytics.datasets[layerId] || { selectedFeatureIds: [], filters: [] };
    const selectedFeatureIds = [...new Set(featureIds.map(String).filter(Boolean))];
    if (sameJson(current.selectedFeatureIds, selectedFeatureIds)) return state;
    return {
      visualAnalytics: {
        ...state.visualAnalytics,
        datasets: {
          ...state.visualAnalytics.datasets,
          [layerId]: {
            ...current,
            selectedFeatureIds,
          },
        },
      },
      analysisHistory: recordCurrentAnalysis(state, {
        label: 'Change selection',
      }),
    };
  }),

  clearFeatureSelection: (layerId) => set((state) => {
    const current = state.visualAnalytics.datasets[layerId] || { selectedFeatureIds: [], filters: [] };
    if (!current.selectedFeatureIds.length) return state;
    return {
      visualAnalytics: {
        ...state.visualAnalytics,
        datasets: {
          ...state.visualAnalytics.datasets,
          [layerId]: {
            ...current,
            selectedFeatureIds: [],
          },
        },
      },
      analysisHistory: recordCurrentAnalysis(state, {
        label: 'Clear selection',
      }),
    };
  }),

  setLayerFilters: (layerId, filters) => set((state) => {
    const current = state.visualAnalytics.datasets[layerId] || { selectedFeatureIds: [], filters: [] };
    if (sameJson(current.filters, filters)) return state;
    return {
      visualAnalytics: {
        ...state.visualAnalytics,
        datasets: {
          ...state.visualAnalytics.datasets,
          [layerId]: {
            ...current,
            filters,
          },
        },
      },
      analysisHistory: recordCurrentAnalysis(state, {
        label: 'Change filters',
        coalesceKey: `layer:${layerId}:filters`,
      }),
    };
  }),

  clearLayerFilters: (layerId) => set((state) => {
    const current = state.visualAnalytics.datasets[layerId] || { selectedFeatureIds: [], filters: [] };
    if (!current.filters.length) return state;
    return {
      visualAnalytics: {
        ...state.visualAnalytics,
        datasets: {
          ...state.visualAnalytics.datasets,
          [layerId]: {
            ...current,
            filters: [],
          },
        },
      },
      analysisHistory: recordCurrentAnalysis(state, {
        label: 'Clear filters',
      }),
    };
  }),

  addChart: (chart) => set((state) => ({
    visualAnalytics: {
      ...state.visualAnalytics,
      charts: [...state.visualAnalytics.charts, { ...chart, source: chartDatasetSource(chart) }],
    },
    analysisHistory: recordCurrentAnalysis(state, {
      label: 'Add chart',
    }),
  })),

  updateChart: (chartId, patch) => set((state) => {
    const chart = state.visualAnalytics.charts.find((candidate) => candidate.id === chartId);
    if (!chart) return state;
    const next = { ...chart, ...patch };
    if (sameJson(chart, next)) return state;
    return {
      visualAnalytics: {
        ...state.visualAnalytics,
        charts: state.visualAnalytics.charts.map((candidate) => candidate.id === chartId ? next : candidate),
      },
      analysisHistory: recordCurrentAnalysis(state, {
        label: 'Edit chart',
        coalesceKey: `chart:${chartId}:edit`,
      }),
    };
  }),

  removeChart: (chartId) => set((state) => {
    if (!state.visualAnalytics.charts.some((chart) => chart.id === chartId)) return state;
    return {
      visualAnalytics: {
        ...state.visualAnalytics,
        charts: state.visualAnalytics.charts.filter((chart) => chart.id !== chartId),
      },
      analysisHistory: recordCurrentAnalysis(state, {
        label: 'Remove chart',
      }),
    };
  }),

  addKpi: (kpi) => set((state) => {
    if ((!state.datasetRegistry[kpi.datasetId] && !state.mapLayers.some((layer) => layer.id === kpi.datasetId)) || state.visualAnalytics.kpis.some((item) => item.id === kpi.id)) return state;
    return {
      visualAnalytics: { ...state.visualAnalytics, kpis: [...state.visualAnalytics.kpis, { ...kpi, source: kpiDatasetSource(kpi) }] },
      analysisHistory: recordCurrentAnalysis(state, { label: 'Pin metric' }),
    };
  }),

  updateKpi: (kpiId, patch) => set((state) => {
    const kpi = state.visualAnalytics.kpis.find((item) => item.id === kpiId);
    if (!kpi) return state;
    const next = { ...kpi, ...patch };
    if (sameJson(kpi, next)) return state;
    return {
      visualAnalytics: { ...state.visualAnalytics, kpis: state.visualAnalytics.kpis.map((item) => item.id === kpiId ? next : item) },
      analysisHistory: recordCurrentAnalysis(state, { label: 'Edit metric', coalesceKey: `kpi:${kpiId}:edit` }),
    };
  }),

  removeKpi: (kpiId) => set((state) => {
    if (!state.visualAnalytics.kpis.some((item) => item.id === kpiId)) return state;
    return {
      visualAnalytics: { ...state.visualAnalytics, kpis: state.visualAnalytics.kpis.filter((item) => item.id !== kpiId) },
      analysisHistory: recordCurrentAnalysis(state, { label: 'Remove metric' }),
    };
  }),

  reorderKpi: (kpiId, targetIndex) => set((state) => {
    const sourceIndex = state.visualAnalytics.kpis.findIndex((item) => item.id === kpiId);
    if (sourceIndex < 0) return state;
    const next = [...state.visualAnalytics.kpis];
    const [kpi] = next.splice(sourceIndex, 1);
    next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, kpi);
    if (sameJson(next, state.visualAnalytics.kpis)) return state;
    return {
      visualAnalytics: { ...state.visualAnalytics, kpis: next },
      analysisHistory: recordCurrentAnalysis(state, { label: 'Reorder metrics' }),
    };
  }),

  addCohort: (cohort) => set((state) => {
    if (state.visualAnalytics.cohorts.some((item) => item.id === cohort.id)) return state;
    return {
      visualAnalytics: { ...state.visualAnalytics, cohorts: [...state.visualAnalytics.cohorts, cohort] },
      analysisHistory: recordCurrentAnalysis(state, { label: 'Save cohort' }),
    };
  }),

  updateCohort: (cohortId, patch) => set((state) => {
    const cohort = state.visualAnalytics.cohorts.find((item) => item.id === cohortId);
    if (!cohort) return state;
    const next = { ...cohort, ...patch };
    if (sameJson(cohort, next)) return state;
    return {
      visualAnalytics: { ...state.visualAnalytics, cohorts: state.visualAnalytics.cohorts.map((item) => item.id === cohortId ? next : item) },
      analysisHistory: recordCurrentAnalysis(state, { label: 'Edit cohort', coalesceKey: `cohort:${cohortId}:edit` }),
    };
  }),

  duplicateCohort: (cohortId, newId = `cohort-${Date.now()}`) => set((state) => {
    const cohort = state.visualAnalytics.cohorts.find((item) => item.id === cohortId);
    if (!cohort || state.visualAnalytics.cohorts.some((item) => item.id === newId)) return state;
    const duplicate = { ...cohort, id: newId, name: `${cohort.name} copy`, createdAt: Date.now() };
    return {
      visualAnalytics: { ...state.visualAnalytics, cohorts: [...state.visualAnalytics.cohorts, duplicate] },
      analysisHistory: recordCurrentAnalysis(state, { label: 'Duplicate cohort' }),
    };
  }),

  removeCohort: (cohortId) => set((state) => {
    if (!state.visualAnalytics.cohorts.some((item) => item.id === cohortId)) return state;
    const comparison = state.visualAnalytics.comparison;
    return {
      visualAnalytics: {
        ...state.visualAnalytics,
        cohorts: state.visualAnalytics.cohorts.filter((item) => item.id !== cohortId),
        comparison: comparison?.cohortAId === cohortId || comparison?.cohortBId === cohortId ? undefined : comparison,
      },
      analysisHistory: recordCurrentAnalysis(state, { label: 'Remove cohort' }),
    };
  }),

  setCohortComparison: (comparison) => set((state) => ({
    visualAnalytics: (() => {
      if (!comparison) return { ...state.visualAnalytics, comparison: undefined };
      const cohortA = state.visualAnalytics.cohorts.find((item) => item.id === comparison.cohortAId);
      const cohortB = comparison.cohortBId
        ? state.visualAnalytics.cohorts.find((item) => item.id === comparison.cohortBId)
        : undefined;
      if (!cohortA) return { ...state.visualAnalytics, comparison };
      const now = Date.now();
      const spec: ComparisonSpec = {
        id: `comparison-${now}`,
        name: `${cohortA.name} vs ${cohortB?.name || 'remainder'}`,
        operands: [
          { id: 'a', label: cohortA.name, colour: cohortA.colour, datasetId: comparison.datasetId, scope: { kind: 'cohort', cohortId: cohortA.id, definition: structuredClone(cohortA.definition) } },
          ...(cohortB ? [{ id: 'b', label: cohortB.name, colour: cohortB.colour, datasetId: comparison.datasetId, scope: { kind: 'cohort' as const, cohortId: cohortB.id, definition: structuredClone(cohortB.definition) } }] : []),
        ],
        alignment: { mode: 'aggregate-only' },
        measures: [],
        dimensions: [],
        requestedViews: ['overview', 'distribution', 'categories'],
        sourceVersions: { [comparison.datasetId]: state.datasetRegistry[comparison.datasetId]?.sourceVersion },
        createdAt: now,
        updatedAt: now,
      };
      return {
        ...state.visualAnalytics,
        comparison,
        comparisons: [...state.visualAnalytics.comparisons, spec],
        activeComparisonId: spec.id,
      };
    })(),
    analysisHistory: recordCurrentAnalysis(state, { label: comparison ? 'Compare cohorts' : 'Close cohort comparison' }),
  })),

  addComparison: (comparison) => set((state) => ({
    visualAnalytics: {
      ...state.visualAnalytics,
      comparisons: [...state.visualAnalytics.comparisons.filter((item) => item.id !== comparison.id), comparison],
      activeComparisonId: comparison.id,
    },
    analysisHistory: recordCurrentAnalysis(state, { label: 'Create comparison' }),
  })),

  updateComparison: (comparisonId, patch) => set((state) => ({
    visualAnalytics: {
      ...state.visualAnalytics,
      comparisons: state.visualAnalytics.comparisons.map((item) => item.id === comparisonId
        ? { ...item, ...patch, updatedAt: patch.updatedAt ?? Date.now() }
        : item),
    },
    analysisHistory: recordCurrentAnalysis(state, { label: 'Edit comparison', coalesceKey: `comparison:${comparisonId}:edit` }),
  })),

  duplicateComparison: (comparisonId, newId = `comparison-${Date.now()}`) => set((state) => {
    const comparison = state.visualAnalytics.comparisons.find((item) => item.id === comparisonId);
    if (!comparison) return state;
    const now = Date.now();
    const duplicate: ComparisonSpec = structuredClone({ ...comparison, id: newId, name: `${comparison.name} copy`, createdAt: now, updatedAt: now });
    return {
      visualAnalytics: { ...state.visualAnalytics, comparisons: [...state.visualAnalytics.comparisons, duplicate], activeComparisonId: newId },
      analysisHistory: recordCurrentAnalysis(state, { label: 'Duplicate comparison' }),
    };
  }),

  removeComparison: (comparisonId) => set((state) => ({
    visualAnalytics: {
      ...state.visualAnalytics,
      comparisons: state.visualAnalytics.comparisons.filter((item) => item.id !== comparisonId),
      activeComparisonId: state.visualAnalytics.activeComparisonId === comparisonId ? undefined : state.visualAnalytics.activeComparisonId,
    },
    analysisHistory: recordCurrentAnalysis(state, { label: 'Remove comparison' }),
  })),

  setActiveComparison: (activeComparisonId) => set((state) => ({
    visualAnalytics: { ...state.visualAnalytics, activeComparisonId },
  })),

  addBookmark: (bookmark) => set((state) => ({
    visualAnalytics: { ...state.visualAnalytics, bookmarks: [...state.visualAnalytics.bookmarks.filter((item) => item.id !== bookmark.id), bookmark] },
  })),

  updateBookmark: (bookmarkId, patch) => set((state) => ({
    visualAnalytics: { ...state.visualAnalytics, bookmarks: state.visualAnalytics.bookmarks.map((item) => item.id === bookmarkId ? { ...item, ...patch } : item) },
  })),

  removeBookmark: (bookmarkId) => set((state) => ({
    visualAnalytics: { ...state.visualAnalytics, bookmarks: state.visualAnalytics.bookmarks.filter((item) => item.id !== bookmarkId) },
  })),

  restoreBookmark: (bookmarkId) => set((state) => {
    const bookmark = state.visualAnalytics.bookmarks.find((item) => item.id === bookmarkId);
    if (!bookmark) return state;
    const datasetIds = new Set([...Object.keys(state.visualAnalytics.datasets), ...Object.keys(bookmark.filtersByDataset)]);
    const datasets = Object.fromEntries([...datasetIds].map((datasetId) => {
      const interaction = state.visualAnalytics.datasets[datasetId] || { selectedFeatureIds: [], filters: [] };
      return [datasetId, { ...interaction, filters: bookmark.filtersByDataset[datasetId] || [] }];
    }));
    return {
      selectedLayerId: bookmark.datasetId,
      ui: { ...state.ui, mapCamera: bookmark.mapCamera },
      visualAnalytics: {
        ...state.visualAnalytics,
        datasets,
        charts: bookmark.charts,
        kpis: bookmark.kpis,
        cohorts: bookmark.cohorts,
        comparison: undefined,
      },
      analysisHistory: recordCurrentAnalysis(state, { label: `Restore bookmark ${bookmark.name}` }),
    };
  }),

  setDashboardTitle: (title) => set((state) => ({
    visualAnalytics: {
      ...state.visualAnalytics,
      dashboard: { title, cards: state.visualAnalytics.dashboard?.cards || [] },
      explain: { ...state.visualAnalytics.explain, title },
    },
  })),

  addDashboardCard: (card) => set((state) => ({
    visualAnalytics: {
      ...state.visualAnalytics,
      dashboard: {
        title: state.visualAnalytics.dashboard?.title || 'Analysis board',
        cards: [...(state.visualAnalytics.dashboard?.cards || []).filter((item) => item.id !== card.id), card],
      },
      explain: {
        ...state.visualAnalytics.explain,
        cards: [
          ...state.visualAnalytics.explain.cards.filter((item) => item.id !== card.id),
          {
            ...card,
            sectionId: 'evidence',
            width: card.width === 2 ? 12 : 6,
            behaviour: 'frozen',
            provenance: { capturedAt: Date.now(), datasetIds: card.datasetId ? [card.datasetId] : [], sourceVersions: {}, filtersByDataset: {}, caveats: [] },
          } as ExplainCard,
        ],
      },
    },
  })),

  updateDashboardCard: (cardId, patch) => set((state) => ({
    visualAnalytics: {
      ...state.visualAnalytics,
      dashboard: {
        title: state.visualAnalytics.dashboard?.title || 'Analysis board',
        cards: (state.visualAnalytics.dashboard?.cards || []).map((card) => card.id === cardId ? { ...card, ...patch } : card),
      },
      explain: {
        ...state.visualAnalytics.explain,
        cards: state.visualAnalytics.explain.cards.map((card) => card.id === cardId ? {
          ...card,
          referenceId: patch.referenceId ?? card.referenceId,
          datasetId: patch.datasetId ?? card.datasetId,
          title: patch.title ?? card.title,
          note: patch.note ?? card.note,
          width: patch.width === 2 ? 12 : patch.width === 1 ? 6 : card.width,
          height: patch.height ?? card.height,
        } : card),
      },
    },
  })),

  removeDashboardCard: (cardId) => set((state) => ({
    visualAnalytics: {
      ...state.visualAnalytics,
      dashboard: {
        title: state.visualAnalytics.dashboard?.title || 'Analysis board',
        cards: (state.visualAnalytics.dashboard?.cards || []).filter((card) => card.id !== cardId),
      },
      explain: { ...state.visualAnalytics.explain, cards: state.visualAnalytics.explain.cards.filter((card) => card.id !== cardId) },
    },
  })),

  setExplainTitle: (title) => set((state) => ({
    visualAnalytics: { ...state.visualAnalytics, explain: { ...state.visualAnalytics.explain, title } },
    analysisHistory: recordCurrentAnalysis(state, { label: 'Rename explanation', coalesceKey: 'explain:title' }),
  })),

  updateExplainDocument: (patch) => set((state) => ({
    visualAnalytics: { ...state.visualAnalytics, explain: { ...state.visualAnalytics.explain, ...patch } },
    analysisHistory: recordCurrentAnalysis(state, { label: 'Edit explanation context', coalesceKey: 'explain:context' }),
  })),

  addExplainSection: (section) => set((state) => ({
    visualAnalytics: { ...state.visualAnalytics, explain: { ...state.visualAnalytics.explain, sections: [...state.visualAnalytics.explain.sections, section] } },
    analysisHistory: recordCurrentAnalysis(state, { label: 'Add explanation section' }),
  })),

  updateExplainSection: (sectionId, patch) => set((state) => ({
    visualAnalytics: { ...state.visualAnalytics, explain: { ...state.visualAnalytics.explain, sections: state.visualAnalytics.explain.sections.map((section) => section.id === sectionId ? { ...section, ...patch } : section) } },
    analysisHistory: recordCurrentAnalysis(state, { label: 'Edit explanation section', coalesceKey: `explain-section:${sectionId}` }),
  })),

  reorderExplainSection: (sectionId, targetIndex) => set((state) => {
    const sections = [...state.visualAnalytics.explain.sections];
    const sourceIndex = sections.findIndex((section) => section.id === sectionId);
    if (sourceIndex < 0) return state;
    const [section] = sections.splice(sourceIndex, 1);
    sections.splice(Math.max(0, Math.min(targetIndex, sections.length)), 0, section);
    return { visualAnalytics: { ...state.visualAnalytics, explain: { ...state.visualAnalytics.explain, sections } }, analysisHistory: recordCurrentAnalysis(state, { label: 'Reorder explanation sections' }) };
  }),

  removeExplainSection: (sectionId) => set((state) => ({
    visualAnalytics: { ...state.visualAnalytics, explain: { ...state.visualAnalytics.explain, sections: state.visualAnalytics.explain.sections.filter((section) => section.id !== sectionId), cards: state.visualAnalytics.explain.cards.filter((card) => card.sectionId !== sectionId) } },
    analysisHistory: recordCurrentAnalysis(state, { label: 'Remove explanation section' }),
  })),

  addExplainCard: (card) => set((state) => ({
    visualAnalytics: { ...state.visualAnalytics, explain: { ...state.visualAnalytics.explain, cards: [...state.visualAnalytics.explain.cards.filter((item) => item.id !== card.id), card] } },
    analysisHistory: recordCurrentAnalysis(state, { label: 'Pin evidence' }),
  })),

  updateExplainCard: (cardId, patch) => set((state) => ({
    visualAnalytics: { ...state.visualAnalytics, explain: { ...state.visualAnalytics.explain, cards: state.visualAnalytics.explain.cards.map((card) => card.id === cardId ? { ...card, ...patch } : card) } },
    analysisHistory: recordCurrentAnalysis(state, { label: 'Edit evidence', coalesceKey: `explain-card:${cardId}` }),
  })),

  reorderExplainCard: (cardId, sectionId, targetIndex) => set((state) => {
    const card = state.visualAnalytics.explain.cards.find((item) => item.id === cardId);
    if (!card) return state;
    const without = state.visualAnalytics.explain.cards.filter((item) => item.id !== cardId);
    const sectionCards = without.filter((item) => item.sectionId === sectionId);
    const insertionTarget = Math.max(0, Math.min(targetIndex, sectionCards.length));
    const anchor = sectionCards[insertionTarget];
    const index = anchor ? without.indexOf(anchor) : without.length;
    without.splice(index, 0, { ...card, sectionId });
    return { visualAnalytics: { ...state.visualAnalytics, explain: { ...state.visualAnalytics.explain, cards: without } }, analysisHistory: recordCurrentAnalysis(state, { label: 'Reorder evidence' }) };
  }),

  removeExplainCard: (cardId) => set((state) => ({
    visualAnalytics: { ...state.visualAnalytics, explain: { ...state.visualAnalytics.explain, cards: state.visualAnalytics.explain.cards.filter((card) => card.id !== cardId) } },
    analysisHistory: recordCurrentAnalysis(state, { label: 'Remove evidence' }),
  })),

  addVariant: (variant) => set((state) => ({
    visualAnalytics: { ...state.visualAnalytics, variants: [...state.visualAnalytics.variants.filter((item) => item.id !== variant.id), variant] },
    analysisHistory: recordCurrentAnalysis(state, { label: 'Create analysis variant' }),
  })),

  branchVariant: (variantId, newId = `variant-${Date.now()}`) => set((state) => {
    const parent = state.visualAnalytics.variants.find((item) => item.id === variantId);
    if (!parent) return state;
    const branch: AnalysisVariant = structuredClone({ ...parent, id: newId, name: `${parent.name} branch`, parentVariantId: parent.id, workflowOutputDatasetId: undefined, createdAt: Date.now(), provenance: { ...parent.provenance, workflowNodeIds: [] } });
    return { visualAnalytics: { ...state.visualAnalytics, variants: [...state.visualAnalytics.variants, branch] }, analysisHistory: recordCurrentAnalysis(state, { label: 'Branch analysis variant' }) };
  }),

  updateVariant: (variantId, patch) => set((state) => ({
    visualAnalytics: { ...state.visualAnalytics, variants: state.visualAnalytics.variants.map((variant) => variant.id === variantId ? { ...variant, ...patch } : variant) },
    analysisHistory: recordCurrentAnalysis(state, { label: 'Edit analysis variant', coalesceKey: `variant:${variantId}` }),
  })),

  removeVariant: (variantId) => set((state) => ({
    visualAnalytics: { ...state.visualAnalytics, variants: state.visualAnalytics.variants.filter((variant) => variant.id !== variantId) },
    analysisHistory: recordCurrentAnalysis(state, { label: 'Remove analysis variant' }),
  })),

  addChatMessage: (role, content, data) => set((state) => ({
    chatMessages: [...state.chatMessages, { role, content, kind: data?.kind as any, data }]
  })),

  addToast: (toast) => set((state) => ({
    toasts: [...state.toasts, { ...toast, id: `toast-${Date.now()}` }]
  })),

  removeToast: (id) => set((state) => ({
    toasts: state.toasts.filter((t) => t.id !== id)
  })),
}), {
  name: 'alur-settings',
  version: 1,
  // User settings and layout preferences persist; workflow/layer state is
  // ephemeral by design. Layout keys are allow-listed so transient UI (open
  // dialogs, recovery status, camera) never survives a reload.
  partialize: (state) => ({
    settings: state.settings,
    ui: pickLayoutPreferences(state.ui),
  }) as unknown as AppState,
  // Zustand's default merge is shallow, which would replace the whole `ui`
  // slice with the persisted subset and drop every transient key.
  merge: (persisted, current) => {
    const saved = persisted as Partial<AppState> | undefined;
    return {
      ...current,
      settings: { ...current.settings, ...(saved?.settings || {}) },
      ui: { ...current.ui, ...pickLayoutPreferences(saved?.ui) },
    };
  },
  storage: createJSONStorage(() => (typeof window === 'undefined' ? noopStorage : window.localStorage)),
}));

if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  // Debug handle for dev tools and E2E runs.
  (window as unknown as Record<string, unknown>).__alurStore = useStore;
}
