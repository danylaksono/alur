import type { Edge } from '@xyflow/react';
import type { WorkflowNode } from '../store/useStore';
import type { BasemapId } from '../utils/basemaps';
import type { LayerVisualisation, LegendSpec } from './visualisation';
import type { VisualAnalyticsState } from './visualAnalytics';
import type { DatasetDescriptor } from './datasets';

export const PROJECT_MANIFEST_VERSION = 2 as const;

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
  version: 1;
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

export type ProjectManifestV2 = Omit<ProjectManifestV1, 'version' | 'workspace'> & {
  version: typeof PROJECT_MANIFEST_VERSION;
  /** Optional so v2 files written before naming existed still validate. */
  name?: string;
  workspace: Omit<ProjectManifestV1['workspace'], 'activeRailTab' | 'workspaceMode'> & {
    activeRailTab: 'layers' | 'charts' | 'chat' | 'cohorts' | 'nodes';
    workspaceMode: 'explore' | 'compare' | 'explain' | 'board';
    /** Optional so v2 files written before layouts existed still validate. */
    isRailExpanded?: boolean;
    drawerWidth?: number;
    panelWidth?: number;
    dockSide?: 'bottom' | 'top' | 'left' | 'right';
    layoutPreset?: 'map-focus' | 'side-by-side' | 'workflow' | 'map-below' | 'custom';
  };
};

export type ProjectManifest = ProjectManifestV2;
