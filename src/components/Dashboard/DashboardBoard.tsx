import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Database, Gauge, Maximize2, Minimize2, MonitorPlay, NotebookPen, Plus, Trash2 } from 'lucide-react';
import { useStore } from '../../store/useStore';
import type { DashboardCard, KpiResult, VisualChartResult } from '../../types/visualAnalytics';
import type { DatasetDescriptor } from '../../types/datasets';
import { chartDatasetId } from '../../utils/datasetSource';
import { queryLayerChart, queryLayerKpi, queryTableChart, queryTableKpi } from '../../services/visualAnalyticsService';

const heightClass = (height: DashboardCard['height']) => height === 'compact' ? 'min-h-36' : height === 'tall' ? 'min-h-80' : 'min-h-56';

const CardFrame = ({ card, children }: { card: DashboardCard; children: React.ReactNode }) => {
  const presenting = useStore((state) => state.ui.isPresentationMode);
  const update = useStore((state) => state.updateDashboardCard);
  const remove = useStore((state) => state.removeDashboardCard);
  return (
    <article className={`relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${card.width === 2 ? 'lg:col-span-2' : ''} ${heightClass(card.height)}`}>
      {!presenting && <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md bg-white/90 p-0.5 shadow-sm">
        <button type="button" onClick={() => update(card.id, { width: card.width === 1 ? 2 : 1 })} className="pressable rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={`${card.width === 1 ? 'Widen' : 'Narrow'} ${card.title || card.kind} card`}>{card.width === 1 ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}</button>
        <button type="button" onClick={() => remove(card.id)} className="pressable rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label={`Remove ${card.title || card.kind} card`}><Trash2 className="h-3.5 w-3.5" /></button>
      </div>}
      {children}
    </article>
  );
};

