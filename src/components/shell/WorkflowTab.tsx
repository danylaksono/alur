import { useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Panel,
  MiniMap,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useStore } from "../../store/useStore";
import { wouldCreateCycle } from "../../utils/workflowGraph";
import { InputNode } from "../Flow/InputNode";
import { GeometryNode } from "../Flow/GeometryNode";
import { AnalysisNode } from "../Flow/AnalysisNode";
import { AttributeNode } from "../Flow/AttributeNode";
import { AggregateNode } from "../Flow/AggregateNode";
import { AllocateNode } from "../Flow/AllocateNode";
import { ScoreNode } from "../Flow/ScoreNode";
import { FragmentNode } from "../Flow/FragmentNode";
import { SaveFragmentDialog } from "../Flow/SaveFragmentDialog";
import { FilterNode } from "../Flow/FilterNode";
import { JoinNode } from "../Flow/JoinNode";
import { OutputNode } from "../Flow/OutputNode";
import { VisualisationNode } from "../Flow/VisualisationNode";
import { H3Node } from "../Flow/H3Node";
import { CalculationNode } from "../Flow/CalculationNode";
import { GroupNode } from "../Flow/GroupNode";
import { Package } from "lucide-react";
import { ErrorBoundary } from "../ErrorBoundary";

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
  h3: H3Node,
  calculation: CalculationNode,
  group: GroupNode,
};

/**
 * Minimap swatch per node, matching the tone bar on the card so the overview
 * reads as the same graph. A step that is unfinished or bypassed goes grey
 * there exactly as it does here.
 */
const MINIMAP_TONES: Record<string, string> = {
  input: '#60a5fa',
  geometry: '#60a5fa',
  calculation: '#22d3ee',
  analysis: '#c084fc',
  h3: '#c084fc',
  attribute: '#34d399',
  aggregate: '#34d399',
  allocate: '#34d399',
  score: '#a78bfa',
  filter: '#fb923c',
  join: '#fbbf24',
  fragment: '#a78bfa',
  visualisation: '#22d3ee',
  output: '#94a3b8',
  // Faint: in the overview a box is the ground the steps sit on, not a step.
  group: '#e9eef4',
};

const miniMapNodeColor = (node: { id: string; data?: unknown }) => {
  const state = useStore.getState();
  const workflowNode = state.nodes.find((item) => item.id === node.id);
  if (!workflowNode) return '#cbd5e1';
  if (workflowNode.data.disabled) return '#cbd5e1';
  if (state.workflowIssue?.nodeId === node.id) return '#fbbf24';
  if (state.workflowReadiness[node.id]?.ready === false) return '#cbd5e1';
  return MINIMAP_TONES[workflowNode.data.type] ?? '#94a3b8';
};

/** Honours fit requests from the node palette, which lives outside this provider. */
const FitRequestListener = () => {
  const fitRequest = useStore((s) => s.workflowFitRequest);
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (!fitRequest) return;
    const timer = window.setTimeout(
      () => fitView({ duration: 300, padding: 0.2, maxZoom: 1 }),
      50,
    );
    return () => window.clearTimeout(timer);
  }, [fitRequest, fitView]);
  return null;
};

/**
 * Re-fit when the canvas changes size.
 *
 * Maximising the drawer used to hand you three times the room with the graph
 * still parked wherever it was — often off the right-hand edge, which is where
 * a node carrying an error tends to be. The surface only grows or shrinks when
 * the user asks it to, so re-framing the graph is what they were asking for.
 */
