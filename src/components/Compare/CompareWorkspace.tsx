import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, BarChart3, Check, Copy, Database, GitCompareArrows, Map, Plus, Save, Trash2, X } from 'lucide-react';
import { useStore } from '../../store/useStore';
import type { ComparisonOperand, ComparisonResult, ComparisonSpec, ComparisonView } from '../../types/visualAnalytics';
import { comparisonCompatibility, queryComparison } from '../../services/comparisonService';
import { cn } from '../../utils/cn';
import { ComparisonMapEvidence, ComparisonRecordsEvidence } from './ComparisonEvidenceViews';

const COLOURS = ['#2563eb', '#e11d48', '#059669', '#d97706'];
const VIEW_LABELS: Array<[ComparisonView, string]> = [['overview', 'Overview'], ['distribution', 'Distribution'], ['categories', 'Categories'], ['time', 'Time'], ['map', 'Map'], ['records', 'Records']];

const defaultComparison = (datasetId?: string, datasetName?: string): ComparisonSpec => {
  const now = Date.now();
  return {
    id: `comparison-${now}`,
    name: 'Untitled comparison',
    operands: datasetId ? [
      { id: 'operand-a', label: `${datasetName || 'Dataset'} A`, colour: COLOURS[0], datasetId, scope: { kind: 'whole-dataset' } },
      { id: 'operand-b', label: `${datasetName || 'Dataset'} B`, colour: COLOURS[1], datasetId, scope: { kind: 'whole-dataset' } },
    ] : [],
    alignment: { mode: 'aggregate-only' },
    measures: [{ id: 'rows', label: 'Rows', fields: {}, aggregation: 'count', format: 'compact' }],
    dimensions: [],
    requestedViews: ['overview', 'distribution', 'categories', 'records'],
    sourceVersions: {},
    createdAt: now,
    updatedAt: now,
  };
};

const formatValue = (value: number | null) => value === null || !Number.isFinite(value) ? '—' : Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);

const Overview = ({ spec, result }: { spec: ComparisonSpec; result: ComparisonResult }) => {
  const maximum = Math.max(1, ...result.summaries.flatMap((summary) => summary.values.map((value) => value.value || 0)));
  return <div className="space-y-5">
    {result.summaries.map((summary) => {
      const measure = spec.measures.find((item) => item.id === summary.measureId);
      return <section key={summary.measureId} className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-4 flex items-baseline justify-between gap-3"><h3 className="text-sm font-bold text-slate-800">{measure?.label || summary.measureId}</h3><span className="text-[10px] text-slate-600">Common scale · denominator shown</span></div>
        <div className={cn('grid gap-4', spec.operands.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-2 xl:grid-cols-4')}>
          {summary.values.map((value) => {
            const operand = spec.operands.find((item) => item.id === value.operandId)!;
            return <div key={value.operandId} className="min-w-0">
              <div className="mb-1 flex items-center justify-between gap-2"><span className="truncate text-xs font-semibold text-slate-700"><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: operand.colour }} />{operand.label}</span><strong className="text-sm tabular-nums text-slate-900">{formatValue(value.value)}</strong></div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${Math.max(2, ((value.value || 0) / maximum) * 100)}%`, backgroundColor: operand.colour }} /></div>
              <p className="mt-1 text-[10px] text-slate-600">n={value.denominator.toLocaleString()} · {value.missing.toLocaleString()} missing</p>
            </div>;
          })}
        </div>
      </section>;
    })}
  </div>;
};

const Distribution = ({ spec, result }: { spec: ComparisonSpec; result: ComparisonResult }) => <div className="grid gap-4 lg:grid-cols-2">
  {result.distributions.map((distribution) => {
    const operand = spec.operands.find((item) => item.id === distribution.operandId)!;
    const maximum = Math.max(1, ...distribution.bins.map((bin) => bin.share));
    return <section key={`${distribution.measureId}-${distribution.operandId}`} className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-xs font-bold text-slate-800"><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: operand.colour }} />{operand.label}</h3>
      <div className="mt-4 flex h-40 items-end gap-1" aria-label={`Normalised distribution for ${operand.label}`}>
        {distribution.bins.map((bin, index) => <div key={index} className="group relative min-w-0 flex-1 rounded-t" title={`${bin.label}: ${(bin.share * 100).toFixed(1)}% (${bin.count})`} style={{ height: `${Math.max(2, bin.share / maximum * 100)}%`, backgroundColor: operand.colour }} />)}
      </div>
      <p className="mt-2 text-[10px] text-slate-400">Normalised share · hover bars for bin counts</p>
    </section>;
  })}
</div>;

const Categories = ({ spec, result }: { spec: ComparisonSpec; result: ComparisonResult }) => <div className="space-y-4">
  {result.categoryShares.map((category) => {
    const operand = spec.operands.find((item) => item.id === category.operandId)!;
    return <section key={`${category.dimension}-${category.operandId}`} className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-xs font-bold text-slate-800">{category.dimension} · {operand.label}</h3>
      <div className="mt-3 space-y-2">{category.values.slice(0, 10).map((value) => <div key={value.label} className="grid grid-cols-[minmax(80px,180px)_1fr_52px] items-center gap-2 text-[11px]"><span className="truncate text-slate-600">{value.label}</span><div className="h-2 rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${value.share * 100}%`, backgroundColor: operand.colour }} /></div><span className="text-right tabular-nums text-slate-500">{(value.share * 100).toFixed(1)}%</span></div>)}</div>
    </section>;
  })}