const MiniChart = ({ card }: { card: DashboardCard }) => {
  const chart = useStore((state) => state.visualAnalytics.charts.find((item) => item.id === card.referenceId));
  const layers = useStore((state) => state.mapLayers);
  const registry = useStore((state) => state.datasetRegistry);
  const filters = useStore((state) => chart ? state.visualAnalytics.datasets[chartDatasetId(chart)]?.filters || [] : []);
  const [result, setResult] = useState<VisualChartResult | null>(null);
  const [error, setError] = useState(false);
  const filtersKey = JSON.stringify(filters);
  useEffect(() => {
    if (!chart || ['line', 'area', 'scatter'].includes(chart.type)) { setResult(null); return; }
    let cancelled = false;
    const datasetId = chartDatasetId(chart);
    const layer = layers.find((item) => item.id === datasetId);
    const dataset = registry[datasetId];
    const query = layer
      ? queryLayerChart({ layer, filters, chart })
      : dataset?.relationName ? queryTableChart({ tableName: dataset.relationName, rowIdColumn: dataset.rowIdColumn, filters, chart }) : Promise.reject(new Error('Dataset unavailable'));
    setError(false);
    void query.then((next) => { if (!cancelled) setResult(next); }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [chart, layers, registry, filtersKey]);
  if (!chart) return <p className="text-xs text-slate-400">The referenced chart is no longer available.</p>;
  const max = Math.max(...(result?.data || []).map((item) => item.totalValue), 1);
  return <div>
    <h2 className="pr-16 text-sm font-extrabold text-slate-800">{card.title || chart.title}</h2>
    <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">{chart.aggregation} · {chart.dimensionField}</p>
    {['line', 'area', 'scatter'].includes(chart.type) ? <p className="mt-8 text-xs text-slate-500">Interactive {chart.type} chart · open Charts to explore and brush.</p> : error ? <p className="mt-8 text-xs text-rose-500">Chart query failed.</p> : !result ? <p className="mt-8 text-xs text-slate-400" role="status">Loading chart…</p> : <div className="mt-4 space-y-2" role="img" aria-label={`${chart.title}. ${result.filteredRows} active of ${result.totalRows} rows.`}>{result.data.slice(0, 8).map((datum) => <div key={datum.key} className="grid grid-cols-[minmax(5rem,1fr)_3fr_3rem] items-center gap-2 text-[10px]"><span className="truncate font-semibold text-slate-600">{datum.label}</span><span className="h-2 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full" style={{ width: `${datum.value / max * 100}%`, backgroundColor: datum.color }} /></span><span className="text-right tabular-nums text-slate-500">{datum.value.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span></div>)}</div>}
  </div>;
};

const MiniKpi = ({ card }: { card: DashboardCard }) => {
  const spec = useStore((state) => state.visualAnalytics.kpis.find((item) => item.id === card.referenceId));
  const layer = useStore((state) => state.mapLayers.find((item) => item.id === spec?.datasetId));
  const dataset = useStore((state) => spec ? state.datasetRegistry[spec.datasetId] : undefined);
  const filters = useStore((state) => spec ? state.visualAnalytics.datasets[spec.datasetId]?.filters || [] : []);
  const selected = useStore((state) => spec ? state.visualAnalytics.datasets[spec.datasetId]?.selectedFeatureIds || [] : []);
  const [result, setResult] = useState<KpiResult | null>(null);
  const key = JSON.stringify([filters, selected]);
  useEffect(() => {
    if (!spec || !dataset) return;
    let cancelled = false;
    const query = layer ? queryLayerKpi({ layer, filters, spec, selectedFeatureIds: selected }) : dataset.relationName ? queryTableKpi({ tableName: dataset.relationName, rowIdColumn: dataset.rowIdColumn, filters, spec, selectedFeatureIds: selected }) : Promise.reject();
    void query.then((next) => { if (!cancelled) setResult(next); });
    return () => { cancelled = true; };
  }, [spec, dataset, layer, key]);
  if (!spec) return <p className="text-xs text-slate-400">The referenced metric is no longer available.</p>;
  return <div className="flex h-full flex-col justify-between"><div><Gauge className="h-5 w-5 text-sky-600" /><h2 className="mt-3 pr-16 text-xs font-bold uppercase tracking-wide text-slate-500">{card.title || spec.title}</h2></div><div className="mt-4 text-4xl font-black tabular-nums text-slate-900">{result?.value === null || result?.value === undefined ? '—' : result.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div><p className="mt-2 text-[10px] text-slate-400">{result ? `${result.activeRows.toLocaleString()} active / ${result.totalRows.toLocaleString()} total rows` : 'Calculating…'}</p></div>;
};

const DatasetCard = ({ card, dataset }: { card: DashboardCard; dataset?: DatasetDescriptor }) => {
  const setWorkspaceMode = useStore((state) => state.setWorkspaceMode);
  const openDrawerTab = useStore((state) => state.openDrawerTab);
  const selectLayer = useStore((state) => state.selectLayer);
  const setSelectedNodeId = useStore((state) => state.setSelectedNodeId);
  if (!dataset) return <p className="text-xs text-slate-400">The referenced dataset is no longer available.</p>;
  return <div><Database className="h-5 w-5 text-teal-600" /><h2 className="mt-3 pr-16 text-sm font-extrabold text-slate-800">{card.title || dataset.name}</h2><p className="mt-1 text-xs text-slate-500">{dataset.rowCount?.toLocaleString() || 'Unknown'} rows · {dataset.fields.length} fields</p><div className="mt-4 flex flex-wrap gap-1">{dataset.fields.slice(0, 8).map((field) => <span key={field.name} className="rounded bg-slate-100 px-2 py-1 text-[9px] text-slate-500">{field.name}</span>)}</div><button type="button" onClick={() => { if (dataset.source.kind === 'layer') selectLayer(dataset.id); else if (dataset.source.kind === 'workflow-node') setSelectedNodeId(dataset.source.nodeId); setWorkspaceMode('explore'); openDrawerTab('table'); }} className="pressable mt-5 rounded-md bg-slate-900 px-3 py-2 text-[11px] font-bold text-white">Explore table</button></div>;
};

export const DashboardBoard = () => {
  const dashboard = useStore((state) => state.visualAnalytics.dashboard || { title: 'Analysis board', cards: [] });
  const charts = useStore((state) => state.visualAnalytics.charts);
  const kpis = useStore((state) => state.visualAnalytics.kpis);
  const datasets = useStore((state) => Object.values(state.datasetRegistry));
  const interactions = useStore((state) => state.visualAnalytics.datasets);
  const bookmarks = useStore((state) => state.visualAnalytics.bookmarks);
  const presenting = useStore((state) => state.ui.isPresentationMode);
  const setPresenting = useStore((state) => state.setPresentationMode);
  const setTitle = useStore((state) => state.setDashboardTitle);
  const add = useStore((state) => state.addDashboardCard);
  const update = useStore((state) => state.updateDashboardCard);
  const restoreBookmark = useStore((state) => state.restoreBookmark);
  const activeFilters = useMemo(() => Object.entries(interactions).flatMap(([datasetId, state]) => state.filters.map((filter) => ({ datasetId, filter }))), [interactions]);
  const addCard = (kind: DashboardCard['kind']) => {
    const referenceId = kind === 'chart' ? charts[0]?.id : kind === 'kpi' ? kpis[0]?.id : undefined;
    const datasetId = kind === 'table' ? datasets[0]?.id : undefined;
    add({ id: `board-${kind}-${Date.now()}`, kind, referenceId, datasetId, title: kind === 'note' ? 'Finding' : undefined, note: kind === 'note' ? 'Add interpretation, caveats, or a decision here.' : undefined, width: kind === 'chart' ? 2 : 1, height: kind === 'note' ? 'compact' : 'standard' });
  };
  return <>
    <header className="col-span-full flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <input value={dashboard.title} readOnly={presenting} onChange={(event) => setTitle(event.target.value)} aria-label="Dashboard title" className="min-w-48 flex-1 bg-transparent text-lg font-black text-slate-900 outline-none" />
      {!presenting && <div className="flex items-center gap-1"><span className="mr-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Add</span>{(['chart', 'kpi', 'table', 'note'] as const).map((kind) => <button key={kind} type="button" onClick={() => addCard(kind)} disabled={(kind === 'chart' && !charts.length) || (kind === 'kpi' && !kpis.length) || (kind === 'table' && !datasets.length)} className="pressable flex h-8 items-center gap-1 rounded-md border border-slate-200 px-2 text-[10px] font-bold capitalize text-slate-600 hover:bg-slate-50 disabled:opacity-30"><Plus className="h-3 w-3" />{kind}</button>)}</div>}
      {bookmarks.length > 0 && <select defaultValue="" onChange={(event) => { if (event.target.value) restoreBookmark(event.target.value); }} aria-label="Apply bookmark presentation state" className="h-8 rounded-md border border-slate-200 bg-white px-2 text-[10px] text-slate-600"><option value="">Presentation state…</option>{bookmarks.map((bookmark) => <option key={bookmark.id} value={bookmark.id}>{bookmark.name}</option>)}</select>}
      <button type="button" onClick={() => setPresenting(!presenting)} className="pressable flex h-8 items-center gap-1.5 rounded-md bg-slate-900 px-3 text-[10px] font-bold text-white"><MonitorPlay className="h-3.5 w-3.5" />{presenting ? 'Edit board' : 'Present'}</button>
      {activeFilters.length > 0 && <div className="basis-full border-t border-slate-100 pt-2" aria-label="Shared dashboard filters"><span className="mr-2 text-[9px] font-bold uppercase tracking-wide text-slate-400">Shared filters</span>{activeFilters.map(({ datasetId, filter }, index) => <span key={`${datasetId}-${filter.field}-${index}`} className="mr-1 inline-flex rounded-full bg-sky-50 px-2 py-1 text-[9px] font-semibold text-sky-700">{datasets.find((item) => item.id === datasetId)?.name || datasetId}: {filter.field}</span>)}</div>}
    </header>
    {dashboard.cards.map((card) => <CardFrame key={card.id} card={card}>{card.kind === 'chart' ? <MiniChart card={card} /> : card.kind === 'kpi' ? <MiniKpi card={card} /> : card.kind === 'table' ? <DatasetCard card={card} dataset={datasets.find((item) => item.id === card.datasetId)} /> : <div className="flex h-full flex-col"><NotebookPen className="h-5 w-5 text-amber-500" /><input value={card.title || ''} readOnly={presenting} onChange={(event) => update(card.id, { title: event.target.value })} aria-label="Note title" className="mt-3 pr-16 text-sm font-extrabold text-slate-800 outline-none" /><textarea value={card.note || ''} readOnly={presenting} onChange={(event) => update(card.id, { note: event.target.value })} aria-label="Note text" className="mt-3 min-h-20 flex-1 resize-none text-xs leading-5 text-slate-600 outline-none" /></div>}</CardFrame>)}
    {!dashboard.cards.length && !presenting && <div className="col-span-full flex min-h-44 flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-white/60 text-center"><BarChart3 className="h-6 w-6 text-slate-300" /><p className="mt-2 text-xs font-semibold text-slate-500">Add charts, metrics, tables, and notes to assemble your story.</p></div>}
  </>;
};
