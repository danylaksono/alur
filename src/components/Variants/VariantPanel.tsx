import { Compass, GitBranch, GitCompareArrows, Plus, SlidersHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useStore, type WorkflowNode } from '../../store/useStore';
import type { AnalysisVariant, VariantOperation } from '../../types/visualAnalytics';
import { equalWeightedScoreModel } from '../../utils/scoreModel';
import { comparableVariants, comparisonFromVariants } from '../../utils/scenarioComparison';

export const VariantPanel = () => {
  const datasets = useStore((state) => state.datasetRegistry);
  const layers = useStore((state) => state.mapLayers);
  const allVariants = useStore((state) => state.visualAnalytics.variants);
  const sessions = useStore((state) => state.visualAnalytics.sessions);
  const activeSessionId = useStore((state) => state.visualAnalytics.activeSessionId);
  const createSession = useStore((state) => state.createSession);
  const updateSession = useStore((state) => state.updateSession);
  const setActiveSession = useStore((state) => state.setActiveSession);
  const addVariant = useStore((state) => state.addVariant);
  const branchVariant = useStore((state) => state.branchVariant);
  const addNode = useStore((state) => state.addNode);
  const onConnect = useStore((state) => state.onConnect);
  const addToast = useStore((state) => state.addToast);
  const addComparison = useStore((state) => state.addComparison);
  const setActiveComparison = useStore((state) => state.setActiveComparison);
  const navigate = useStore((state) => state.navigate);
  const datasetList = useMemo(() => Object.values(datasets), [datasets]);
  const activeSession = useMemo(() => sessions.find((session) => session.id === activeSessionId), [sessions, activeSessionId]);
  // Only this line of enquiry's variants. Two questions asked of the same data
  // are two arguments, and showing their branches interleaved reads as one.
  const variants = useMemo(
    () => (activeSessionId ? allVariants.filter((variant) => variant.sessionId === activeSessionId) : allVariants),
    [allVariants, activeSessionId],
  );
  const comparable = useMemo(() => comparableVariants(variants, datasets), [variants, datasets]);
  const [datasetId, setDatasetId] = useState(datasetList[0]?.id || '');

  const compareScenarios = () => {
    const spec = comparisonFromVariants(variants, datasets);
    if (!spec) return;
    addComparison(spec);
    setActiveComparison(spec.id);
    navigate('compare');
    addToast({ type: 'success', message: `Comparing ${spec.operands.length} scenario results on shared scales.` });
  };
  const dataset = datasets[datasetId];
  const [fields, setFields] = useState<string[]>([]);

  const startSession = (baselineDatasetId: string, name: string) =>
    createSession({ id: `session-${Date.now()}`, name, question: '', baselineDatasetId });

  const createScoreVariant = () => {
    if (!dataset || !fields.length) return;
    // A variant always belongs to a question. If none is open, opening one
    // implicitly beats refusing to work until the analyst names something.
    if (!activeSession) startSession(dataset.id, `${dataset.name} enquiry`);
    const now = Date.now();
    const id = `variant-${now}`;
    const nodeId = `variant-score-${now}`;
    const scoreModel = equalWeightedScoreModel(fields);
    const operation: VariantOperation = { id: `operation-${now}`, type: 'weighted-score', parameters: { scoreModel, resultField: 'alur_priority_score' }, assumptions: ['Criteria are equally weighted until edited.', 'Higher values score better on every criterion.', 'Missing numeric values contribute zero.'] };
    // No output id yet: the run decides whether the result lands as a layer or
    // a table, and `registerWorkflowNodeOutput` fills it in afterwards.
    const variant: AnalysisVariant = { id, name: `${dataset.name} prioritisation`, baselineDatasetId: dataset.id, parameters: {}, assumptions: operation.assumptions || [], operations: [operation], createdAt: now, provenance: { workflowNodeIds: [nodeId], sourceVersion: dataset.sourceUpdatedAt } };
    // A score node rather than a hand-compiled attribute expression: the node
    // owns the compilation, so the variant benefits from every score feature
    // (rank column, contributions, mean substitution) without duplicating it.
    const node: WorkflowNode = { id: nodeId, type: 'score', position: { x: 360 + useStore.getState().nodes.length * 24, y: 160 + useStore.getState().nodes.length * 18 }, data: { label: 'Weighted priority score', type: 'score', config: { scoreModel, resultField: 'alur_priority_score', includeContributions: true, variantId: id } } };
    addNode(node);
    const sourceNodeId = dataset.source.kind === 'workflow-node' ? dataset.source.nodeId : layers.find((layer) => layer.id === dataset.id)?.sourceNodeId;
    if (sourceNodeId) onConnect({ source: sourceNodeId, target: nodeId, sourceHandle: null, targetHandle: null });
    addVariant(variant);
    addToast({ type: 'success', message: 'Created a workflow-backed scoring variant. Run the workflow to register its output dataset.' });
  };

  return <section className="mt-5 rounded-xl border border-slate-200 bg-white p-3"><div className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-emerald-600" /><h3 className="text-xs font-bold text-slate-800">Intervention variants</h3></div><p className="mt-1 text-[10px] leading-relaxed text-slate-400">Variants branch workflow specifications; their parents remain unchanged.</p>

    {(sessions.length > 0 || datasetList.length > 0) && <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2">
      <div className="flex items-center gap-1.5"><Compass className="h-3 w-3 text-indigo-500" /><p className="text-[9px] font-bold uppercase tracking-wide text-slate-500">Line of enquiry</p></div>
      {sessions.length > 0 && <select value={activeSessionId || ''} onChange={(event) => setActiveSession(event.target.value || undefined)} className="mt-1.5 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[10px]" aria-label="Active line of enquiry"><option value="">All enquiries</option>{sessions.map((session) => <option key={session.id} value={session.id}>{session.name}</option>)}</select>}
      {activeSession
        ? <input value={activeSession.question} onChange={(event) => updateSession(activeSession.id, { question: event.target.value })} placeholder="What is this asking?" className="mt-1.5 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[10px] text-slate-600" aria-label="Enquiry question" />
        : <p className="mt-1.5 text-[9px] leading-relaxed text-slate-400">{sessions.length ? 'Showing every variant in the project.' : 'Grouping is optional — one starts automatically with your first variant.'}</p>}
      {dataset && <button type="button" onClick={() => startSession(dataset.id, `${dataset.name} enquiry`)} className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[9px] font-bold text-slate-600 hover:bg-slate-50"><Plus className="h-2.5 w-2.5" /> New line of enquiry</button>}
    </div>}
    <select value={datasetId} onChange={(event) => { setDatasetId(event.target.value); setFields([]); }} className="mt-3 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-[11px]" aria-label="Variant baseline dataset"><option value="">Choose baseline</option>{datasetList.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
    {dataset && <div className="mt-2 max-h-28 overflow-y-auto rounded-lg bg-slate-50 p-2"><p className="mb-1 text-[9px] font-bold uppercase tracking-wide text-slate-400">Score criteria</p>{dataset.fields.slice(0, 20).map((field) => <label key={field.name} className="flex items-center gap-2 py-1 text-[10px] text-slate-600"><input type="checkbox" checked={fields.includes(field.name)} onChange={(event) => setFields((current) => event.target.checked ? [...current, field.name] : current.filter((item) => item !== field.name))} />{field.name}</label>)}</div>}
    <button type="button" onClick={createScoreVariant} disabled={!dataset || !fields.length} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-[10px] font-bold text-white disabled:bg-slate-300"><Plus className="h-3 w-3" /> Create score variant</button>
    {variants.length > 0 && <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">{variants.map((variant) => {
      const ready = Boolean(variant.workflowOutputDatasetId && datasets[variant.workflowOutputDatasetId]);
      return <div key={variant.id} className="flex items-center gap-2"><div className="min-w-0 flex-1"><p className="truncate text-[10px] font-bold text-slate-700">{variant.name}</p><p className="text-[9px] text-slate-500">{ready ? 'Result ready' : 'Run the workflow to produce its result'}{variant.parentVariantId ? ' · branch' : ''}</p></div><button type="button" onClick={() => branchVariant(variant.id)} className="rounded p-1.5 text-slate-400 hover:bg-slate-50 hover:text-emerald-600" aria-label={`Branch ${variant.name}`}><GitBranch className="h-3.5 w-3.5" /></button></div>;
    })}</div>}

    {variants.length > 1 && <div className="mt-3 border-t border-slate-100 pt-3">
      <button
        type="button"
        disabled={comparable.length < 2}
        onClick={compareScenarios}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-[10px] font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <GitCompareArrows className="h-3 w-3" /> Compare {comparable.length > 1 ? `${comparable.length} ` : ''}scenarios
      </button>
      {comparable.length < 2 && <p className="mt-1.5 text-center text-[9px] leading-4 text-slate-500">Run the workflow for at least two scenarios to compare their results.</p>}
    </div>}
  </section>;
};