</div>;

export const CompareWorkspace = ({ onBack }: { onBack?: () => void }) => {
  const datasets = useStore((state) => state.datasetRegistry);
  const comparisons = useStore((state) => state.visualAnalytics.comparisons);
  const cohorts = useStore((state) => state.visualAnalytics.cohorts);
  const activeComparisonId = useStore((state) => state.visualAnalytics.activeComparisonId);
  const addComparison = useStore((state) => state.addComparison);
  const updateComparison = useStore((state) => state.updateComparison);
  const removeComparison = useStore((state) => state.removeComparison);
  const setActiveComparison = useStore((state) => state.setActiveComparison);
  const addExplainCard = useStore((state) => state.addExplainCard);
  const addCohort = useStore((state) => state.addCohort);
  const addToast = useStore((state) => state.addToast);
  const setLayerFilters = useStore((state) => state.setLayerFilters);
  const datasetList = useMemo(() => Object.values(datasets), [datasets]);
  const saved = comparisons.find((comparison) => comparison.id === activeComparisonId);
  const [draft, setDraft] = useState<ComparisonSpec>(() => saved || defaultComparison(datasetList[0]?.id, datasetList[0]?.name));
  const [view, setView] = useState<ComparisonView>('overview');
  const [configOpen, setConfigOpen] = useState(true);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [loading, setLoading] = useState(Boolean(datasetList.length));
  const [selectedKey, setSelectedKey] = useState<string>();
  const [mapMode, setMapMode] = useState<'multiples' | 'difference'>('multiples');
  const compatibility = comparisonCompatibility(draft, datasets);

  useEffect(() => { if (saved) setDraft(structuredClone(saved)); }, [saved]);
  useEffect(() => {
    const controller = new AbortController();
    if (!compatibility.valid || !draft.measures.length) { setResult(null); return () => controller.abort(); }
    setLoading(true);
    queryComparison(draft, datasets, controller.signal).then(setResult).catch((error) => {
      if (error?.name !== 'AbortError') addToast({ type: 'error', message: error?.message || 'Comparison query failed.' });
    }).finally(() => setLoading(false));
    return () => controller.abort();
  }, [draft, datasets]);

  const updateOperand = (id: string, patch: Partial<ComparisonOperand>) => setDraft((current) => ({ ...current, operands: current.operands.map((operand) => operand.id === id ? { ...operand, ...patch } : operand), updatedAt: Date.now() }));
  const addOperand = () => {
    if (!datasetList.length || draft.operands.length >= 4) return;
    const index = draft.operands.length;
    const dataset = datasetList[0];
    setDraft((current) => ({ ...current, operands: [...current.operands, { id: `operand-${Date.now()}`, label: `Group ${index + 1}`, colour: COLOURS[index], datasetId: dataset.id, scope: { kind: 'whole-dataset' } }], updatedAt: Date.now() }));
  };
  const save = () => {
    const sourceVersions = Object.fromEntries(draft.operands.map((operand) => [operand.datasetId, datasets[operand.datasetId]?.sourceUpdatedAt]));
    const snapshot = structuredClone({ ...draft, operands: draft.operands.map((operand) => ({ ...operand, sourceVersion: datasets[operand.datasetId]?.sourceUpdatedAt })), sourceVersions, updatedAt: Date.now() });
    if (comparisons.some((comparison) => comparison.id === draft.id)) updateComparison(draft.id, snapshot);
    else addComparison(snapshot);
    addToast({ type: 'success', message: 'Comparison saved with its current group definitions.' });
  };
  const pin = () => {
    if (!result) return;
    const sourceVersions = Object.fromEntries(draft.operands.map((operand) => [operand.datasetId, datasets[operand.datasetId]?.sourceUpdatedAt]));
    const comparisonSpec = structuredClone({ ...draft, operands: draft.operands.map((operand) => ({ ...operand, sourceVersion: datasets[operand.datasetId]?.sourceUpdatedAt })), sourceVersions });
    addExplainCard({
      id: `comparison-card-${Date.now()}`, sectionId: 'evidence', kind: 'comparison', referenceId: draft.id,
      comparisonView: view, comparisonMapMode: view === 'map' ? mapMode : undefined, title: `${draft.name} · ${VIEW_LABELS.find(([id]) => id === view)?.[1] || view}`, width: 12, height: view === 'map' || view === 'records' ? 'tall' : 'standard', behaviour: 'frozen', frozenValues: structuredClone(result),
      provenance: { capturedAt: Date.now(), datasetIds: [...new Set(draft.operands.map((operand) => operand.datasetId))], sourceVersions, filtersByDataset: {}, comparisonSpec, caveats: result.warnings },
    });
    addToast({ type: 'success', message: `Frozen ${view} evidence pinned to Explain.` });
  };
  const useRecordAsFilter = (record: NonNullable<ComparisonResult['alignedRecords']>[number]) => {
    draft.operands.forEach((operand) => {
      const keyField = draft.alignment.keyFields?.[operand.id];
      if (!keyField || !record.presentOperandIds.includes(operand.id)) return;
      setLayerFilters(operand.datasetId, [{ kind: 'category', field: keyField, values: [record.key] }]);
    });
    addToast({ type: 'success', message: `Applied ${record.key} explicitly as a dataset filter.` });
  };

  return <div className="flex min-h-0 flex-1 overflow-hidden bg-slate-50">
    {configOpen && <aside className="w-[340px] shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-4 pb-20 max-lg:w-[300px] max-md:absolute max-md:z-20 max-md:h-full max-md:w-[min(88vw,340px)]">
      <div className="mb-4 flex items-center justify-between"><div>{onBack && <button type="button" onClick={onBack} className="mb-2 flex items-center gap-1 text-[10px] font-bold text-slate-500 hover:text-blue-700"><ArrowLeft className="h-3 w-3" /> All analysis questions</button>}<p className="text-[10px] font-bold uppercase tracking-[.16em] text-blue-600">Compare</p><h2 className="text-base font-bold text-slate-900">Comparison sessions</h2></div><div className="flex gap-1"><button type="button" className="rounded-lg border p-2 text-slate-500 hover:bg-slate-50" onClick={() => setDraft(defaultComparison(datasetList[0]?.id, datasetList[0]?.name))} aria-label="New comparison"><Plus className="h-4 w-4" /></button><button type="button" onClick={() => setConfigOpen(false)} className="rounded-lg border p-2 text-slate-500 md:hidden" aria-label="Close comparison configuration"><X className="h-4 w-4" /></button></div></div>
      {comparisons.length > 0 && <select className="mb-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs" value={activeComparisonId || ''} onChange={(event) => setActiveComparison(event.target.value || undefined)} aria-label="Saved comparison"><option value="">Unsaved comparison</option>{comparisons.map((comparison) => <option key={comparison.id} value={comparison.id}>{comparison.name}</option>)}</select>}
      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">Name<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value, updatedAt: Date.now() })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold normal-case tracking-normal text-slate-800" /></label>
      <div className="mt-5 flex items-center justify-between"><h3 className="text-xs font-bold text-slate-800">Groups <span className="font-normal text-slate-600">({draft.operands.length}/4)</span></h3><button type="button" disabled={draft.operands.length >= 4 || !datasetList.length} onClick={addOperand} className="text-[11px] font-bold text-blue-600 disabled:text-slate-300">+ Add</button></div>
      <div className="mt-2 space-y-3">{draft.operands.map((operand, index) => <div key={operand.id} className="rounded-xl border border-slate-200 p-3" style={{ borderLeftColor: operand.colour, borderLeftWidth: 4 }}>
        <div className="flex gap-2"><input value={operand.label} onChange={(event) => updateOperand(operand.id, { label: event.target.value })} className="min-w-0 flex-1 border-0 p-0 text-xs font-bold text-slate-800 outline-none" aria-label={`Group ${index + 1} label`} /><button type="button" disabled={draft.operands.length <= 2} onClick={() => setDraft({ ...draft, operands: draft.operands.filter((item) => item.id !== operand.id) })} className="text-slate-300 hover:text-rose-500 disabled:opacity-20" aria-label={`Remove ${operand.label}`}><Trash2 className="h-3.5 w-3.5" /></button></div>
        <select value={operand.datasetId} onChange={(event) => updateOperand(operand.id, { datasetId: event.target.value, scope: { kind: 'whole-dataset' } })} className="mt-2 w-full rounded-md border border-slate-200 px-2 py-1.5 text-[11px]" aria-label={`${operand.label} dataset`}>{datasetList.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}</select>
        <select value={operand.scope.kind === 'cohort' ? `cohort:${operand.scope.cohortId}` : operand.scope.kind} onChange={(event) => { const cohort = event.target.value.startsWith('cohort:') ? cohorts.find((item) => item.id === event.target.value.slice(7)) : undefined; updateOperand(operand.id, { scope: cohort ? { kind: 'cohort', cohortId: cohort.id, definition: structuredClone(cohort.definition) } : event.target.value === 'filters' ? { kind: 'filters', filters: structuredClone(useStore.getState().visualAnalytics.datasets[operand.datasetId]?.filters || []) } : { kind: 'whole-dataset' } }); }} className="mt-2 w-full rounded-md border border-slate-200 px-2 py-1.5 text-[11px]" aria-label={`${operand.label} scope`}><option value="whole-dataset">Whole dataset</option><option value="filters">Snapshot active filters</option>{cohorts.filter((cohort) => cohort.datasetId === operand.datasetId).map((cohort) => <option key={cohort.id} value={`cohort:${cohort.id}`}>Cohort: {cohort.name}</option>)}</select>
        {operand.scope.kind === 'filters' && <button type="button" onClick={() => { const id = `cohort-${Date.now()}`; addCohort({ id, datasetId: operand.datasetId, name: operand.label, colour: operand.colour, definition: { kind: 'filters', filters: structuredClone(operand.scope.kind === 'filters' ? operand.scope.filters : []) }, createdAt: Date.now() }); addToast({ type: 'success', message: 'Saved this immutable filter scope as a cohort.' }); }} className="mt-2 text-[9px] font-bold text-blue-600">Save as named cohort</button>}
      </div>)}</div>
      <div className="mt-5"><h3 className="text-xs font-bold text-slate-800">Measure</h3>{draft.measures.map((measure) => <div key={measure.id} className="mt-2 rounded-xl bg-slate-50 p-3"><input value={measure.label} onChange={(event) => setDraft({ ...draft, measures: draft.measures.map((item) => item.id === measure.id ? { ...item, label: event.target.value } : item) })} className="w-full bg-transparent text-xs font-bold outline-none" aria-label="Measure label" /><select value={measure.aggregation} onChange={(event) => setDraft({ ...draft, measures: draft.measures.map((item) => item.id === measure.id ? { ...item, aggregation: event.target.value as typeof item.aggregation } : item) })} className="mt-2 w-full rounded-md border border-slate-200 px-2 py-1.5 text-[11px]" aria-label="Measure aggregation"><option value="count">Count rows</option><option value="sum">Sum</option><option value="avg">Average</option><option value="min">Minimum</option><option value="max">Maximum</option></select>{measure.aggregation !== 'count' && draft.operands.map((operand) => <label key={operand.id} className="mt-2 block text-[10px] text-slate-500">{operand.label}<select aria-label={`${operand.label} measure field`} value={measure.fields[operand.id] || ''} onChange={(event) => setDraft({ ...draft, measures: draft.measures.map((item) => item.id === measure.id ? { ...item, fields: { ...item.fields, [operand.id]: event.target.value || undefined } } : item) })} className="mt-0.5 w-full rounded-md border border-slate-200 px-2 py-1.5 text-[11px]"><option value="">Choose field</option>{datasets[operand.datasetId]?.fields.map((field) => <option key={field.name} value={field.name}>{field.name}</option>)}</select></label>)}</div>)}</div>
      <details className="mt-5 rounded-xl border border-slate-200 bg-slate-50/60"><summary className="cursor-pointer px-3 py-2.5 text-[10px] font-bold text-slate-700">Advanced comparison options</summary><div className="border-t border-slate-200 p-3"><label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Matching records or time periods<select aria-label="Comparison alignment" value={draft.alignment.mode} onChange={(event) => setDraft({ ...draft, alignment: { mode: event.target.value as ComparisonSpec['alignment']['mode'] }, updatedAt: Date.now() })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs normal-case tracking-normal"><option value="aggregate-only">Compare summaries only</option><option value="entity-keyed">Match individual records by a key</option><option value="temporal">Align by time</option><option value="spatial">Align by location</option></select></label>{(draft.alignment.mode === 'entity-keyed' || draft.alignment.mode === 'temporal') && <div className="mt-2 rounded-xl bg-white p-3">{draft.operands.map((operand) => { const mapping = draft.alignment.mode === 'entity-keyed' ? draft.alignment.keyFields : draft.alignment.timeFields; return <label key={operand.id} className="mt-1 block text-[10px] text-slate-500">{operand.label}<select aria-label={`${operand.label} ${draft.alignment.mode === 'entity-keyed' ? 'entity key' : 'time field'}`} value={mapping?.[operand.id] || ''} onChange={(event) => setDraft((current) => ({ ...current, alignment: current.alignment.mode === 'entity-keyed' ? { ...current.alignment, keyFields: { ...current.alignment.keyFields, [operand.id]: event.target.value } } : { ...current.alignment, timeFields: { ...current.alignment.timeFields, [operand.id]: event.target.value } } }))} className="mt-0.5 w-full rounded-md border border-slate-200 px-2 py-1.5 text-[11px]"><option value="">Choose {draft.alignment.mode === 'entity-keyed' ? 'key' : 'time'} field</option>{datasets[operand.datasetId]?.fields.map((field) => <option key={field.name} value={field.name}>{field.name}</option>)}</select></label>; })}</div>}
      <label className="mt-4 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Category dimension<select value={draft.dimensions[0] || ''} onChange={(event) => setDraft({ ...draft, dimensions: event.target.value ? [event.target.value] : [], updatedAt: Date.now() })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs normal-case tracking-normal"><option value="">No category breakdown</option>{draft.operands[0] && datasets[draft.operands[0].datasetId]?.fields.map((field) => <option key={field.name} value={field.name}>{field.name}</option>)}</select></label>
      <fieldset className="mt-4"><legend className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Views</legend><div className="mt-2 grid grid-cols-2 gap-1">{VIEW_LABELS.map(([id, label]) => <label key={id} className="flex items-center gap-2 rounded-md px-2 py-1 text-[10px] text-slate-600 hover:bg-white"><input type="checkbox" checked={draft.requestedViews.includes(id)} onChange={(event) => setDraft({ ...draft, requestedViews: event.target.checked ? [...draft.requestedViews, id] : draft.requestedViews.filter((item) => item !== id), updatedAt: Date.now() })} />{label}</label>)}</div></fieldset></div></details>
      <div className="mt-5 flex gap-2 border-t border-slate-100 bg-white pt-3"><button type="button" onClick={save} disabled={!compatibility.valid} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:bg-slate-300"><Save className="h-3.5 w-3.5" /> Save</button>{saved && <button type="button" onClick={() => removeComparison(saved.id)} className="rounded-lg border border-slate-200 p-2 text-slate-500" aria-label="Delete comparison"><Trash2 className="h-4 w-4" /></button>}</div>
    </aside>}
    <main className="min-w-0 flex-1 overflow-y-auto p-5 md:p-6">
      <div className="mx-auto max-w-7xl">
        {!configOpen && <button type="button" onClick={() => setConfigOpen(true)} className="mb-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 md:hidden">Configure comparison</button>}
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><GitCompareArrows className="h-5 w-5 text-blue-600" /><h1 className="text-xl font-bold text-slate-900">{draft.name}</h1></div><p className="mt-1 text-xs text-slate-500">Comparing {draft.operands.length} groups · {draft.alignment.mode === 'aggregate-only' ? 'summary values' : draft.alignment.mode === 'entity-keyed' ? 'records matched by key' : draft.alignment.mode === 'temporal' ? 'aligned over time' : 'aligned by location'} · shared scales</p></div><button type="button" onClick={pin} disabled={!result} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm disabled:opacity-40"><Copy className="h-3.5 w-3.5" /> Pin to Explain</button></div>
        {compatibility.warnings.length > 0 && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">{compatibility.warnings.map((warning) => <p key={warning} className="flex gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{warning}</p>)}</div>}
        <div className="mt-5 flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">{VIEW_LABELS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => { setView(id); if (!draft.requestedViews.includes(id)) setDraft((current) => ({ ...current, requestedViews: [...current.requestedViews, id], updatedAt: Date.now() })); }} className={cn('border-b-2 px-3 py-2 text-xs font-bold', view === id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800')}>{label}</button>)}</div>
        <div className="mt-5">{loading && !result ? <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">Preparing the comparison…</div> : !result ? <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center"><Database className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 text-sm font-semibold text-slate-600">Choose two to four groups to compare</p><p className="mt-1 text-xs text-slate-600">Groups can come from datasets, saved filters, workflow results or time windows.</p></div> : view === 'overview' ? <Overview spec={draft} result={result} /> : view === 'distribution' ? <Distribution spec={draft} result={result} /> : view === 'categories' ? <Categories spec={draft} result={result} /> : view === 'time' ? result.temporalSeries.length ? <pre className="rounded-xl border bg-white p-4 text-xs">{JSON.stringify(result.temporalSeries, null, 2)}</pre> : <EmptyView icon={BarChart3} title="Map time fields to compare change" detail="Temporal alignment preserves missing periods instead of joining across gaps." /> : view === 'map' ? <ComparisonMapEvidence spec={draft} result={result} differenceEligible={compatibility.differenceMapEligible} selectedKey={selectedKey} onSelectKey={setSelectedKey} mode={mapMode} onModeChange={setMapMode} /> : draft.alignment.mode === 'entity-keyed' ? <ComparisonRecordsEvidence spec={draft} result={result} selectedKey={selectedKey} onSelectKey={setSelectedKey} onUseAsFilter={useRecordAsFilter} /> : <EmptyView icon={Check} title="Match individual records to inspect them" detail="Open advanced comparison options, match records by a stable key, then return to this view." />}</div>
      </div>
    </main>
  </div>;
};

const EmptyView = ({ icon: Icon, title, detail }: { icon: typeof Map; title: string; detail: string }) => <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center"><Icon className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 text-sm font-semibold text-slate-600">{title}</p><p className="mx-auto mt-1 max-w-lg text-xs leading-relaxed text-slate-600">{detail}</p></div>;
