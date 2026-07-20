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
import type { VisualAnalyticsState, VisualChartSpec, VisualFilter } from '../types/visualAnalytics';
import type { MvtTileSource } from '../services/duckdb';
import type { LayerSource } from '../types/layers';
import type { LayerBounds } from '../types/layers';

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

export type GISNode = Node & {
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

export type RailTab = 'layers' | 'charts' | 'chat';
export type DrawerTab = 'workflow' | 'table' | 'sql';
export type DrawerMode = 'collapsed' | 'open' | 'maximized';

export type UIState = {
  activeRailTab: RailTab;
  isPanelCollapsed: boolean;
  drawerMode: DrawerMode;
  drawerHeight: number;
  activeDrawerTab: DrawerTab;
  isSettingsOpen: boolean;
  isAboutOpen: boolean;
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

interface AppState {
  nodes: GISNode[];
  edges: Edge[];
  duckdbReady: boolean;
  selectedBasemapId: BasemapId;
  mapLayers: MapLayer[];
  chatMessages: ChatMessage[];
  manualSQL: string;
  isManualSQL: boolean;
  selectedNodeId: string | null;
  selectedLayerId: string | null;
  layerFocusRequest: { layerId: string; requestedAt: number; bounds?: LayerBounds } | null;
  nodeSchemas: Record<string, any[]>;
  nodeExecutionStates: Record<string, NodeExecutionState>;
  visualAnalytics: VisualAnalyticsState;
  toasts: Toast[];
  ui: UIState;
  settings: SettingsState;
  /** Layers whose map source/tiles are currently re-rendering after a style or filter change. */
  restylingLayerIds: Record<string, true>;

  setActiveRailTab: (tab: RailTab) => void;
  togglePanelCollapsed: () => void;
  setDrawerMode: (mode: DrawerMode) => void;
  setDrawerHeight: (height: number) => void;
  setActiveDrawerTab: (tab: DrawerTab) => void;
  openDrawerTab: (tab: DrawerTab) => void;
  setSettingsOpen: (open: boolean) => void;
  setAboutOpen: (open: boolean) => void;
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
  addNode: (node: GISNode) => void;
  updateNode: (id: string, config: any) => void;
  removeNode: (id: string) => void;
  duplicateNode: (id: string, newId?: string, position?: { x: number; y: number }) => void;
  addMapLayer: (layer: NewMapLayer) => void;
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
  addChatMessage: (role: 'user' | 'assistant' | 'system', content: string, data?: { kind?: string; toolName?: string; summary?: string; icon?: string }) => void;
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

export type NewMapLayer = Omit<MapLayer, 'visible' | 'opacity' | 'createdAt' | 'featureCount' | 'styleVersion' | 'source'> &
  Partial<Pick<MapLayer, 'visible' | 'opacity' | 'createdAt' | 'featureCount' | 'styleVersion' | 'source'>>;

if (typeof window !== 'undefined') {
  window.localStorage.removeItem('ymnngis-workflow');
}

const removeRecordKeys = <T>(record: Record<string, T>, ids: Set<string>) =>
  Object.fromEntries(Object.entries(record).filter(([id]) => !ids.has(id)));

const emptyFeatureCollection: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

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
  isPanelCollapsed: false,
  drawerMode: 'open',
  drawerHeight: 320,
  activeDrawerTab: 'workflow',
  isSettingsOpen: false,
  isAboutOpen: false,
};

const initialSettings: SettingsState = {
  openRouterApiKey: '',
  openRouterModelId: 'openai/gpt-4o-mini',
};

export const useStore = create<AppState>()(persist((set, get) => ({
  nodes: [],
  edges: [],
  duckdbReady: false,
  selectedBasemapId: DEFAULT_BASEMAP_ID,
  mapLayers: [],
  chatMessages: initialChatMessages,
  manualSQL: '',
  isManualSQL: false,
  selectedNodeId: null,
  selectedLayerId: null,
  layerFocusRequest: null,
  nodeSchemas: {},
  nodeExecutionStates: {},
  visualAnalytics: { layers: {}, charts: [] },
  toasts: [],
  ui: initialUIState,
  settings: initialSettings,
  restylingLayerIds: {},

  setLayerRestyling: (layerId, restyling) => set((state) => {
    const isRestyling = Boolean(state.restylingLayerIds[layerId]);
    if (isRestyling === restyling) return state;
    if (restyling) {
      return { restylingLayerIds: { ...state.restylingLayerIds, [layerId]: true as const } };
    }
    return { restylingLayerIds: removeRecordKeys(state.restylingLayerIds, new Set([layerId])) };
  }),

  setActiveRailTab: (tab) => set((state) => ({
    ui: { ...state.ui, activeRailTab: tab, isPanelCollapsed: false },
  })),
  togglePanelCollapsed: () => set((state) => ({
    ui: { ...state.ui, isPanelCollapsed: !state.ui.isPanelCollapsed },
  })),
  setDrawerMode: (mode) => set((state) => ({
    ui: { ...state.ui, drawerMode: mode },
  })),
  setDrawerHeight: (height) => set((state) => {
    const maxHeight = typeof window === 'undefined' ? 800 : window.innerHeight - 160;
    return { ui: { ...state.ui, drawerHeight: Math.max(160, Math.min(height, maxHeight)) } };
  }),
  setActiveDrawerTab: (tab) => set((state) => ({
    ui: { ...state.ui, activeDrawerTab: tab },
  })),
  openDrawerTab: (tab) => set((state) => ({
    ui: {
      ...state.ui,
      activeDrawerTab: tab,
      drawerMode: state.ui.drawerMode === 'collapsed' ? 'open' : state.ui.drawerMode,
    },
  })),
  setSettingsOpen: (open) => set((state) => ({
    ui: { ...state.ui, isSettingsOpen: open },
  })),
  setAboutOpen: (open) => set((state) => ({
    ui: { ...state.ui, isAboutOpen: open },
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

  resetWorkspace: () => set({
    nodes: [],
    edges: [],
    selectedBasemapId: DEFAULT_BASEMAP_ID,
    mapLayers: [],
    chatMessages: initialChatMessages,
    manualSQL: '',
    isManualSQL: false,
    selectedNodeId: null,
    selectedLayerId: null,
    layerFocusRequest: null,
    nodeSchemas: {},
    nodeExecutionStates: {},
    visualAnalytics: { layers: {}, charts: [] },
    restylingLayerIds: {},
  }),

  onNodesChange: (changes) => {
    const removedNodeIds = new Set(
      changes
        .filter((change) => change.type === 'remove')
        .map((change) => change.id)
    );
    const nextNodes = applyNodeChanges(changes, get().nodes) as GISNode[];
    const nextNodeIds = new Set(nextNodes.map((node) => node.id));

    const nextLayers = removedNodeIds.size
      ? get().mapLayers.filter((layer) => !layer.sourceNodeId || !removedNodeIds.has(layer.sourceNodeId))
      : get().mapLayers;
    const nextLayerIds = new Set(nextLayers.map((layer) => layer.id));

    set({
      nodes: nextNodes,
      edges: get().edges.filter((edge) => nextNodeIds.has(edge.source) && nextNodeIds.has(edge.target)),
      mapLayers: nextLayers,
      visualAnalytics: {
        layers: Object.fromEntries(
          Object.entries(get().visualAnalytics.layers).filter(([layerId]) => nextLayerIds.has(layerId))
        ),
        charts: get().visualAnalytics.charts.filter((chart) => nextLayerIds.has(chart.layerId)),
      },
      selectedNodeId: get().selectedNodeId && nextNodeIds.has(get().selectedNodeId!)
        ? get().selectedNodeId
        : null,
      selectedLayerId: get().selectedLayerId && nextLayerIds.has(get().selectedLayerId!)
        ? get().selectedLayerId
        : null,
      nodeSchemas: removeRecordKeys(get().nodeSchemas, removedNodeIds),
      nodeExecutionStates: removeRecordKeys(get().nodeExecutionStates, removedNodeIds),
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
    const visualAnalyticsLayers = removeRecordKeys(state.visualAnalytics.layers, removedLayerIds);

    return {
      nodes: state.nodes.filter((n) => n.id !== id),
      edges: state.edges.filter((edge) => edge.source !== id && edge.target !== id),
      mapLayers,
      visualAnalytics: {
        layers: visualAnalyticsLayers,
        charts: state.visualAnalytics.charts.filter((chart) => !removedLayerIds.has(chart.layerId)),
      },
      selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
      selectedLayerId: state.selectedLayerId && layerIds.has(state.selectedLayerId) ? state.selectedLayerId : null,
      nodeSchemas: removeRecordKeys(state.nodeSchemas, removedIds),
      nodeExecutionStates: removeRecordKeys(state.nodeExecutionStates, removedIds),
    };
  }),

  duplicateNode: (id, newId = `node-${Date.now()}`, position) => set((state) => {
    const node = state.nodes.find((item) => item.id === id);
    if (!node) return {};

    const sourcePosition = node.position ?? { x: 0, y: 0 };
    const nextPosition = position ?? { x: sourcePosition.x + 40, y: sourcePosition.y + 40 };

    const clonedNode: GISNode = {
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
      // Only auto-select genuinely new layers; updates (style bumps, re-materialization)
      // must not hijack whatever the user currently has selected.
      selectedLayerId: previous ? state.selectedLayerId : nextLayer.id,
      selectedNodeId: previous ? state.selectedNodeId : nextLayer.sourceNodeId ?? state.selectedNodeId,
    };
  }),

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
      visualAnalytics: {
        layers: removeRecordKeys(state.visualAnalytics.layers, keysToRemove),
        charts: state.visualAnalytics.charts.filter((chart) => !keysToRemove.has(chart.layerId)),
      },
      selectedLayerId: state.selectedLayerId === layerId ? null : state.selectedLayerId,
    };
  }),

  toggleMapLayerVisibility: (layerId) => set((state) => ({
    mapLayers: state.mapLayers.map((layer) =>
      layer.id === layerId ? { ...layer, visible: !layer.visible } : layer
    ),
  })),

  updateMapLayer: (layerId, patch) => set((state) => ({
    mapLayers: state.mapLayers.map((layer) =>
      layer.id === layerId ? { ...layer, ...patch, styleVersion: layer.styleVersion + 1 } : layer
    ),
  })),

  updateLayerVisualisation: (layerId, visualisation, legend) => set((state) => ({
    mapLayers: state.mapLayers.map((layer) => {
      if (layer.id !== layerId) return layer;
      if (sameJson(layer.visualisation, visualisation) && sameJson(layer.legend, legend)) return layer;
      return { ...layer, visualisation, legend, styleVersion: layer.styleVersion + 1 };
    }),
  })),

  clearLayerVisualisation: (layerId) => set((state) => ({
    mapLayers: state.mapLayers.map((layer) => {
      if (layer.id !== layerId) return layer;
      if (!layer.visualisation && !layer.legend) return layer;
      const { visualisation, legend, ...rest } = layer;
      return { ...rest, styleVersion: layer.styleVersion + 1 };
    }),
  })),

  reorderMapLayer: (layerId, targetIndex) => set((state) => {
    const sourceIndex = state.mapLayers.findIndex((layer) => layer.id === layerId);
    if (sourceIndex < 0) return {};
    const nextLayers = [...state.mapLayers];
    const [layer] = nextLayers.splice(sourceIndex, 1);
    nextLayers.splice(Math.max(0, Math.min(targetIndex, nextLayers.length)), 0, layer);
    return { mapLayers: nextLayers };
  }),

  setHoveredFeature: (layerId, featureId) => set((state) => {
    const current = state.visualAnalytics.layers[layerId] || { selectedFeatureIds: [], filters: [] };
    return {
      visualAnalytics: {
        ...state.visualAnalytics,
        layers: {
          ...state.visualAnalytics.layers,
          [layerId]: {
            ...current,
            hoveredFeatureId: featureId || undefined,
          },
        },
      },
    };
  }),

  setHighlightedFeatures: (layerId, featureIds) => set((state) => {
    const current = state.visualAnalytics.layers[layerId] || { selectedFeatureIds: [], filters: [] };
    return {
      visualAnalytics: {
        ...state.visualAnalytics,
        layers: {
          ...state.visualAnalytics.layers,
          [layerId]: {
            ...current,
            highlightedFeatureIds: featureIds,
          },
        },
      },
    };
  }),

  toggleSelectedFeature: (layerId, featureId) => set((state) => {
    const current = state.visualAnalytics.layers[layerId] || { selectedFeatureIds: [], filters: [] };
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
        layers: {
          ...state.visualAnalytics.layers,
          [layerId]: {
            ...current,
            selectedFeatureIds: [...selected],
          },
        },
      },
    };
  }),

  setFeatureSelection: (layerId, featureIds) => set((state) => {
    const current = state.visualAnalytics.layers[layerId] || { selectedFeatureIds: [], filters: [] };
    const selectedFeatureIds = [...new Set(featureIds.map(String).filter(Boolean))];
    return {
      visualAnalytics: {
        ...state.visualAnalytics,
        layers: {
          ...state.visualAnalytics.layers,
          [layerId]: {
            ...current,
            selectedFeatureIds,
          },
        },
      },
    };
  }),

  clearFeatureSelection: (layerId) => set((state) => {
    const current = state.visualAnalytics.layers[layerId] || { selectedFeatureIds: [], filters: [] };
    return {
      visualAnalytics: {
        ...state.visualAnalytics,
        layers: {
          ...state.visualAnalytics.layers,
          [layerId]: {
            ...current,
            selectedFeatureIds: [],
          },
        },
      },
    };
  }),

  setLayerFilters: (layerId, filters) => set((state) => {
    const current = state.visualAnalytics.layers[layerId] || { selectedFeatureIds: [], filters: [] };
    return {
      visualAnalytics: {
        ...state.visualAnalytics,
        layers: {
          ...state.visualAnalytics.layers,
          [layerId]: {
            ...current,
            filters,
          },
        },
      },
    };
  }),

  clearLayerFilters: (layerId) => set((state) => {
    const current = state.visualAnalytics.layers[layerId] || { selectedFeatureIds: [], filters: [] };
    return {
      visualAnalytics: {
        ...state.visualAnalytics,
        layers: {
          ...state.visualAnalytics.layers,
          [layerId]: {
            ...current,
            filters: [],
          },
        },
      },
    };
  }),

  addChart: (chart) => set((state) => ({
    visualAnalytics: {
      ...state.visualAnalytics,
      charts: [...state.visualAnalytics.charts, chart],
    },
  })),

  updateChart: (chartId, patch) => set((state) => ({
    visualAnalytics: {
      ...state.visualAnalytics,
      charts: state.visualAnalytics.charts.map((chart) =>
        chart.id === chartId ? { ...chart, ...patch } : chart
      ),
    },
  })),

  removeChart: (chartId) => set((state) => ({
    visualAnalytics: {
      ...state.visualAnalytics,
      charts: state.visualAnalytics.charts.filter((chart) => chart.id !== chartId),
    },
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
  name: 'ymnngis-settings',
  version: 1,
  // Only user settings persist; workflow/layer state is ephemeral by design.
  partialize: (state) => ({ settings: state.settings }) as AppState,
  storage: createJSONStorage(() => (typeof window === 'undefined' ? noopStorage : window.localStorage)),
}));

if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  // Debug handle for dev tools and E2E runs.
  (window as unknown as Record<string, unknown>).__ymnStore = useStore;
}