const RefitOnResize = () => {
  const dockSide = useStore((s) => s.ui.dockSide);
  const drawerMode = useStore((s) => s.ui.drawerMode);
  const { fitView } = useReactFlow();
  const isFirstRun = useRef(true);

  useEffect(() => {
    // The mount fit is React Flow's own; re-running it here would fight it.
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    // After the drawer's own size transition, or the fit measures the old box.
    const timer = window.setTimeout(
      () => fitView({ duration: 240, padding: 0.2, maxZoom: 1 }),
      260,
    );
    return () => window.clearTimeout(timer);
  }, [dockSide, drawerMode, fitView]);

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
  const setNodePositions = useStore((s) => s.setNodePositions);
  const [savingFragment, setSavingFragment] = useState<string[] | null>(null);

  // Captured when a group's drag starts: which nodes were sitting on it, and
  // where. A group owns nothing in the graph, so carrying its contents along is
  // done here in canvas coordinates rather than by React Flow parenting — which
  // would rewrite every child's position as relative and change what a saved
  // project means.
  const groupDrag = useRef<{
    origin: { x: number; y: number };
    members: Array<{ id: string; x: number; y: number }>;
  } | null>(null);

  const handleNodeDragStart = (_: unknown, node: { id: string; type?: string; position: { x: number; y: number }; measured?: { width?: number; height?: number }; width?: number; height?: number; style?: { width?: number | string; height?: number | string } }) => {
    if (node.type !== 'group') return;
    // Measured first, so a box resized by hand carries what it now covers
    // rather than what it covered when it was created. Bail on a zero-sized
    // rectangle: it contains nothing, and the box would travel alone.
    const width = node.measured?.width ?? node.width ?? 0;
    const height = node.measured?.height ?? node.height ?? 0;
    if (!width || !height) return;
    const inside = (candidate: (typeof nodes)[number]) => {
      if (candidate.id === node.id || candidate.data.type === 'group') return false;
      const cx = candidate.position.x + (candidate.measured?.width ?? 120) / 2;
      const cy = candidate.position.y + (candidate.measured?.height ?? 40) / 2;
      return (
        cx >= node.position.x &&
        cx <= node.position.x + width &&
        cy >= node.position.y &&
        cy <= node.position.y + height
      );
    };
    groupDrag.current = {
      origin: { x: node.position.x, y: node.position.y },
      members: nodes.filter(inside).map((item) => ({ id: item.id, x: item.position.x, y: item.position.y })),
    };
  };

  const handleNodeDrag = (_: unknown, node: { id: string; type?: string; position: { x: number; y: number } }) => {
    const drag = groupDrag.current;
    if (node.type !== 'group' || !drag) return;
    const dx = node.position.x - drag.origin.x;
    const dy = node.position.y - drag.origin.y;
    setNodePositions(drag.members.map((member) => ({ id: member.id, position: { x: member.x + dx, y: member.y + dy } })));
  };

  // A saved operation has to be a run of steps, so the offer only appears once
  // there is more than one thing selected — and never for a data source, which
  // would bake one file into a supposedly reusable operation.
  const selectedIds = nodes
    .filter((node) => node.selected && node.data.type !== "input" && node.data.type !== "group")
    .map((node) => node.id);

  return (
    <ReactFlowProvider>
      <div className="h-full min-h-0">
        <ErrorBoundary
          name="Workflow"
          fallback={
            <div className="flex h-full items-center justify-center bg-slate-100 text-xs italic text-slate-500">
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
            // React Flow greys out invalid targets while dragging, so a loop is
            // refused under the cursor rather than accepted and reported later.
            isValidConnection={(connection) =>
              Boolean(connection.source) &&
              Boolean(connection.target) &&
              !wouldCreateCycle(edges, connection.source!, connection.target!)
            }
            onNodeDragStart={handleNodeDragStart}
            onNodeDrag={handleNodeDrag}
            onNodeDragStop={() => {
              groupDrag.current = null;
            }}
            onNodeClick={(_, node) => {
              // A box is not a step; selecting one must not aim the table at it.
              if (node.type === "group") return;
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
            <Background
              id="workflow-grid-lines"
              variant={BackgroundVariant.Lines}
              gap={GRID_SPACING * 5}
              lineWidth={1}
              color="#e2e8f0"
            />
            <Background
              id="workflow-grid-dots"
              variant={BackgroundVariant.Dots}
              gap={GRID_SPACING}
              size={1.4}
              color="#cbd5e1"
            />
            <Controls />
            {/* Only earns its corner once the graph outgrows the viewport —
                below that it is a picture of what you can already see. The
                node colours match the cards, including the grey an unfinished
                or bypassed step wears, so the overview carries state too. */}
            {nodes.length > 3 && (
              <MiniMap
                pannable
                zoomable
                ariaLabel="Workflow overview"
                nodeColor={miniMapNodeColor}
                nodeStrokeWidth={2}
                maskColor="rgba(148, 163, 184, 0.18)"
                // Kept small: the drawer's default height is ~280px, and an
                // overview that eats a third of it is competing with the thing
                // it is an overview of.
                className="!bottom-2 !right-2 !h-20 !w-36 !rounded-lg !border !border-slate-200 !bg-white/90 !shadow-md"
              />
            )}
            <FitRequestListener />
            <RefitOnResize />
            {selectedIds.length > 1 && (
              <Panel position="top-center">
                <button
                  type="button"
                  onClick={() => setSavingFragment(selectedIds)}
                  className="pressable flex items-center gap-1.5 rounded-lg border border-cyan-200 bg-white px-3 py-1.5 text-[11px] font-bold text-cyan-700 shadow-md transition-colors hover:bg-cyan-50"
                >
                  <Package className="h-3.5 w-3.5" />
                  Save {selectedIds.length} steps as an operation
                </button>
              </Panel>
            )}
          </ReactFlow>
        </ErrorBoundary>
      </div>
      {savingFragment && (
        <SaveFragmentDialog
          selectedIds={savingFragment}
          onClose={() => setSavingFragment(null)}
        />
      )}
    </ReactFlowProvider>
  );
};
