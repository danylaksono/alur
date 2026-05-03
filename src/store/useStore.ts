import { create } from 'zustand';
import { persist } from 'zustand/middleware';
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

export type NodeExecutionState = {
  status: 'idle' | 'running' | 'done' | 'error';
  error?: string;
  featureCount?: number;
};

export type MapLayer = {
  id: string;
  name: string;
  geojson: GeoJSON.FeatureCollection;
  visible?: boolean;
  sourceNodeId?: string;
  color?: string;
};

export type GISNode = Node & {
  data: {
    label: string;
    type: 'input' | 'analysis' | 'attribute' | 'aggregate' | 'filter' | 'output';
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
  mapLayers: MapLayer[];
  chatMessages: ChatMessage[];
  manualSQL: string;
  isManualSQL: boolean;
  selectedNodeId: string | null;
  nodeSchemas: Record<string, any[]>;
  nodeExecutionStates: Record<string, NodeExecutionState>;
  toasts: Toast[];

  setDuckDBReady: (ready: boolean) => void;
  setManualSQL: (sql: string) => void;
  setIsManualSQL: (isManual: boolean) => void;
  setSelectedNodeId: (id: string | null) => void;
  setNodeSchema: (id: string, schema: any[]) => void;
  setNodeExecutionState: (id: string, state: NodeExecutionState) => void;
  resetNodeExecutionStates: () => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (node: GISNode) => void;
  updateNode: (id: string, config: any) => void;
  removeNode: (id: string) => void;
  duplicateNode: (id: string, newId?: string, position?: { x: number; y: number }) => void;
  addMapLayer: (layer: MapLayer) => void;
  removeMapLayer: (layerId: string) => void;
  addChatMessage: (role: 'user' | 'assistant' | 'system', content: string, data?: { kind?: string; toolName?: string; summary?: string; icon?: string }) => void;
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
  nodes: [],
  edges: [],
  duckdbReady: false,
  mapLayers: [],
  chatMessages: [
    { role: 'assistant', content: "I can help you build spatial workflows. Try asking 'Create a 500m buffer around the input'." }
  ],
  manualSQL: '',
  isManualSQL: false,
  selectedNodeId: null,
  nodeSchemas: {},
  nodeExecutionStates: {},
  toasts: [],

  setDuckDBReady: (ready) => set({ duckdbReady: ready }),
  setManualSQL: (sql) => set({ manualSQL: sql }),
  setIsManualSQL: (isManual) => set({ isManualSQL: isManual }),
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),
  setNodeSchema: (id, schema) => set((state) => ({
    nodeSchemas: { ...state.nodeSchemas, [id]: schema }
  })),

  setNodeExecutionState: (id, execState) => set((state) => ({
    nodeExecutionStates: { ...state.nodeExecutionStates, [id]: execState }
  })),

  resetNodeExecutionStates: () => set({ nodeExecutionStates: {} }),

  onNodesChange: (changes) => {
    set({
      nodes: applyNodeChanges(changes, get().nodes) as GISNode[],
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
    return {
      nodes: state.nodes.filter((n) => n.id !== id),
      edges: state.edges.filter((edge) => edge.source !== id && edge.target !== id),
      // Cascade: remove the associated map layer if this input node had data loaded
      mapLayers: tableName
        ? state.mapLayers.filter((layer) => layer.id !== tableName)
        : state.mapLayers,
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

  addMapLayer: (layer) => set((state) => ({
    mapLayers: [...state.mapLayers.filter((item) => item.id !== layer.id), layer],
  })),

  removeMapLayer: (layerId) => set((state) => ({
    mapLayers: state.mapLayers.filter((item) => item.id !== layerId),
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
}),
    {
      name: 'ymnngis-workflow',
      partialize: (state) => ({
        nodes: state.nodes,
        edges: state.edges,
        chatMessages: state.chatMessages,
      }),
    }
  )
);
