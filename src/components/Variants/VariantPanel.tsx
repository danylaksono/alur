import { GitBranch, Plus, SlidersHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useStore, type WorkflowNode } from '../../store/useStore';
import type { AnalysisVariant, VariantOperation } from '../../types/visualAnalytics';
import { quoteIdentifier } from '../../utils/visualFilterSql';

const weightedScoreExpression = (fields: string[]) => fields.map((field) => {
  const quoted = quoteIdentifier(field);
  return `(COALESCE(TRY_CAST(${quoted} AS DOUBLE), 0) - MIN(COALESCE(TRY_CAST(${quoted} AS DOUBLE), 0)) OVER ()) / NULLIF(MAX(COALESCE(TRY_CAST(${quoted} AS DOUBLE), 0)) OVER () - MIN(COALESCE(TRY_CAST(${quoted} AS DOUBLE), 0)) OVER (), 0)`;
}).join(' + ') || '0';

export const VariantPanel = () => {
  const datasets = useStore((state) => state.datasetRegistry);
  const layers = useStore((state) => state.mapLayers);
  const variants = useStore((state) => state.visualAnalytics.variants);
  const addVariant = useStore((state) => state.addVariant);
  const branchVariant = useStore((state) => state.branchVariant);
  const addNode = useStore((state) => state.addNode);
  const onConnect = useStore((state) => state.onConnect);
  const addToast = useStore((state) => state.addToast);
  const datasetList = useMemo(() => Object.values(datasets), [datasets]);
  const [datasetId, setDatasetId] = useState(datasetList[0]?.id || '');
  const dataset = datasets[datasetId];
  const [fields, setFields] = useState<string[]>([]);

  const createScoreVariant = () => {
    if (!dataset || !fields.length) return;
    const now = Date.now();
    const id = `variant-${now}`;
    const nodeId = `variant-score-${now}`;
    const operation: VariantOperation = { id: `operation-${now}`, type: 'weighted-score', parameters: { scoreModel: { criteria: fields.map((field) => ({ field, weight: 1 / fields.length, direction: 'higher', normalisation: 'min-max' })), missingValueTreatment: 'zero' }, resultField: 'alur_priority_score' }, assumptions: ['Criteria are equally weighted until edited.', 'Missing numeric values contribute zero.'] };
    const variant: AnalysisVariant = { id, name: `${dataset.name} prioritisation`, baselineDatasetId: dataset.id, workflowOutputDatasetId: `workflow:${nodeId}`, parameters: {}, assumptions: operation.assumptions || [], operations: [operation], createdAt: now, provenance: { workflowNodeIds: [nodeId], sourceVersion: dataset.sourceUpdatedAt } };
    const node: WorkflowNode = { id: nodeId, type: 'attribute', position: { x: 360 + useStore.getState().nodes.length * 24, y: 160 + useStore.getState().nodes.length * 18 }, data: { label: 'Weighted priority score', type: 'attribute', config: { expression: `(${weightedScoreExpression(fields)}) / ${fields.length}`, resultField: 'alur_priority_score', variantId: id, scoreModel: operation.parameters.scoreModel } } };
    addNode(node);
    const sourceNodeId = dataset.source.kind === 'workflow-node' ? dataset.source.nodeId : layers.find((layer) => layer.id === dataset.id)?.sourceNodeId;
    if (sourceNodeId) onConnect({ source: sourceNodeId, target: nodeId, sourceHandle: null, targetHandle: null });
    addVariant(variant);
    addToast({ type: 'success', message: 'Created a workflow-backed scoring variant. Run the workflow to register its output dataset.' });
  };

  return <section className="mt-5 rounded-xl border border-slate-200 bg-white p-3"><div className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-emerald-600" /><h3 className="text-xs font-bold text-slate-800">Intervention variants</h3></div><p className="mt-1 text-[10px] leading-relaxed text-slate-400">Variants branch workflow specifications; their parents remain unchanged.</p>
    <select value={datasetId} onChange={(event) => { setDatasetId(event.target.value); setFields([]); }} className="mt-3 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-[11px]" aria-label="Variant baseline dataset"><option value="">Choose baseline</option>{datasetList.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
    {dataset && <div className="mt-2 max-h-28 overflow-y-auto rounded-lg bg-slate-50 p-2"><p className="mb-1 text-[9px] font-bold uppercase tracking-wide text-slate-400">Score criteria</p>{dataset.fields.slice(0, 20).map((field) => <label key={field.name} className="flex items-center gap-2 py-1 text-[10px] text-slate-600"><input type="checkbox" checked={fields.includes(field.name)} onChange={(event) => setFields((current) => event.target.checked ? [...current, field.name] : current.filter((item) => item !== field.name))} />{field.name}</label>)}</div>}
    <button type="button" onClick={createScoreVariant} disabled={!dataset || !fields.length} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-[10px] font-bold text-white disabled:bg-slate-300"><Plus className="h-3 w-3" /> Create score variant</button>
    {variants.length > 0 && <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">{variants.map((variant) => <div key={variant.id} className="flex items-center gap-2"><div className="min-w-0 flex-1"><p className="truncate text-[10px] font-bold text-slate-700">{variant.name}</p><p className="text-[9px] text-slate-400">{variant.operations.length} operations{variant.parentVariantId ? ' · branch' : ''}</p></div><button type="button" onClick={() => branchVariant(variant.id)} className="rounded p-1.5 text-slate-400 hover:bg-slate-50 hover:text-emerald-600" aria-label={`Branch ${variant.name}`}><GitBranch className="h-3.5 w-3.5" /></button></div>)}</div>}
  </section>;
};
