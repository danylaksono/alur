import packageJson from '../../package.json';
import { useStore, type MapLayer, type WorkflowNode } from '../store/useStore';
import type { VisualAnalyticsState } from '../types/visualAnalytics';
import {
  PROJECT_MANIFEST_VERSION,
  type ProjectLayerPresentation,
  type ProjectManifestV1,
  type ProjectSourceDescriptor,
} from '../types/project';
import { BASEMAPS } from '../utils/basemaps';
import { downloadText, filenameTimestamp, safeFilename } from '../utils/download';
import { migrateVisualAnalyticsSources } from '../utils/datasetSource';

const TABLE_VIEWS_STORAGE_KEY = 'alur-table-views';
const SECRET_OR_DATA_KEY = /(api.?key|access.?token|auth.?token|password|secret|credential|raw.?data|file.?content|geojson)/i;
const TRANSIENT_CONFIG_KEYS = new Set(['loadStage', 'loadError']);

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const sanitiseValue = (value: unknown, seen = new WeakSet<object>()): unknown => {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') return undefined;
  if (typeof File !== 'undefined' && value instanceof File) return undefined;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return undefined;
  if (typeof value !== 'object') return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitiseValue(item, seen)).filter((item) => item !== undefined);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SECRET_OR_DATA_KEY.test(key) && !TRANSIENT_CONFIG_KEYS.has(key))
      .map(([key, item]) => [key, sanitiseValue(item, seen)])
      .filter(([, item]) => item !== undefined),
  );
};

const sanitiseNode = (node: WorkflowNode): WorkflowNode => {
  const clean = sanitiseValue(node) as WorkflowNode;
  if (clean.data.type !== 'input') return clean;
  return {
    ...clean,
    data: {
      ...clean.data,
      config: {
        ...clean.data.config,
        loadStatus: 'missing-source',
      },
    },
  };
};

const sourceDescriptorForNode = (node: WorkflowNode): ProjectSourceDescriptor | null => {
  if (node.data.type !== 'input') return null;
  const config = node.data.config || {};
  const fingerprint = isRecord(config.sourceFingerprint) ? config.sourceFingerprint : {};
  const name = String(fingerprint.name || config.fileName || '').trim();
  if (!name) return null;
  return {
    nodeId: node.id,
    name,
    tableName: typeof config.tableName === 'string' ? config.tableName : undefined,
    format: typeof fingerprint.format === 'string' ? fingerprint.format : name.split('.').pop()?.toLowerCase(),
    sourceKind: fingerprint.sourceKind === 'url' || fingerprint.sourceKind === 'clipboard' ? fingerprint.sourceKind : 'file',
    size: typeof fingerprint.size === 'number' ? fingerprint.size : undefined,
    lastModified: typeof fingerprint.lastModified === 'number' ? fingerprint.lastModified : undefined,
  };
};

const layerPresentation = (layer: MapLayer): ProjectLayerPresentation => ({
  id: layer.id,
  name: layer.name,
  sourceNodeId: layer.sourceNodeId,
  sourceKind: layer.sourceKind,
  visible: layer.visible,
  opacity: layer.opacity,
  color: layer.color,
  visualisation: sanitiseValue(layer.visualisation) as MapLayer['visualisation'],
  legend: sanitiseValue(layer.legend) as MapLayer['legend'],
  clusterRadius: layer.clusterRadius,
  clusterMaxZoom: layer.clusterMaxZoom,
  dotDensityLayerId: layer.dotDensityLayerId,
  hexbinLayerId: layer.hexbinLayerId,
});

const persistedAnalytics = (analytics: VisualAnalyticsState): VisualAnalyticsState => ({
  datasets: Object.fromEntries(Object.entries(analytics.datasets).map(([datasetId, dataset]) => [datasetId, {
    selectedFeatureIds: [],
    filters: sanitiseValue(dataset.filters) as typeof dataset.filters,
  }])),
  charts: sanitiseValue(analytics.charts) as VisualAnalyticsState['charts'],
  kpis: sanitiseValue(analytics.kpis) as VisualAnalyticsState['kpis'],
  cohorts: sanitiseValue(analytics.cohorts) as VisualAnalyticsState['cohorts'],
  bookmarks: sanitiseValue(analytics.bookmarks) as VisualAnalyticsState['bookmarks'],
  comparison: sanitiseValue(analytics.comparison) as VisualAnalyticsState['comparison'],
  dashboard: sanitiseValue(analytics.dashboard) as VisualAnalyticsState['dashboard'],
});

const normaliseAnalytics = (analytics: ProjectManifestV1['visualAnalytics'] | Record<string, unknown>): VisualAnalyticsState => {
  const value = analytics as ProjectManifestV1['visualAnalytics'] & { layers?: VisualAnalyticsState['datasets'] };
  return migrateVisualAnalyticsSources({
    datasets: value.datasets || value.layers || {},
    charts: value.charts || [],
    kpis: value.kpis || [],
    cohorts: value.cohorts || [],
    bookmarks: value.bookmarks || [],
    comparison: value.comparison,
    dashboard: value.dashboard,
  });
};

