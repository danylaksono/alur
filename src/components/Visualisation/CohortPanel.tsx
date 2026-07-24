import { useEffect, useState } from 'react';
import { Bookmark, Copy, GitBranch, Loader2, Plus, Save, Trash2, Users, X } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { materializeLayerSelection, queryCohortComparison } from '../../services/visualAnalyticsService';
import type { AnalyticalBookmark, CohortComparisonResult, CohortSpec } from '../../types/visualAnalytics';
import { nextNodePosition } from '../../utils/nodePlacement';
import { compileVisualFiltersWhereClause } from '../../utils/visualFilterSql';

const COHORT_COLOURS = ['#0284c7', '#f97316', '#16a34a', '#db2777', '#7c3aed', '#0891b2'];
const format = (value: number | null, digits = 2) => value === null ? 'n/a' : value.toLocaleString(undefined, { maximumFractionDigits: digits });

const ComparisonResult = ({ result, cohortA, cohortB }: { result: CohortComparisonResult; cohortA: CohortSpec; cohortB?: CohortSpec }) => (
  <div className="space-y-3 border-t p-3 text-[10px]">
    <div className="grid grid-cols-3 gap-2">
      <div><span className="block font-semibold uppercase tracking-wide text-slate-400">{cohortA.name}</span><b className="text-sm tabular-nums text-slate-800">{result.aRows.toLocaleString()}</b></div>
      <div><span className="block font-semibold uppercase tracking-wide text-slate-400">{cohortB?.name || 'Remainder'}</span><b className="text-sm tabular-nums text-slate-800">{result.bRows.toLocaleString()}</b></div>
      <div><span className="block font-semibold uppercase tracking-wide text-violet-500">Overlap</span><b className="text-sm tabular-nums text-violet-700">{result.overlapRows.toLocaleString()}</b></div>
    </div>
    <div className="rounded-md bg-slate-50 p-2 leading-4 text-slate-500">{result.denominatorNote}<br />{result.missingValueNote}</div>

    {result.numeric.map((metric) => {
      const maxBin = Math.max(1, ...metric.bins.flatMap((bin) => [bin.aCount, bin.bCount]));
      return <div key={metric.field} className="rounded-md border border-slate-200 p-2">
        <div className="flex justify-between gap-2"><b className="truncate text-slate-700">{metric.field}</b><span className="shrink-0 text-slate-400">effect {format(metric.effectSize)}</span></div>
        <div className="mt-1 grid grid-cols-2 gap-2 tabular-nums"><span><i className="not-italic text-slate-400">A mean </i>{format(metric.aMean)} <i className="not-italic text-slate-300">({metric.aMissing} missing)</i></span><span><i className="not-italic text-slate-400">B mean </i>{format(metric.bMean)} <i className="not-italic text-slate-300">({metric.bMissing} missing)</i></span></div>
        {metric.bins.length > 0 && <div className="mt-2 flex h-12 items-end gap-0.5" aria-label={`Distribution comparison for ${metric.field}`}>
          {metric.bins.map((bin) => <div key={bin.label} className="flex h-full min-w-0 flex-1 items-end gap-px" title={`${bin.label}: A ${bin.aCount}, B ${bin.bCount}`}><span className="w-1/2 bg-sky-600" style={{ height: `${Math.max(2, bin.aCount / maxBin * 100)}%` }} /><span className="w-1/2 bg-orange-500" style={{ height: `${Math.max(2, bin.bCount / maxBin * 100)}%` }} /></div>)}
        </div>}
      </div>;
    })}

    {result.categorical.map((category) => <div key={category.field} className="space-y-1 rounded-md border border-slate-200 p-2">
      <b className="text-slate-700">{category.field}</b>
      {category.values.slice(0, 6).map((value) => <div key={value.label} className="grid grid-cols-[minmax(0,1fr)_3rem_3rem] gap-1 tabular-nums"><span className="truncate text-slate-500">{value.label}</span><span className="text-right text-sky-700">{format(value.aShare * 100, 1)}%</span><span className="text-right text-orange-600">{format(value.bShare * 100, 1)}%</span></div>)}
    </div>)}

    {result.temporal && result.temporal.points.length > 0 && <div className="rounded-md border border-slate-200 p-2">
      <b className="text-slate-700">{result.temporal.field} · monthly trend</b>
      <div className="mt-1 max-h-28 overflow-y-auto"><table className="w-full tabular-nums"><thead className="text-slate-400"><tr><th className="text-left">Period</th><th className="text-right">A</th><th className="text-right">B</th></tr></thead><tbody>{result.temporal.points.map((point) => <tr key={point.period}><td>{point.period.slice(0, 7)}</td><td className="text-right text-sky-700">{point.aCount}</td><td className="text-right text-orange-600">{point.bCount}</td></tr>)}</tbody></table></div>
    </div>}
    <div className="flex items-center gap-3 text-slate-500"><span className="flex items-center gap-1"><span className="h-2 w-4 bg-sky-600" /> A · {cohortA.name}</span><span className="flex items-center gap-1"><span className="h-2 w-4 bg-orange-500" /> B · {cohortB?.name || 'Remainder'}</span><span className="flex items-center gap-1"><span className="h-2 w-4 bg-violet-600" /> overlap</span></div>
  </div>
);

