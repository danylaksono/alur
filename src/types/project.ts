import type { Edge } from '@xyflow/react';
import type { WorkflowNode } from '../store/useStore';
import type { BasemapId } from '../utils/basemaps';
import type { LayerVisualisation, LegendSpec } from './visualisation';
import type { VisualAnalyticsState } from './visualAnalytics';
import type { DatasetDescriptor } from './datasets';

export const PROJECT_MANIFEST_VERSION = 1 as const;

export type ProjectSourceDescriptor = {
  nodeId: string;
  name: string;
  tableName?: string;
  format?: string;
  sourceKind?: 'file' | 'url' | 'clipboard';
  size?: number;
  lastModified?: number;
};

export type ProjectLayerPresentation = {
  id: string;
  name: string;
  sourceNodeId?: string;
  sourceKind?: 'input' | 'workflow' | 'step' | 'output' | 'manual' | 'llm' | 'h3';
  visible: boolean;
  opacity: number;
  color?: string;
  visualisation?: LayerVisualisation;
  legend?: LegendSpec;
  clusterRadius?: number;
  clusterMaxZoom?: number;
  dotDensityLayerId?: string;
  hexbinLayerId?: string;
};

export type ProjectManifestV1 = {
  kind: 'alur-project';
  version: typeof PROJECT_MANIFEST_VERSION;
  appVersion: string;
  exportedAt: string;
  workflow: {
    nodes: WorkflowNode[];
    edges: Edge[];
  };
  sources: ProjectSourceDescriptor[];
  datasets: DatasetDescriptor[];
  layers: ProjectLayerPresentation[];
  visualAnalytics: VisualAnalyticsState;
  workspace: {
    selectedBasemapId: BasemapId;
    selectedNodeId: string | null;
    selectedLayerId: string | null;
    activeRailTab: 'layers' | 'charts' | 'cohorts' | 'chat';
    activeDrawerTab: 'workflow' | 'table' | 'sql';
    drawerMode: 'collapsed' | 'open' | 'maximized';
    drawerHeight: number;
    isPanelCollapsed: boolean;
    workspaceMode?: 'explore' | 'board';
    mapCamera: { longitude: number; latitude: number; zoom: number; bearing: number; pitch: number };
    manualSQL: string;
    isManualSQL: boolean;
  };
  savedTableViews: Record<string, unknown[]>;
};