const savedTableViews = () => {
  if (typeof window === 'undefined') return {};
  try {
    const value = JSON.parse(window.localStorage.getItem(TABLE_VIEWS_STORAGE_KEY) || '{}');
    return isRecord(value) ? value as Record<string, unknown[]> : {};
  } catch {
    return {};
  }
};

export const createProjectManifest = (state = useStore.getState(), exportedAt = new Date()): ProjectManifestV1 => ({
  kind: 'alur-project',
  version: PROJECT_MANIFEST_VERSION,
  appVersion: packageJson.version,
  exportedAt: exportedAt.toISOString(),
  workflow: {
    nodes: state.nodes.map(sanitiseNode),
    edges: sanitiseValue(state.edges) as typeof state.edges,
  },
  sources: state.nodes.map(sourceDescriptorForNode).filter((source): source is ProjectSourceDescriptor => Boolean(source)),
  datasets: sanitiseValue(Object.values(state.datasetRegistry)) as ProjectManifestV1['datasets'],
  layers: state.mapLayers.map(layerPresentation),
  visualAnalytics: persistedAnalytics(state.visualAnalytics),
  workspace: {
    selectedBasemapId: state.selectedBasemapId,
    selectedNodeId: state.selectedNodeId,
    selectedLayerId: state.selectedLayerId,
    activeRailTab: state.ui.activeRailTab,
    activeDrawerTab: state.ui.activeDrawerTab,
    drawerMode: state.ui.drawerMode,
    drawerHeight: state.ui.drawerHeight,
    isPanelCollapsed: state.ui.isPanelCollapsed,
    workspaceMode: state.ui.workspaceMode,
    mapCamera: state.ui.mapCamera,
    manualSQL: state.manualSQL,
    isManualSQL: state.isManualSQL,
  },
  savedTableViews: savedTableViews(),
});

const validateManifest = (value: unknown): ProjectManifestV1 => {
  if (!isRecord(value) || value.kind !== 'alur-project') throw new Error('This is not an ALUR project file.');
  if (typeof value.version !== 'number') throw new Error('The project version is missing.');
  if (value.version > PROJECT_MANIFEST_VERSION) throw new Error(`This project uses version ${value.version}, but this ALUR build supports up to version ${PROJECT_MANIFEST_VERSION}. Update ALUR to open it.`);
  if (value.version < 1) throw new Error(`Project version ${value.version} is no longer supported.`);
  if (!isRecord(value.workflow) || !Array.isArray(value.workflow.nodes) || !Array.isArray(value.workflow.edges)) throw new Error('The project workflow is invalid.');
  if (!Array.isArray(value.sources) || !Array.isArray(value.layers)) throw new Error('The project source or layer descriptors are invalid.');
  if (!isRecord(value.visualAnalytics) || !Array.isArray(value.visualAnalytics.charts) || !Array.isArray(value.visualAnalytics.kpis) || (!isRecord(value.visualAnalytics.datasets) && !isRecord(value.visualAnalytics.layers))) throw new Error('The project analytics configuration is invalid.');
  const workspace = value.workspace;
  if (!isRecord(workspace) || !BASEMAPS.some((basemap) => basemap.id === workspace.selectedBasemapId)) throw new Error('The project workspace settings are invalid.');
  const manifest = value as unknown as ProjectManifestV1;
  return {
    ...manifest,
    visualAnalytics: normaliseAnalytics(manifest.visualAnalytics),
    workspace: {
      ...manifest.workspace,
      mapCamera: manifest.workspace.mapCamera || { longitude: 0, latitude: 20, zoom: 1.5, bearing: 0, pitch: 0 },
    },
    savedTableViews: manifest.savedTableViews || {},
    datasets: Array.isArray(manifest.datasets) ? manifest.datasets : [],
  };
};

