import { useEffect, useMemo, useState } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertCircle, ArrowDown, ArrowUp, BarChart3, Database, GripVertical, Map, Maximize2, Minimize2, MonitorPlay, NotebookPen, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { duckdbService } from '../../services/duckdb';
import { useStore } from '../../store/useStore';
import type { ComparisonResult, ExplainCard, ExplainCardKind } from '../../types/visualAnalytics';
import { quoteIdentifier } from '../../utils/visualFilterSql';
import { cn } from '../../utils/cn';
import { queryComparison } from '../../services/comparisonService';

const widthClass: Record<ExplainCard['width'], string> = { 3: 'md:col-span-3', 4: 'md:col-span-3 xl:col-span-4', 6: 'md:col-span-3 xl:col-span-6', 8: 'md:col-span-6 xl:col-span-8', 12: 'md:col-span-6 xl:col-span-12' };
const heightClass: Record<ExplainCard['height'], string> = { compact: 'min-h-32', standard: 'min-h-56', tall: 'min-h-80' };
const widths: ExplainCard['width'][] = [3, 4, 6, 8, 12];

const ComparisonEvidence = ({ result, card }: { result: ComparisonResult; card: ExplainCard }) => {
  const spec = card.provenance?.comparisonSpec;
  const max = Math.max(1, ...result.summaries.flatMap((summary) => summary.values.map((item) => item.value || 0)));
  return <div className="space-y-4">{result.summaries.map((summary) => <div key={summary.measureId}><h4 className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{spec?.measures.find((item) => item.id === summary.measureId)?.label || summary.measureId}</h4><div className="mt-2 space-y-2">{summary.values.map((value) => { const operand = spec?.operands.find((item) => item.id === value.operandId); return <div key={value.operandId} className="grid grid-cols-[100px_1fr_64px] items-center gap-2 text-[10px]"><span className="truncate font-semibold text-slate-600">{operand?.label || value.operandId}</span><div className="h-2 rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${Math.max(2, ((value.value || 0) / max) * 100)}%`, backgroundColor: operand?.colour || '#64748b' }} /></div><span className="text-right tabular-nums">{value.value?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? '—'}</span></div>; })}</div></div>)}</div>;
};

const CardContent = ({ card }: { card: ExplainCard }) => {
  const update = useStore((state) => state.updateExplainCard);
  const dataset = useStore((state) => card.datasetId ? state.datasetRegistry[card.datasetId] : undefined);
  const chart = useStore((state) => state.visualAnalytics.charts.find((item) => item.id === card.referenceId));
  const kpi = useStore((state) => state.visualAnalytics.kpis.find((item) => item.id === card.referenceId));
  if (card.kind === 'comparison') return card.frozenValues ? <ComparisonEvidence result={card.frozenValues as ComparisonResult} card={card} /> : <p className="text-xs text-slate-400">Comparison evidence has no captured values.</p>;
  if (card.kind === 'table') {
    const preview = Array.isArray(card.frozenValues) ? card.frozenValues as Array<Record<string, unknown>> : [];
    const columns = preview.length ? Object.keys(preview[0]).slice(0, 6) : dataset?.fields.slice(0, 6).map((field) => field.name) || [];
    return <div><div className="flex items-center gap-2"><Database className="h-4 w-4 text-teal-600" /><h3 className="text-sm font-bold text-slate-800">{card.title || dataset?.name || 'Table preview'}</h3></div>{preview.length ? <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200"><table className="w-full text-left text-[10px]"><thead className="bg-slate-50 text-slate-500"><tr>{columns.map((column) => <th key={column} className="whitespace-nowrap px-2 py-1.5 font-bold">{column}</th>)}</tr></thead><tbody>{preview.slice(0, 10).map((row, index) => <tr key={index} className="border-t border-slate-100">{columns.map((column) => <td key={column} className="max-w-40 truncate px-2 py-1.5 text-slate-600">{String(row[column] ?? '—')}</td>)}</tr>)}</tbody></table></div> : <p className="mt-4 text-xs text-slate-400">No bounded rows were captured.</p>}</div>;
  }
  if (card.kind === 'finding') return <div><NotebookPen className="h-5 w-5 text-amber-500" /><input value={card.claim || ''} onChange={(event) => update(card.id, { claim: event.target.value })} placeholder="Claim" className="mt-3 w-full text-sm font-extrabold text-slate-800 outline-none" /><textarea value={card.interpretation || ''} onChange={(event) => update(card.id, { interpretation: event.target.value })} placeholder="Interpretation and evidence linkage" className="mt-3 min-h-20 w-full resize-none text-xs leading-5 text-slate-600 outline-none" /><input value={card.caveat || ''} onChange={(event) => update(card.id, { caveat: event.target.value })} placeholder="Caveat or limitation" className="mt-2 w-full rounded-md bg-amber-50 px-2 py-1.5 text-[10px] text-amber-800 outline-none" /><select value={card.conclusionStatus || 'draft'} onChange={(event) => update(card.id, { conclusionStatus: event.target.value as ExplainCard['conclusionStatus'] })} className="mt-3 rounded-md border border-slate-200 px-2 py-1 text-[10px]"><option value="draft">Draft</option><option value="supported">Supported</option><option value="contested">Contested</option></select></div>;
  if (card.kind === 'map') return <div className="flex h-full min-h-32 items-center justify-center rounded-lg bg-slate-100 text-center"><div><Map className="mx-auto h-6 w-6 text-slate-400" /><p className="mt-2 text-xs font-semibold text-slate-600">Replayable map view</p><p className="mt-1 text-[10px] text-slate-400">Camera, visible layers, legend, and source fingerprint preserved.</p></div></div>;
  if (card.kind === 'chart') return <div><BarChart3 className="h-5 w-5 text-blue-600" /><h3 className="mt-3 text-sm font-bold text-slate-800">{card.title || chart?.title || 'Chart'}</h3><p className="mt-2 text-xs text-slate-500">{chart ? `${chart.type} · ${chart.dimensionField} · ${chart.aggregation}` : 'The source chart is no longer available.'}</p>{card.frozenValues ? <pre className="mt-3 max-h-36 overflow-auto text-[9px] text-slate-400">{JSON.stringify(card.frozenValues, null, 2)}</pre> : null}</div>;
  if (card.kind === 'kpi') return <div><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{card.title || kpi?.title || 'Metric'}</p><p className="mt-6 text-4xl font-black tabular-nums text-slate-900">{typeof card.frozenValues === 'number' ? card.frozenValues.toLocaleString() : '—'}</p><p className="mt-2 text-[10px] text-slate-400">Baseline, delta, denominator, and status are preserved when captured.</p></div>;
  return <div className="flex h-full flex-col"><NotebookPen className="h-5 w-5 text-amber-500" /><input value={card.title || ''} onChange={(event) => update(card.id, { title: event.target.value })} placeholder="Heading" className="mt-3 text-sm font-extrabold text-slate-800 outline-none" /><textarea value={card.note || ''} onChange={(event) => update(card.id, { note: event.target.value })} placeholder="Write an interpretation, caveat, or next step…" className="mt-3 min-h-20 flex-1 resize-none text-xs leading-5 text-slate-600 outline-none" /></div>;
};

const SortableCard = ({ card, presenting }: { card: ExplainCard; presenting: boolean }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id, disabled: presenting });
  const update = useStore((state) => state.updateExplainCard);
  const remove = useStore((state) => state.removeExplainCard);
  const registry = useStore((state) => state.datasetRegistry);
  const addToast = useStore((state) => state.addToast);
  const currentWidth = widths.indexOf(card.width);
  const sourceIds = card.provenance?.datasetIds || [];
  const sourceMissing = sourceIds.some((id) => !registry[id]);
  const sourceChanged = !sourceMissing && sourceIds.some((id) => card.provenance?.sourceVersions[id] !== undefined && card.provenance?.sourceVersions[id] !== registry[id]?.sourceUpdatedAt);
  const refresh = async () => {
    if (sourceMissing) return;
    let frozenValues = card.frozenValues;
    try {
      if (card.kind === 'table' && card.datasetId && registry[card.datasetId]?.relationName) {
        const result = await duckdbService.query(`SELECT * FROM ${quoteIdentifier(registry[card.datasetId].relationName!)} LIMIT 10;`);
        frozenValues = result.toArray().map((row) => Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([key, value]) => [key, typeof value === 'bigint' ? Number(value) : value])));
      } else if (card.kind === 'comparison' && card.provenance?.comparisonSpec) frozenValues = await queryComparison(card.provenance.comparisonSpec, registry);
      update(card.id, { frozenValues, provenance: { ...card.provenance!, capturedAt: Date.now(), sourceVersions: Object.fromEntries(sourceIds.map((id) => [id, registry[id]?.sourceUpdatedAt])) } });
      addToast({ type: 'success', message: 'Frozen evidence refreshed explicitly.' });
    } catch { addToast({ type: 'error', message: 'Could not refresh this evidence.' }); }
  };
  useEffect(() => {
    if (card.behaviour === 'live' && sourceChanged && !sourceMissing) void refresh();
  }, [card.behaviour, sourceChanged, sourceMissing]);
  return <article ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn('relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm', widthClass[card.width], heightClass[card.height], isDragging && 'z-20 opacity-70 shadow-xl')}>
    {!presenting && <div className="absolute right-2 top-2 z-10 flex rounded-md border border-slate-100 bg-white/95 p-0.5 shadow-sm"><button type="button" {...attributes} {...listeners} className="cursor-grab rounded p-1.5 text-slate-400 hover:bg-slate-50" aria-label={`Reorder ${card.title || card.kind}`}><GripVertical className="h-3.5 w-3.5" /></button>{card.provenance && <button type="button" onClick={() => void refresh()} disabled={sourceMissing} className="rounded p-1.5 text-slate-400 hover:bg-slate-50 disabled:opacity-30" aria-label="Refresh frozen evidence"><RefreshCw className="h-3.5 w-3.5" /></button>}<button type="button" onClick={() => update(card.id, { behaviour: card.behaviour === 'frozen' ? 'live' : 'frozen' })} className="rounded px-1.5 text-[9px] font-bold text-slate-400 hover:bg-slate-50" aria-label={`Make card ${card.behaviour === 'frozen' ? 'live' : 'frozen'}`}>{card.behaviour === 'frozen' ? 'Live' : 'Freeze'}</button><button type="button" onClick={() => update(card.id, { width: widths[Math.min(widths.length - 1, currentWidth + 1)] })} className="rounded p-1.5 text-slate-400 hover:bg-slate-50" aria-label="Widen card"><Maximize2 className="h-3.5 w-3.5" /></button><button type="button" onClick={() => update(card.id, { width: widths[Math.max(0, currentWidth - 1)] })} className="rounded p-1.5 text-slate-400 hover:bg-slate-50" aria-label="Narrow card"><Minimize2 className="h-3.5 w-3.5" /></button><button type="button" onClick={() => remove(card.id)} className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Remove card"><Trash2 className="h-3.5 w-3.5" /></button></div>}
    {(sourceMissing || sourceChanged) && <div className={cn('mb-3 mr-28 rounded-md px-2 py-1 text-[9px] font-bold', sourceMissing ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700')}>{sourceMissing ? 'Source missing — frozen evidence retained' : 'Source changed — refresh is optional'}</div>}
    <CardContent card={card} />
    <div className="absolute bottom-2 right-3 flex items-center gap-1 text-[9px] font-semibold text-slate-300">{card.behaviour === 'live' ? <><RefreshCw className="h-2.5 w-2.5" /> Live</> : 'Frozen'}</div>
  </article>;
};

export const ExplainWorkspace = () => {
  const explain = useStore((state) => state.visualAnalytics.explain);
  const datasets = useStore((state) => Object.values(state.datasetRegistry));
  const setTitle = useStore((state) => state.setExplainTitle);
  const addSection = useStore((state) => state.addExplainSection);
  const updateSection = useStore((state) => state.updateExplainSection);
  const reorderSection = useStore((state) => state.reorderExplainSection);
  const addCard = useStore((state) => state.addExplainCard);
  const reorderCard = useStore((state) => state.reorderExplainCard);
  const setPresenting = useStore((state) => state.setPresentationMode);
  const presenting = useStore((state) => state.ui.isPresentationMode);
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const [addMenu, setAddMenu] = useState(false);
  const cardsBySection = useMemo(() => Object.fromEntries(explain.sections.map((section) => [section.id, explain.cards.filter((card) => card.sectionId === section.id)])), [explain]);

  const add = async (kind: ExplainCardKind, sectionId = 'evidence') => {
    const dataset = datasets[0];
    const card: ExplainCard = { id: `explain-${kind}-${Date.now()}`, sectionId, kind, datasetId: kind === 'table' ? dataset?.id : undefined, title: kind === 'finding' ? 'Finding' : kind === 'note' ? 'Note' : undefined, width: kind === 'comparison' || kind === 'map' ? 12 : 6, height: kind === 'finding' ? 'standard' : 'compact', behaviour: 'frozen', provenance: { capturedAt: Date.now(), datasetIds: dataset && kind === 'table' ? [dataset.id] : [], sourceVersions: dataset ? { [dataset.id]: dataset.sourceUpdatedAt } : {}, filtersByDataset: {}, caveats: [] } };
    if (kind === 'finding') { card.claim = ''; card.interpretation = ''; card.caveat = ''; card.conclusionStatus = 'draft'; }
    if (kind === 'note') card.note = '';
    if (kind === 'table' && dataset?.relationName) try {
      const result = await duckdbService.query(`SELECT * FROM ${quoteIdentifier(dataset.relationName)} LIMIT 10;`);
      card.frozenValues = result.toArray().map((row) => Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([key, value]) => [key, typeof value === 'bigint' ? Number(value) : value])));
    } catch { card.provenance?.caveats.push('The bounded table preview could not be captured.'); }
    addCard(card); setAddMenu(false);
  };
  const dragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const activeCard = explain.cards.find((card) => card.id === active.id);
    const overCard = explain.cards.find((card) => card.id === over.id);
    if (!activeCard || !overCard) return;
    const targetCards = cardsBySection[overCard.sectionId] || [];
    const oldIndex = targetCards.findIndex((card) => card.id === active.id);
    const newIndex = targetCards.findIndex((card) => card.id === over.id);
    const ordered = oldIndex >= 0 ? arrayMove(targetCards, oldIndex, newIndex) : targetCards;
    reorderCard(activeCard.id, overCard.sectionId, Math.max(0, ordered.findIndex((card) => card.id === activeCard.id)));
  };

  return <main className={cn('min-h-0 flex-1 overflow-y-auto bg-slate-50 print:overflow-visible print:bg-white', presenting && 'bg-white')}>
    <div className="mx-auto max-w-[1500px] p-5 md:p-8 print:max-w-none print:p-0">
      <header className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm print:border-0 print:shadow-none"><input value={explain.title} readOnly={presenting} onChange={(event) => setTitle(event.target.value)} className="min-w-52 flex-1 bg-transparent text-xl font-black text-slate-900 outline-none" aria-label="Explanation title" />{!presenting && <div className="relative"><button type="button" onClick={() => setAddMenu(!addMenu)} className="flex h-8 items-center gap-1.5 rounded-md border border-slate-200 px-3 text-[10px] font-bold text-slate-700"><Plus className="h-3.5 w-3.5" /> Add evidence</button>{addMenu && <div className="absolute right-0 top-10 z-30 grid w-48 rounded-lg border border-slate-200 bg-white p-1 shadow-xl">{(['finding', 'note', 'table', 'map'] as const).map((kind) => <button key={kind} type="button" onClick={() => void add(kind)} disabled={kind === 'table' && !datasets.length} className="rounded px-3 py-2 text-left text-[11px] font-semibold capitalize text-slate-600 hover:bg-slate-50 disabled:opacity-40">{kind}</button>)}</div>}</div>}<button type="button" onClick={() => setPresenting(!presenting)} className="flex h-8 items-center gap-1.5 rounded-md bg-slate-900 px-3 text-[10px] font-bold text-white"><MonitorPlay className="h-3.5 w-3.5" />{presenting ? 'Exit presentation' : 'Present'}</button></header>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}><div className="mt-6 space-y-8">{explain.sections.map((section, sectionIndex) => { const sectionCards = cardsBySection[section.id] || []; return <section key={section.id} className="break-inside-avoid"><div className="mb-3 flex items-center gap-2 border-b border-slate-200 pb-2"><input value={section.title} readOnly={presenting} onChange={(event) => updateSection(section.id, { title: event.target.value })} className="min-w-0 flex-1 bg-transparent text-sm font-extrabold uppercase tracking-[.12em] text-slate-500 outline-none" aria-label="Section title" />{!presenting && <><button type="button" disabled={sectionIndex === 0} onClick={() => reorderSection(section.id, sectionIndex - 1)} className="p-1 text-slate-400 disabled:opacity-20" aria-label={`Move ${section.title} up`}><ArrowUp className="h-3.5 w-3.5" /></button><button type="button" disabled={sectionIndex === explain.sections.length - 1} onClick={() => reorderSection(section.id, sectionIndex + 1)} className="p-1 text-slate-400 disabled:opacity-20" aria-label={`Move ${section.title} down`}><ArrowDown className="h-3.5 w-3.5" /></button></>}</div><SortableContext items={sectionCards.map((card) => card.id)} strategy={verticalListSortingStrategy}><div className="grid grid-cols-1 gap-4 md:grid-cols-6 xl:grid-cols-12">{sectionCards.map((card) => <SortableCard key={card.id} card={card} presenting={presenting} />)}{!sectionCards.length && !presenting && <button type="button" onClick={() => void add(section.id === 'evidence' ? 'table' : section.id === 'interpretation' || section.id === 'conclusion' ? 'finding' : 'note', section.id)} className="col-span-full flex min-h-20 items-center justify-center rounded-xl border border-dashed border-slate-200 text-xs font-semibold text-slate-600 hover:border-blue-300 hover:text-blue-700"><Plus className="mr-1 h-3.5 w-3.5" /> Add to {section.title}</button>}</div></SortableContext></section>; })}</div></DndContext>
      {!presenting && <button type="button" onClick={() => addSection({ id: `section-${Date.now()}`, title: 'New section' })} className="mt-8 flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs font-bold text-slate-500"><Plus className="h-3.5 w-3.5" /> Add section</button>}
      {explain.cards.some((card) => card.provenance?.caveats.length) && <div className="mt-8 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-[10px] text-amber-800"><AlertCircle className="h-3.5 w-3.5 shrink-0" /> Frozen evidence retains caveats and source fingerprints. Refresh is always explicit.</div>}
    </div>
  </main>;
};
