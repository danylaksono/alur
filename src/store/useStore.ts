import { create } from 'zustand';
import {
  Connection,
  Edge,
  EdgeChange,
  Node,
  NodeChange,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges
} from '@xyflow/react';
import { DEFAULT_BASEMAP_ID, type BasemapId } from '../utils/basemaps';
import type { LayerVisualisation, LegendSpec } from '../types/visualisation';
import { ensureFeatureIds } from '../utils/featureIdentity';
import type { VisualAnalyticsState, VisualFilter } from '../types/visualAnalytics';

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
  geojson: GeoJSON.FeatureCollection;
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
};

export type GISNode = Node & {
  data: {
    label: string;
    type: 'input' | 'analysis' | 'attribute' | 'aggregate' | 'filter' | 'visualisation' | 'output';
    config: any;
  }
};

export type Toast = {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
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
  layerFocusRequest: { layerId: string; requestedAt: number } | null;
  nodeSchemas: Record<string, any[]>;
  nodeExecutionStates: Record<string, NodeExecutionState>;
  visualAnalytics: VisualAnalyticsState;
  toasts: Toast[];

  setDuckDBReady: (ready: boolean) => void;
  setSelectedBasemapId: (id: BasemapId) => void;
  setManualSQL: (sql: string) => void;
  setIsManualSQL: (isManual: boolean) => void;
  setSelectedNodeId: (id: string | null) => void;
  setSelectedLayerId: (id: string | null) => void;
  selectLayer: (layerId: string | null) => void;
  focusLayer: (layerId: string) => void;
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
  updateMapLayer: (layerId: string, patch: Partial<Pick<MapLayer, 'visible' | 'opacity' | 'color' | 'name' | 'clusterRadius' | 'clusterMaxZoom' | 'dotDensityLayerId'>>) => void;
  updateLayerVisualisation: (layerId: string, visualisation: LayerVisualisation, legend?: LegendSpec) => void;
  clearLayerVisualisation: (layerId: string) => void;
  reorderMapLayer: (layerId: string, targetIndex: number) => void;
  setHoveredFeature: (layerId: string, featureId: string | null) => void;
  toggleSelectedFeature: (layerId: string, featureId: string) => void;
  clearFeatureSelection: (layerId: string) => void;
  setLayerFilters: (layerId: string, filters: VisualFilter[]) => void;
  clearLayerFilters: (layerId: string) => void;
  addChatMessage: (role: 'user' | 'assistant' | 'system', content: string, data?: { kind?: string; toolName?: string; summary?: string; icon?: string }) => void;
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

export type NewMapLayer = Omit<MapLayer, 'visible' | 'opacity' | 'createdAt' | 'featureCount' | 'styleVersion'> &
  Partial<Pick<MapLayer, 'visible' | 'opacity' | 'createdAt' | 'featureCount' | 'styleVersion'>>;

if (typeof window !== 'undefined') {
  window.localStorage.removeItem('ymnngis-workflow');
}

const removeRecordKeys = <T>(record: Record<string, T>, ids: Set<string>) =>
  Object.fromEntries(Object.entries(record).filter(([id]) => !ids.has(id)));

const hydrateLayer = (layer: NewMapLayer, previous?: MapLayer): MapLayer => ({
  ...previous,
  ...layer,
  visible: layer.visible ?? previous?.visible ?? true,
  opacity: layer.opacity ?? previous?.opacity ?? 0.8,
  createdAt: layer.createdAt ?? previous?.createdAt ?? Date.now(),
  featureCount: layer.featureCount ?? layer.geojson.features.length,
  geojson: ensureFeatureIds(layer.geojson, layer.id),
  visualisation: layer.visualisation ?? previous?.visualisation,
  legend: layer.legend ?? previous?.legend,
  styleVersion: layer.styleVersion ?? previous?.styleVersion ?? 1,
});

export const useStore = create<AppState>()((set, get) => ({
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
  visualAnalytics: { layers: {} },
  toasts: [],

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
    visualAnalytics: { layers: {} },
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
      edges: addEdge({ ...connection, type: 'smoothstep' }, get().edges),
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
    const visualAnalyticsLayers = removeRecordKeys(state.visualAnalytics.layers, new Set(
      state.mapLayers
        .filter((layer) => layer.sourceNodeId === id || (tableName && layer.id === tableName))
        .map((layer) => layer.id)
    ));

    return {
      nodes: state.nodes.filter((n) => n.id !== id),
      edges: state.edges.filter((edge) => edge.source !== id && edge.target !== id),
      mapLayers,
      visualAnalytics: { layers: visualAnalyticsLayers },
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
      selectedLayerId: nextLayer.id,
      selectedNodeId: nextLayer.sourceNodeId ?? state.selectedNodeId,
    };
  }),

  removeMapLayer: (layerId) => set((state) => {
    const layer = state.mapLayers.find((item) => item.id === layerId);
    const dotDensityLayerId = layer?.dotDensityLayerId;
    const keysToRemove = new Set([layerId]);
    if (dotDensityLayerId) keysToRemove.add(dotDensityLayerId);
    return {
      mapLayers: state.mapLayers
        .filter((item) => item.id !== layerId)
        .filter((item) => item.id !== dotDensityLayerId)
        .map((item) => item.dotDensityLayerId === layerId
          ? { ...item, dotDensityLayerId: undefined, visualisation: undefined, legend: undefined }
          : item),
      visualAnalytics: { layers: removeRecordKeys(state.visualAnalytics.layers, keysToRemove) },
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
    mapLayers: state.mapLayers.map((layer) =>
      layer.id === layerId
        ? { ...layer, visualisation, legend, styleVersion: layer.styleVersion + 1 }
        : layer
    ),
  })),

  clearLayerVisualisation: (layerId) => set((state) => ({
    mapLayers: state.mapLayers.map((layer) => {
      if (layer.id !== layerId) return layer;
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

  clearFeatureSelection: (layerId) => set((state) => {
    const current = state.visualAnalytics.layers[layerId] || { selectedFeatureIds: [], filters: [] };
    return {
      visualAnalytics: {
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

  addChatMessage: (role, content, data) => set((state) => ({
    chatMessages: [...state.chatMessages, { role, content, kind: data?.kind as any, data }]
  })),

  addToast: (toast) => set((state) => ({
    toasts: [...state.toasts, { ...toast, id: `toast-${Date.now()}` }]
  })),

  removeToast: (id) => set((state) => ({
    toasts: state.toasts.filter((t) => t.id !== id)
  })),
}));
