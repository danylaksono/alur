import { ReactFlow, Controls, Background } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useStore } from '../../store/useStore';
import { InputNode } from '../Flow/InputNode';
import { AnalysisNode } from '../Flow/AnalysisNode';
import { AttributeNode } from '../Flow/AttributeNode';
import { AggregateNode } from '../Flow/AggregateNode';
import { FilterNode } from '../Flow/FilterNode';
import { OutputNode } from '../Flow/OutputNode';
import { VisualisationNode } from '../Flow/VisualisationNode';
import { ErrorBoundary } from '../ErrorBoundary';
import { NodePalette } from './NodePalette';

const nodeTypes = {
  input: InputNode,
  analysis: AnalysisNode,
  attribute: AttributeNode,
  aggregate: AggregateNode,
  filter: FilterNode,
  visualisation: VisualisationNode,
  output: OutputNode,
};

export const WorkflowTab = () => {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const onNodesChange = useStore((s) => s.onNodesChange);
  const onEdgesChange = useStore((s) => s.onEdgesChange);
  const onConnect = useStore((s) => s.onConnect);
  const setSelectedNodeId = useStore((s) => s.setSelectedNodeId);
  const setSelectedLayerId = useStore((s) => s.setSelectedLayerId);

  return (
    <div className="flex h-full min-h-0">
      <NodePalette />
      <div className="min-w-0 flex-1">
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
            className="h-full bg-background"
          >
            <Background gap={24} size={1} />
            <Controls />
          </ReactFlow>
        </ErrorBoundary>
      </div>
    </div>
  );
};