export const CohortPanel = () => {
  const mapLayers = useStore((state) => state.mapLayers);
  const selectedLayerId = useStore((state) => state.selectedLayerId);
  const visualAnalytics = useStore((state) => state.visualAnalytics);
  const addCohort = useStore((state) => state.addCohort);
  const updateCohort = useStore((state) => state.updateCohort);
  const duplicateCohort = useStore((state) => state.duplicateCohort);
  const removeCohort = useStore((state) => state.removeCohort);
  const setComparison = useStore((state) => state.setCohortComparison);
  const addBookmark = useStore((state) => state.addBookmark);
  const updateBookmark = useStore((state) => state.updateBookmark);
  const removeBookmark = useStore((state) => state.removeBookmark);
  const restoreBookmark = useStore((state) => state.restoreBookmark);
  const addNode = useStore((state) => state.addNode);
  const onConnect = useStore((state) => state.onConnect);
  const addToast = useStore((state) => state.addToast);
  const mapCamera = useStore((state) => state.ui.mapCamera);
  const layer = mapLayers.find((item) => item.id === selectedLayerId) || null;
  const cohorts = layer ? visualAnalytics.cohorts.filter((cohort) => cohort.datasetId === layer.id) : [];
  const interaction = layer ? visualAnalytics.datasets[layer.id] : undefined;
  const [name, setName] = useState('');
  const [cohortAId, setCohortAId] = useState('');
  const [cohortBId, setCohortBId] = useState('remainder');
  const [isSavingSelection, setSavingSelection] = useState(false);
  const [comparisonResult, setComparisonResult] = useState<CohortComparisonResult | null>(null);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [isComparing, setComparing] = useState(false);
  const [bookmarkName, setBookmarkName] = useState('');
  const [bookmarkNote, setBookmarkNote] = useState('');
  const comparison = visualAnalytics.comparison;
  const cohortA = comparison ? visualAnalytics.cohorts.find((cohort) => cohort.id === comparison.cohortAId) : undefined;
  const cohortB = comparison?.cohortBId ? visualAnalytics.cohorts.find((cohort) => cohort.id === comparison.cohortBId) : undefined;

  useEffect(() => {
    if (!cohortAId && cohorts.length) setCohortAId(cohorts[0].id);
    if (cohortAId && !cohorts.some((cohort) => cohort.id === cohortAId)) setCohortAId(cohorts[0]?.id || '');
    if (cohortBId === cohortAId) setCohortBId('remainder');
  }, [cohorts, cohortAId, cohortBId]);

  useEffect(() => {
    let cancelled = false;
    if (!layer || !comparison || comparison.datasetId !== layer.id || !cohortA) { setComparisonResult(null); return; }
    setComparing(true);
    setComparisonError(null);
    queryCohortComparison({ layer, cohortA, cohortB, compareToRemainder: comparison.compareToRemainder, remainderFilters: interaction?.filters || [] })
      .then((result) => { if (!cancelled) setComparisonResult(result); })
      .catch((error) => { if (!cancelled) { setComparisonResult(null); setComparisonError(error?.message || 'Comparison failed'); } })
      .finally(() => { if (!cancelled) setComparing(false); });
    return () => { cancelled = true; };
  }, [layer?.id, layer?.styleVersion, comparison?.cohortAId, comparison?.cohortBId, comparison?.compareToRemainder, cohortA, cohortB, interaction?.filters]);

  const nextName = (fallback: string) => name.trim() || fallback;
  const saveActive = () => {
    if (!layer) return;
    addCohort({ id: `cohort-${Date.now()}`, datasetId: layer.id, name: nextName('Active subset'), colour: COHORT_COLOURS[cohorts.length % COHORT_COLOURS.length], definition: { kind: 'filters', filters: structuredClone(interaction?.filters || []) }, createdAt: Date.now() });
    setName('');
  };

  const saveSelection = async () => {
    if (!layer || !interaction?.selectedFeatureIds.length) return;
    setSavingSelection(true);
    const id = `cohort-${Date.now()}`;
    try {
      const materialised = await materializeLayerSelection({ layer, featureIds: interaction.selectedFeatureIds, outputTableName: `alur_${id.replace(/-/g, '_')}` });
      if (!materialised) throw new Error('This selection could not be materialised as a reusable cohort.');
      addCohort({ id, datasetId: layer.id, name: nextName('Selected records'), colour: COHORT_COLOURS[cohorts.length % COHORT_COLOURS.length], definition: { kind: 'selection-table', tableName: materialised.source.tableName }, createdAt: Date.now() });
      setName('');
    } catch (error: any) {
      addToast({ type: 'error', message: error?.message || 'Could not save the selection cohort.' });
    } finally {
      setSavingSelection(false);
    }
  };

  const compare = () => {
    if (!layer || !cohortAId) return;
    setComparison({ datasetId: layer.id, cohortAId, cohortBId: cohortBId === 'remainder' ? undefined : cohortBId, compareToRemainder: cohortBId === 'remainder' });
  };

  const createFilterNode = (cohort: CohortSpec) => {
    if (cohort.definition.kind !== 'filters') return;
    const id = `filter-${Date.now()}`;
    const condition = compileVisualFiltersWhereClause(cohort.definition.filters).replace(/^WHERE\s+/i, '') || 'TRUE';
    addNode({ id, type: 'filter', position: nextNodePosition(useStore.getState().nodes), data: { label: cohort.name, type: 'filter', config: { condition, cohortId: cohort.id } } });
    if (layer?.sourceNodeId) onConnect({ source: layer.sourceNodeId, target: id, sourceHandle: null, targetHandle: null });
    addToast({ type: 'success', message: `Created a workflow filter node from ${cohort.name}` });
  };

  const saveBookmark = () => {
    const title = bookmarkName.trim();
    if (!title) return;
    const bookmark: AnalyticalBookmark = {
      id: `bookmark-${Date.now()}`,
      name: title,
      note: bookmarkNote.trim() || undefined,
      createdAt: Date.now(),
      datasetId: selectedLayerId,
      filtersByDataset: Object.fromEntries(Object.entries(visualAnalytics.datasets).map(([id, value]) => [id, structuredClone(value.filters)])),
      cohorts: structuredClone(visualAnalytics.cohorts),
      mapCamera: { ...mapCamera },
      charts: structuredClone(visualAnalytics.charts),
      kpis: structuredClone(visualAnalytics.kpis),
    };
    addBookmark(bookmark);
    setBookmarkName('');
    setBookmarkNote('');
    addToast({ type: 'success', message: `Saved analytical bookmark ${title}` });
  };

  const bookmarks = visualAnalytics.bookmarks;

  return (
    <section className="border-t border-slate-200 bg-white">
      <div className="flex items-center justify-between px-3 py-2"><h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><Users className="h-3.5 w-3.5" /> Cohorts</h3>{comparison && <button type="button" onClick={() => setComparison(undefined)} className="rounded p-1 text-slate-400 hover:bg-slate-100" title="Close comparison"><X className="h-3.5 w-3.5" /></button>}</div>
      {!layer ? <p className="px-3 pb-3 text-[10px] text-slate-400">Select a layer to save and compare subsets.</p> : <div className="space-y-3 px-3 pb-3">
        <div className="space-y-1.5 rounded-md border border-slate-200 bg-slate-50 p-2">
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Cohort name (optional)" className="h-7 w-full rounded border border-slate-200 bg-white px-2 text-[10px] outline-none focus:border-sky-400" />
          <div className="grid grid-cols-2 gap-1.5"><button type="button" onClick={saveActive} className="flex h-7 items-center justify-center gap-1 rounded bg-white text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-sky-50"><Plus className="h-3 w-3" /> Active subset</button><button type="button" onClick={() => { void saveSelection(); }} disabled={!interaction?.selectedFeatureIds.length || isSavingSelection} className="flex h-7 items-center justify-center gap-1 rounded bg-white text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-sky-50 disabled:opacity-40">{isSavingSelection ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Selection</button></div>
        </div>

        {cohorts.map((cohort) => <div key={cohort.id} className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1.5">
          <input type="color" value={cohort.colour} onChange={(event) => updateCohort(cohort.id, { colour: event.target.value })} className="h-5 w-5 cursor-pointer border-0 bg-transparent p-0" aria-label={`Colour for ${cohort.name}`} />
          <input value={cohort.name} onChange={(event) => updateCohort(cohort.id, { name: event.target.value })} className="min-w-0 flex-1 bg-transparent text-[10px] font-semibold text-slate-600 outline-none" aria-label="Cohort name" />
          <span className="rounded bg-slate-100 px-1 text-[8px] uppercase text-slate-400">{cohort.definition.kind === 'filters' ? 'filters' : 'selection'}</span>
          {cohort.definition.kind === 'filters' && <button type="button" onClick={() => createFilterNode(cohort)} className="rounded p-1 text-slate-400 hover:bg-slate-100" title="Create workflow filter node"><GitBranch className="h-3 w-3" /></button>}
          <button type="button" onClick={() => duplicateCohort(cohort.id)} className="rounded p-1 text-slate-400 hover:bg-slate-100" title="Duplicate cohort"><Copy className="h-3 w-3" /></button>
          <button type="button" onClick={() => removeCohort(cohort.id)} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Remove cohort"><Trash2 className="h-3 w-3" /></button>
        </div>)}

        {cohorts.length > 0 && <div className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
          <select value={cohortAId} onChange={(event) => setCohortAId(event.target.value)} className="h-7 min-w-0 rounded border border-slate-200 bg-white px-1 text-[9px]"><option value="">Cohort A</option>{cohorts.map((cohort) => <option key={cohort.id} value={cohort.id}>{cohort.name}</option>)}</select>
          <select value={cohortBId} onChange={(event) => setCohortBId(event.target.value)} className="h-7 min-w-0 rounded border border-slate-200 bg-white px-1 text-[9px]"><option value="remainder">Active remainder</option>{cohorts.filter((cohort) => cohort.id !== cohortAId).map((cohort) => <option key={cohort.id} value={cohort.id}>{cohort.name}</option>)}</select>
          <button type="button" onClick={compare} disabled={!cohortAId} className="rounded bg-slate-900 px-2 text-[9px] font-bold text-white disabled:opacity-40">Compare</button>
        </div>}
        {comparison && (cohortA?.definition.kind === 'selection-table' || cohortB?.definition.kind === 'selection-table') && <p className="rounded bg-amber-50 px-2 py-1.5 text-[9px] leading-4 text-amber-700">Selection-table cohorts are compared in DuckDB. Simultaneous map colouring is available when both cohorts have filter definitions.</p>}
        {isComparing && <div className="flex items-center justify-center gap-2 py-3 text-[10px] text-slate-400"><Loader2 className="h-3 w-3 animate-spin" /> Comparing cohorts…</div>}
        {comparisonError && <div className="rounded bg-rose-50 px-2 py-1.5 text-[10px] text-rose-600">{comparisonError}</div>}
      </div>}
      {comparisonResult && cohortA && <ComparisonResult result={comparisonResult} cohortA={cohortA} cohortB={cohortB} />}

      <div className="border-t px-3 py-2"><h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><Bookmark className="h-3.5 w-3.5" /> Bookmarks</h3></div>
      <div className="space-y-2 px-3 pb-3">
        <input value={bookmarkName} onChange={(event) => setBookmarkName(event.target.value)} placeholder="Bookmark name" className="h-7 w-full rounded border border-slate-200 px-2 text-[10px] outline-none focus:border-sky-400" />
        <textarea value={bookmarkNote} onChange={(event) => setBookmarkNote(event.target.value)} placeholder="Optional note" className="h-12 w-full resize-none rounded border border-slate-200 p-2 text-[10px] outline-none focus:border-sky-400" />
        <button type="button" onClick={saveBookmark} disabled={!bookmarkName.trim()} className="flex h-7 w-full items-center justify-center gap-1 rounded bg-slate-900 text-[10px] font-bold text-white disabled:opacity-40"><Bookmark className="h-3 w-3" /> Save analytical state</button>
        {bookmarks.map((bookmark) => <div key={bookmark.id} className="rounded-md border border-slate-200 p-2">
          <div className="flex items-center gap-1"><input value={bookmark.name} onChange={(event) => updateBookmark(bookmark.id, { name: event.target.value })} className="min-w-0 flex-1 text-[10px] font-semibold text-slate-700 outline-none" aria-label="Bookmark name" /><button type="button" onClick={() => restoreBookmark(bookmark.id)} className="rounded px-1.5 py-1 text-[9px] font-bold text-sky-700 hover:bg-sky-50">Restore</button><button type="button" onClick={() => removeBookmark(bookmark.id)} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Delete bookmark"><Trash2 className="h-3 w-3" /></button></div>
          {bookmark.note && <p className="mt-1 text-[9px] leading-4 text-slate-400">{bookmark.note}</p>}
        </div>)}
      </div>
    </section>
  );
};
