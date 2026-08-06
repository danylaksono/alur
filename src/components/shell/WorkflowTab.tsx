import { useEffect, useState } from 'react';
import { ReactFlow, ReactFlowProvider, Controls, Background, BackgroundVariant, ConnectionLineType, Panel, useReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useStore } from '../../store/useStore';
import { InputNode } from '../Flow/InputNode';
import { GeometryNode } from '../Flow/GeometryNode';
import { AnalysisNode } from '../Flow/AnalysisNode';
import { AttributeNode } from '../Flow/AttributeNode';
import { AggregateNode } from '../Flow/AggregateNode';
import { AllocateNode } from '../Flow/AllocateNode';
import { ScoreNode } from '../Flow/ScoreNode';
import { FragmentNode } from '../Flow/FragmentNode';
import { SaveFragmentDialog } from '../Flow/SaveFragmentDialog';
import { FilterNode } from '../Flow/FilterNode';
import { JoinNode } from '../Flow/JoinNode';
import { OutputNode } from '../Flow/OutputNode';
import { VisualisationNode } from '../Flow/VisualisationNode';
import { Package } from 'lucide-react';
import { ErrorBoundary } from '../ErrorBoundary';

/** One grid step. Drives both the visible dots and node snapping. */
const GRID_SPACING = 24;

const nodeTypes = {
  input: InputNode,
  geometry: GeometryNode,
  analysis: AnalysisNode,
  attribute: AttributeNode,
  aggregate: AggregateNode,
  allocate: AllocateNode,
  score: ScoreNode,
  filter: FilterNode,
  join: JoinNode,
  visualisation: VisualisationNode,
  output: OutputNode,
  fragment: FragmentNode,
};

/** Honours fit requests from the node palette, which lives outside this provider. */
const FitRequestListener = () => {
  const fitRequest = useStore((s) => s.workflowFitRequest);
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (!fitRequest) return;
    const timer = window.setTimeout(() => fitView({ duration: 300, padding: 0.2, maxZoom: 1 }), 50);
    return () => window.clearTimeout(timer);
  }, [fitRequest, fitView]);
  return null;
};

export const WorkflowTab = () => {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const onNodesChange = useStore((s) => s.onNodesChange);
  const onEdgesChange = useStore((s) => s.onEdgesChange);
  const onConnect = useStore((s) => s.onConnect);
  const setSelectedNodeId = useStore((s) => s.setSelectedNodeId);
  const setSelectedLayerId = useStore((s) => s.setSelectedLayerId);
  const [savingFragment, setSavingFragment] = useState<string[] | null>(null);

  // A saved operation has to be a run of steps, so the offer only appears once
  // there is more than one thing selected — and never for a data source, which
  // would bake one file into a supposedly reusable operation.
  const selectedIds = nodes.filter((node) => node.selected && node.data.type !== 'input').map((node) => node.id);

  return (
    <ReactFlowProvider>
      <div className="h-full min-h-0">
        <ErrorBoundary
          name="Workflow"
          fallback={
            <div className="flex h-full items-center justify-center bg-slate-100 text-xs italic text-slate-400">
              Workflow editor error
            </div>
          }
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => {
              setSelectedNodeId(node.id);
              setSelectedLayerId(null);
            }}
            onPaneClick={() => {
              setSelectedNodeId(null);
              setSelectedLayerId(null);
            }}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ maxZoom: 1, padding: 0.25 }}
            minZoom={0.25}
            connectionLineType={ConnectionLineType.SmoothStep}
            connectionRadius={36}
            snapToGrid
            // Matches the dot spacing below, so nodes land on the dots the user sees.
            snapGrid={[GRID_SPACING, GRID_SPACING]}
            // Deletion is owned by useKeyboardShortcuts (scoped to drawer visibility);
            // React Flow's global delete key would fire even when the canvas is hidden.
            deleteKeyCode={null}
            className="h-full bg-background"
          >
            <Background id="workflow-grid-lines" variant={BackgroundVariant.Lines} gap={GRID_SPACING * 5} lineWidth={1} color="#e2e8f0" />
            <Background id="workflow-grid-dots" variant={BackgroundVariant.Dots} gap={GRID_SPACING} size={1.4} color="#cbd5e1" />
            <Controls />
            <FitRequestListener />
            {selectedIds.length > 1 && (
              <Panel position="top-center">
                <button
                  type="button"
                  onClick={() => setSavingFragment(selectedIds)}
                  className="flex items-center gap-1.5 rounded-lg border border-cyan-200 bg-white px-3 py-1.5 text-[11px] font-bold text-cyan-700 shadow-md transition-colors hover:bg-cyan-50"
                >
                  <Package className="h-3.5 w-3.5" />
                  Save {selectedIds.length} steps as an operation
                </button>
              </Panel>
            )}
          </ReactFlow>
        </ErrorBoundary>
      </div>
      {savingFragment && <SaveFragmentDialog selectedIds={savingFragment} onClose={() => setSavingFragment(null)} />}
    </ReactFlowProvider>
  );
};
