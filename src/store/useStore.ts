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

export type MapLayer = {
  id: string;
  name: string;
  geojson: GeoJSON.FeatureCollection;
  visible?: boolean;
};

export type GISNode = Node & {
  data: {
    label: string;
    type: 'input' | 'analysis' | 'attribute' | 'output';
    config: any;
  }
};

interface AppState {
  nodes: GISNode[];
  edges: Edge[];
  duckdbReady: boolean;
  mapLayers: MapLayer[];
  chatMessages: { role: 'user' | 'assistant' | 'system', content: string }[];
  
  setDuckDBReady: (ready: boolean) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (node: GISNode) => void;
  updateNode: (id: string, config: any) => void;
  removeNode: (id: string) => void;
  duplicateNode: (id: string, newId?: string, position?: { x: number; y: number }) => void;
  addMapLayer: (layer: MapLayer) => void;
  removeMapLayer: (layerId: string) => void;
  addChatMessage: (role: 'user' | 'assistant' | 'system', content: string) => void;
}

export const useStore = create<AppState>((set, get) => ({
  nodes: [],
  edges: [],
  duckdbReady: false,
  mapLayers: [],
  chatMessages: [
    { role: 'assistant', content: "Welcome to GeoModeler Pro. I can help you build spatial workflows. Try asking to 'Load NYC Taxis' or 'Create a 500m buffer around the input'." }
  ],

  setDuckDBReady: (ready) => set({ duckdbReady: ready }),
  
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
      edges: addEdge(connection, get().edges),
    });
  },

  addNode: (node) => set((state) => ({ nodes: [...state.nodes, node] })),
  
  updateNode: (id, config) => set((state) => ({
    nodes: state.nodes.map((node) => 
      node.id === id ? { ...node, data: { ...node.data, config } } : node
    )
  })),

  removeNode: (id) => set((state) => ({
    nodes: state.nodes.filter((node) => node.id !== id),
    edges: state.edges.filter((edge) => edge.source !== id && edge.target !== id),
  })),

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

  addChatMessage: (role, content) => set((state) => ({
    chatMessages: [...state.chatMessages, { role, content }]
  })),
}));
