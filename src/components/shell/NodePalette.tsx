import { useState } from 'react';
import { Calculator, Database, Eye, Filter, Gauge, GitMerge, Layers, Loader2, Package, Palette, PenLine, Plus, Search, SlidersHorizontal, Trash2, Workflow, Zap } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { buildWorkflowSQL } from '../../utils/workflowEngine';
import { nextNodePosition } from '../../utils/nodePlacement';
import { spatialFunctions } from '../../utils/spatialFunctions';
import { materializeWorkflowOutput } from '../../services/layerMaterialization';
import { registerWorkflowResult } from '../../services/workflowRun';
import { VariantPanel } from '../Variants/VariantPanel';
import { cn } from '../../utils/cn';

const colorStyles: Record<string, { hoverBg: string; hoverBorder: string; iconBg: string; iconHoverBg: string }> = {
  blue: { hoverBg: 'hover:bg-blue-50', hoverBorder: 'hover:border-blue-200', iconBg: 'bg-blue-50', iconHoverBg: 'group-hover:bg-blue-100' },
  purple: { hoverBg: 'hover:bg-purple-50', hoverBorder: 'hover:border-purple-200', iconBg: 'bg-purple-50', iconHoverBg: 'group-hover:bg-purple-100' },
  slate: { hoverBg: 'hover:bg-slate-50', hoverBorder: 'hover:border-slate-200', iconBg: 'bg-slate-50', iconHoverBg: 'group-hover:bg-slate-100' },
  orange: { hoverBg: 'hover:bg-orange-50', hoverBorder: 'hover:border-orange-200', iconBg: 'bg-orange-50', iconHoverBg: 'group-hover:bg-orange-100' },
  amber: { hoverBg: 'hover:bg-amber-50', hoverBorder: 'hover:border-amber-200', iconBg: 'bg-amber-50', iconHoverBg: 'group-hover:bg-amber-100' },
  emerald: { hoverBg: 'hover:bg-emerald-50', hoverBorder: 'hover:border-emerald-200', iconBg: 'bg-emerald-50', iconHoverBg: 'group-hover:bg-emerald-100' },
  cyan: { hoverBg: 'hover:bg-cyan-50', hoverBorder: 'hover:border-cyan-200', iconBg: 'bg-cyan-50', iconHoverBg: 'group-hover:bg-cyan-100' },
};

type NodeType = 'input' | 'geometry' | 'analysis' | 'attribute' | 'filter' | 'aggregate' | 'allocate' | 'score' | 'join' | 'visualisation' | 'output' | 'fragment';

const nodeCards: Array<{ type: NodeType; icon: typeof Database; title: string; desc: string; color: string; config?: Record<string, unknown> }> = [
  { type: 'input', icon: Database, title: 'Data Input', desc: 'Load Parquet or CSV', color: 'blue' },
  { type: 'geometry', icon: PenLine, title: 'Draw Features', desc: 'Create points, lines or areas', color: 'cyan' },
  { type: 'analysis', icon: Zap, title: 'Spatial Analysis', desc: 'Buffer, intersect, transform…', color: 'purple' },
  { type: 'attribute', icon: Calculator, title: 'Attribute Calc', desc: 'Add computed columns', color: 'slate' },
  { type: 'score', icon: SlidersHorizontal, title: 'Score', desc: 'Weighted score across columns', color: 'purple', config: { resultField: 'alur_score', scoreModel: { criteria: [], missingValueTreatment: 'zero' } } },
  { type: 'filter', icon: Filter, title: 'Filter', desc: 'WHERE conditions or top N', color: 'amber' },
  { type: 'aggregate', icon: Layers, title: 'Summarise', desc: 'Group and total, or dissolve', color: 'orange', config: { mode: 'summary', measures: [{ id: 'measure-rows', fn: 'count' }] } },
  { type: 'allocate', icon: Gauge, title: 'Allocate', desc: 'Spend down a budget or capacity', color: 'amber', config: { mode: 'flag', direction: 'desc' } },
  { type: 'join', icon: GitMerge, title: 'Join', desc: 'Attribute or spatial join', color: 'cyan' },
  { type: 'visualisation', icon: Palette, title: 'Visualisation', desc: 'Attach a reusable map style', color: 'purple', config: { kind: 'choropleth', method: 'quantile', classCount: 5, paletteId: 'teal' } },
  { type: 'output', icon: Eye, title: 'Layer Output', desc: 'Visualize or export the result', color: 'emerald', config: { outputMode: 'visualize' } },
];

