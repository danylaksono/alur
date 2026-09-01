import type { Edge } from '@xyflow/react';
import type { WorkflowNode } from '../store/useStore';
import type { BasemapId } from '../utils/basemaps';
import type { LayerVisualisation, LegendSpec } from './visualisation';
import type { VisualAnalyticsState } from './visualAnalytics';
import type { DatasetDescriptor } from './datasets';
import type { ProvenanceEvent } from './provenance';
import type { WorkflowFragment } from '../utils/workflowFragments';

export const PROJECT_MANIFEST_VERSION = 3 as const;

export type ProjectSourceDescriptor = {
  nodeId: string;
  name: string;
  tableName?: string;
  format?: string;
  sourceKind?: 'file' | 'url' | 'clipboard' | 'remote';
  size?: number;
  lastModified?: number;
  /**
   * Present only for `remote` sources. A remote source is the one kind that
   * survives a project round trip on its own: the bytes were never ours to
   * keep, so the address is the whole of what needs saving.
   */
  url?: string;
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
    /** Optional so projects written before saved operations existed still validate. */
    fragments?: WorkflowFragment[];
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
  version: 2;
  /** Optional so v2 files written before naming existed still validate. */
  name?: string;
  /**
   * The account of what was done, versioned independently of this manifest so
   * the log can evolve without forcing a project migration. Optional so v2
   * files written before the log existed still validate; they load with an
   * empty account rather than a fabricated one.
   */
  provenanceEvents?: ProvenanceEvent[];
  workspace: Omit<ProjectManifestV1['workspace'], 'activeRailTab' | 'workspaceMode'> & {
    activeRailTab: 'layers' | 'charts' | 'chat' | 'cohorts' | 'score' | 'scenarios' | 'nodes' | 'operations';
    workspaceMode: 'explore' | 'compare' | 'explain' | 'board';
    /** Optional so v2 files written before layouts existed still validate. */
    isRailExpanded?: boolean;
    drawerWidth?: number;
    panelWidth?: number;
    dockSide?: 'bottom' | 'top' | 'left' | 'right';
    layoutPreset?: 'map-focus' | 'side-by-side' | 'workflow' | 'map-below' | 'custom';
  };
};

/**
 * v3 adds the session tier. Nothing was removed, so the only migration work is
 * giving a v2 project's loose variants a line of enquiry to belong to —
 * `visualAnalytics.sessions` and `activeSessionId` carry through the shared
 * `VisualAnalyticsState`.
 */
export type ProjectManifestV3 = Omit<ProjectManifestV2, 'version'> & {
  version: typeof PROJECT_MANIFEST_VERSION;
};

export type ProjectManifest = ProjectManifestV3;