/** Sequential migration entry point. Version 0 was the short-lived pre-manifest prototype. */
export const migrateProjectManifest = (value: unknown): unknown => {
  if (!isRecord(value) || typeof value.version !== 'number') return value;
  if (value.version !== 0) return value;
  const legacyWorkspace = isRecord(value.workspace) ? value.workspace : {};
  const legacyWorkflow = isRecord(value.workflow) ? value.workflow : {};
  return {
    ...value,
    kind: 'alur-project',
    version: PROJECT_MANIFEST_VERSION,
    appVersion: typeof value.appVersion === 'string' ? value.appVersion : '0.0.0',
    exportedAt: typeof value.exportedAt === 'string' ? value.exportedAt : new Date(0).toISOString(),
    workflow: {
      nodes: Array.isArray(legacyWorkflow.nodes) ? legacyWorkflow.nodes : Array.isArray(value.nodes) ? value.nodes : [],
      edges: Array.isArray(legacyWorkflow.edges) ? legacyWorkflow.edges : Array.isArray(value.edges) ? value.edges : [],
    },
    sources: Array.isArray(value.sources) ? value.sources : [],
    datasets: Array.isArray(value.datasets) ? value.datasets : [],
    layers: Array.isArray(value.layers) ? value.layers : [],
    visualAnalytics: isRecord(value.visualAnalytics) ? value.visualAnalytics : { layers: {}, charts: [], kpis: [] },
    workspace: {
      selectedBasemapId: legacyWorkspace.selectedBasemapId || 'positron',
      selectedNodeId: legacyWorkspace.selectedNodeId ?? null,
      selectedLayerId: legacyWorkspace.selectedLayerId ?? null,
      activeRailTab: legacyWorkspace.activeRailTab || 'layers',
      activeDrawerTab: legacyWorkspace.activeDrawerTab || 'workflow',
      drawerMode: legacyWorkspace.drawerMode || 'open',
      drawerHeight: typeof legacyWorkspace.drawerHeight === 'number' ? legacyWorkspace.drawerHeight : 320,
      isPanelCollapsed: Boolean(legacyWorkspace.isPanelCollapsed),
      workspaceMode: legacyWorkspace.workspaceMode === 'board' ? 'board' : 'explore',
      mapCamera: legacyWorkspace.mapCamera || { longitude: 0, latitude: 20, zoom: 1.5, bearing: 0, pitch: 0 },
      manualSQL: typeof legacyWorkspace.manualSQL === 'string' ? legacyWorkspace.manualSQL : '',
      isManualSQL: Boolean(legacyWorkspace.isManualSQL),
    },
    savedTableViews: isRecord(value.savedTableViews) ? value.savedTableViews : {},
  };
};

export const parseProjectManifest = (text: string) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('The project file is not valid JSON.');
  }
  return validateManifest(migrateProjectManifest(parsed));
};

export const serialiseProjectManifest = (manifest: ProjectManifestV1) => JSON.stringify(validateManifest(manifest), null, 2);

export const downloadProjectManifest = (manifest = createProjectManifest(), projectName = 'alur-project') => {
  const fileName = `${safeFilename(projectName, 'alur-project')}-${filenameTimestamp(new Date(manifest.exportedAt))}.alur.json`;
  downloadText(serialiseProjectManifest(manifest), fileName, 'application/json;charset=utf-8');
};

export const applyProjectManifest = (manifest: ProjectManifestV1) => {
  const valid = validateManifest(manifest);
  useStore.getState().resetWorkspace();
  useStore.setState((state) => ({
    nodes: valid.workflow.nodes.map(sanitiseNode),
    edges: valid.workflow.edges,
    mapLayers: [],
    datasetRegistry: Object.fromEntries(valid.datasets.map((dataset) => [dataset.id, dataset])),
    selectedBasemapId: valid.workspace.selectedBasemapId,
    selectedNodeId: valid.workspace.selectedNodeId,
    selectedLayerId: null,
    manualSQL: valid.workspace.manualSQL,
    isManualSQL: valid.workspace.isManualSQL,
    visualAnalytics: normaliseAnalytics(valid.visualAnalytics),
    nodeSchemas: {},
    nodeExecutionStates: {},
    loadingOperations: {},
    restylingLayerIds: {},
    ui: {
      ...state.ui,
      activeRailTab: valid.workspace.activeRailTab,
      activeDrawerTab: valid.workspace.activeDrawerTab,
      drawerMode: valid.workspace.drawerMode,
      drawerHeight: valid.workspace.drawerHeight,
      isPanelCollapsed: valid.workspace.isPanelCollapsed,
      workspaceMode: valid.workspace.workspaceMode || 'explore',
      isPresentationMode: false,
      mapCamera: valid.workspace.mapCamera || state.ui.mapCamera,
      datasetOverviewLayerId: null,
      layerStyleRequest: undefined,
    },
  }));
  useStore.getState().clearAnalysisHistory();
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(TABLE_VIEWS_STORAGE_KEY, JSON.stringify(valid.savedTableViews || {}));
    window.dispatchEvent(new Event('alur-table-views-imported'));
  }
  return valid.sources;
};

export const applyRelinkedLayerPresentation = (sourceNodeId: string, layerId: string, manifest: ProjectManifestV1) => {
  const presentation = manifest.layers.find((layer) => layer.sourceNodeId === sourceNodeId || layer.id === layerId);
  if (!presentation) return;
  useStore.setState((state) => ({
    mapLayers: state.mapLayers.map((layer) => layer.id === layerId ? {
      ...layer,
      name: presentation.name,
      visible: presentation.visible,
      opacity: presentation.opacity,
      color: presentation.color,
      visualisation: presentation.visualisation,
      legend: presentation.legend,
      clusterRadius: presentation.clusterRadius,
      clusterMaxZoom: presentation.clusterMaxZoom,
      dotDensityLayerId: presentation.dotDensityLayerId,
      hexbinLayerId: presentation.hexbinLayerId,
      styleVersion: layer.styleVersion + 1,
    } : layer),
  }));
};

export const sourceMatchesFile = (source: ProjectSourceDescriptor, file: File) => {
  if (file.name !== source.name) return false;
  if (source.size !== undefined && file.size !== source.size) return false;
  if ((source.sourceKind === undefined || source.sourceKind === 'file') && source.lastModified !== undefined && file.lastModified !== source.lastModified) return false;
  return true;
};