const nodeLabels: Record<NodeType, string> = {
  fragment: 'Operation',
  input: 'Data Source',
  geometry: 'Drawn layer',
  analysis: 'Spatial Op',
  attribute: 'Attribute Op',
  filter: 'Filter',
  aggregate: 'Summarise',
  allocate: 'Allocate',
  score: 'Score',
  join: 'Join',
  visualisation: 'Visualisation',
  output: 'Layer Output',
};

export const NodePalette = () => {
  const addNode = useStore((s) => s.addNode);
  const duckdbReady = useStore((s) => s.duckdbReady);
  const addToast = useStore((s) => s.addToast);
  const requestWorkflowFit = useStore((s) => s.requestWorkflowFit);
  const nodeCount = useStore((s) => s.nodes.length);
  const fragments = useStore((s) => s.fragments);
  const removeFragment = useStore((s) => s.removeFragment);
  const [executing, setExecuting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;
  // One field searches both lists: beginners type "buffer" without knowing
  // whether that is a node type or a spatial function.
  const matchedNodes = isSearching
    ? nodeCards.filter((item) =>
        item.title.toLowerCase().includes(normalizedQuery) || item.desc.toLowerCase().includes(normalizedQuery)
      )
    : nodeCards;
  const matchedFragments = isSearching
    ? fragments.filter((item) =>
        item.name.toLowerCase().includes(normalizedQuery) || (item.description || '').toLowerCase().includes(normalizedQuery)
      )
    : fragments;
  const matchedFunctions = isSearching
    ? spatialFunctions.filter((fn) =>
        fn.name.toLowerCase().includes(normalizedQuery) || fn.summary.toLowerCase().includes(normalizedQuery)
      )
    : [];

  const handleAddNode = (type: NodeType, config: Record<string, unknown> = {}, label?: string) => {
    addNode({
      id: `${type}-${Date.now()}`,
      type,
      position: nextNodePosition(useStore.getState().nodes),
      data: {
        label: label || nodeLabels[type],
        type,
        config,
      },
    });
    // Bring the whole graph (including the just-added node) into view. The
    // canvas owns fitView; this panel only asks for it.
    requestWorkflowFit();
  };

  const handleExecute = async () => {
    const { nodes, edges } = useStore.getState();
    try {
      setExecuting(true);
      const workflow = buildWorkflowSQL(nodes, edges, { fragments: useStore.getState().fragments });
      const result = await materializeWorkflowOutput({
        workflow,
        layerId: workflow.outputLayerName,
        name: 'Workflow Result',
        sourceNodeId: workflow.terminalNodeId || undefined,
        sourceKind: 'workflow',
        visualisationConfig: workflow.visualisationConfig,
      });
      if (!result.featureCount) {
        addToast({ type: 'warning', message: 'Workflow executed but produced no rows.' });
        return;
      }
      const rows = result.featureCount.toLocaleString();
      registerWorkflowResult(result, {
        nodeId: workflow.terminalNodeId || undefined,
        layerName: `Workflow Result (${rows} features)`,
      });
      addToast({ type: 'success', message: result.kind === 'layer'
        ? `Workflow complete — ${rows} features added to the map.`
        : `Workflow complete — ${rows} rows registered. The result has no geometry, so it is not on the map.` });
    } catch (err: any) {
      console.error('Workflow execution error:', err);
      addToast({ type: 'error', message: `Workflow error: ${err.message}` });
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-white">
      <div className="shrink-0 border-b bg-slate-50 px-4 py-3">
        <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <Workflow className="h-3.5 w-3.5" /> Workflow
          <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200">
            {nodeCount} {nodeCount === 1 ? 'node' : 'nodes'}
          </span>
        </h3>
      </div>

      <div className="shrink-0 border-b p-3">
        <label htmlFor="alur-node-search" className="sr-only">Search nodes and spatial functions</label>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <input
            id="alur-node-search"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search nodes and ${spatialFunctions.length} functions…`}
            className="w-full rounded-lg border bg-slate-50 py-1.5 pl-7 pr-2 text-[11px] outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        {matchedFragments.length > 0 && (
          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              This project's operations{isSearching && ` (${matchedFragments.length})`}
            </h3>
            <div className="grid grid-cols-1 gap-1.5">
              {matchedFragments.map((fragment) => (
                <div
                  key={fragment.id}
                  className="group flex items-center justify-between rounded-lg border border-cyan-100 p-2 text-left text-xs transition-all hover:border-cyan-300 hover:bg-cyan-50/60"
                >
                  <button
                    type="button"
                    onClick={() => handleAddNode('fragment', { fragmentId: fragment.id, arguments: {} }, fragment.name)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <div className="shrink-0 rounded-md bg-cyan-50 p-1.5">
                      <Package className="h-3.5 w-3.5 text-cyan-600" />
                    </div>
                    <div className="min-w-0">
                      <span className="block text-xs font-semibold text-foreground">{fragment.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {fragment.description || `${fragment.nodes.length} step${fragment.nodes.length === 1 ? '' : 's'}`}
                      </span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeFragment(fragment.id)}
                    title={`Forget "${fragment.name}"`}
                    aria-label={`Forget ${fragment.name}`}
                    className="shrink-0 rounded p-1 text-slate-300 opacity-0 transition-opacity hover:text-rose-600 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Nodes{isSearching && ` (${matchedNodes.length})`}
          </h3>
          {isSearching && matchedNodes.length === 0 && (
            <p className="pb-1 text-[11px] italic text-muted-foreground">No node types matched</p>
          )}
          <div className="grid grid-cols-1 gap-1.5">
            {matchedNodes.map((item) => {
              const Icon = item.icon;
              const cs = colorStyles[item.color] || colorStyles.blue;
              return (
                <button
                  key={item.type}
                  type="button"
                  onClick={() => handleAddNode(item.type, item.config, item.title === 'Layer Output' ? item.title : undefined)}
                  className={cn('group flex cursor-pointer items-center justify-between rounded-lg border p-2 text-left text-xs transition-all', cs.hoverBg, cs.hoverBorder)}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <div className={cn('shrink-0 rounded-md p-1.5 transition-colors', cs.iconBg, cs.iconHoverBg)}>
                      <Icon className="h-3.5 w-3.5" style={{ color: `var(--${item.color})` }} />
                    </div>
                    <div className="min-w-0">
                      <span className="block text-xs font-semibold text-foreground">{item.title}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{item.desc}</span>
                    </div>
                  </div>
                  <Plus className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              );
            })}
          </div>
        </div>

        {isSearching && (
          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Spatial Functions ({matchedFunctions.length})
            </h3>
            {/* Rendered inline rather than in a nested scroller — one scroll
                region per panel keeps trackpad and keyboard navigation sane. */}
            <div className="space-y-1">
              {matchedFunctions.length === 0 ? (
                <p className="p-2 text-[11px] italic text-muted-foreground">No functions matched</p>
              ) : (
                matchedFunctions.map((fn) => (
                  <button
                    key={fn.name}
                    type="button"
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-purple-50"
                    title={fn.summary}
                    onClick={() => handleAddNode('analysis', { operation: fn.name }, fn.name)}
                  >
                    <Zap className="h-2.5 w-2.5 shrink-0 text-purple-500" />
                    <span className="shrink-0 font-mono font-semibold text-purple-700">{fn.name}</span>
                    <span className="truncate text-muted-foreground">{fn.summary}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {!isSearching && (
          /* Scenarios branch a workflow specification, so they belong with the
             nodes rather than behind two disclosures in a separate mode. */
          <details className="rounded-xl border border-slate-200 bg-slate-50/60">
            <summary className="cursor-pointer px-3 py-2.5 text-[11px] font-semibold text-slate-600">
              Scenarios <span className="font-normal text-slate-500">(advanced)</span>
            </summary>
            <div className="border-t border-slate-200 px-3 pb-3">
              <VariantPanel />
            </div>
          </details>
        )}
      </div>

      <div className="border-t bg-muted/20 p-3">
        <button
          onClick={handleExecute}
          disabled={!duckdbReady || executing}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 py-2.5 text-xs font-semibold text-white shadow transition-all hover:bg-black active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {executing ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Executing…</>
          ) : (
            <><Zap className="h-4 w-4 fill-white" /> Execute Workflow</>
          )}
        </button>
      </div>
    </div>
  );
};
