import { useEffect, useMemo, useState } from 'react';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertCircle, ArrowDown, ArrowUp, BarChart3, Database, GripVertical, Map, MonitorPlay, NotebookPen, PanelLeft, Plus, RefreshCw, SlidersHorizontal, Trash2 } from 'lucide-react';
import { duckdbService } from '../../services/duckdb';
import { useStore } from '../../store/useStore';
import type { ComparisonResult, ExplainCard, ExplainCardKind, ExplainDocument } from '../../types/visualAnalytics';
import { quoteIdentifier } from '../../utils/visualFilterSql';
import { cn } from '../../utils/cn';
import { queryComparison } from '../../services/comparisonService';
import { ComparisonMapEvidence, ComparisonRecordsEvidence } from '../Compare/ComparisonEvidenceViews';
import { ExplainOutline } from './ExplainOutline';
import { ExplainInspector } from './ExplainInspector';
import { evaluateExplainDocument } from '../../utils/explainEvidence';

const widthClass: Record<ExplainCard['width'], string> = { 3: 'md:col-span-3', 4: 'md:col-span-3 xl:col-span-4', 6: 'md:col-span-3 xl:col-span-6', 8: 'md:col-span-6 xl:col-span-8', 12: 'md:col-span-6 xl:col-span-12' };
const heightClass: Record<ExplainCard['height'], string> = { compact: 'min-h-32', standard: 'min-h-56', tall: 'min-h-80' };

const ComparisonEvidence = ({ result, card, presenting }: { result: ComparisonResult; card: ExplainCard; presenting: boolean }) => {
  const spec = card.provenance?.comparisonSpec;
  const [selectedKey, setSelectedKey] = useState<string>();
  const [mapMode, setMapMode] = useState<'multiples' | 'difference'>(card.comparisonMapMode || 'multiples');
  if (spec && card.comparisonView === 'map') return <ComparisonMapEvidence spec={spec} result={result} differenceEligible={spec.operands.length === 2 && spec.alignment.mode === 'entity-keyed' && Boolean(result.differenceSpatialSample)} selectedKey={selectedKey} onSelectKey={setSelectedKey} mode={mapMode} onModeChange={setMapMode} interactive={!presenting || card.presentationInteraction === 'interactive'} />;
  if (spec && card.comparisonView === 'records') return <ComparisonRecordsEvidence spec={spec} result={result} selectedKey={selectedKey} onSelectKey={setSelectedKey} />;
  const max = Math.max(1, ...result.summaries.flatMap((summary) => summary.values.map((item) => item.value || 0)));
  return <div className="space-y-4">{result.summaries.map((summary) => <div key={summary.measureId}><h4 className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{spec?.measures.find((item) => item.id === summary.measureId)?.label || summary.measureId}</h4><div className="mt-2 space-y-2">{summary.values.map((value) => { const operand = spec?.operands.find((item) => item.id === value.operandId); return <div key={value.operandId} className="grid grid-cols-[100px_1fr_64px] items-center gap-2 text-[10px]"><span className="truncate font-semibold text-slate-600">{operand?.label || value.operandId}</span><div className="h-2 rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${Math.max(2, ((value.value || 0) / max) * 100)}%`, backgroundColor: operand?.colour || '#64748b' }} /></div><span className="text-right tabular-nums">{value.value?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? '—'}</span></div>; })}</div></div>)}</div>;
};

const CardContent = ({ card, presenting = false }: { card: ExplainCard; presenting?: boolean }) => {
  const update = useStore((state) => state.updateExplainCard);
  const dataset = useStore((state) => card.datasetId ? state.datasetRegistry[card.datasetId] : undefined);
  const chart = useStore((state) => state.visualAnalytics.charts.find((item) => item.id === card.referenceId));
  const kpi = useStore((state) => state.visualAnalytics.kpis.find((item) => item.id === card.referenceId));
  if (card.kind === 'comparison') return card.frozenValues ? <ComparisonEvidence result={card.frozenValues as ComparisonResult} card={card} presenting={presenting} /> : <p className="text-xs text-slate-400">Comparison evidence has no captured values.</p>;
  if (card.kind === 'table') {
    const preview = Array.isArray(card.frozenValues) ? card.frozenValues as Array<Record<string, unknown>> : [];
    const columns = preview.length ? Object.keys(preview[0]).slice(0, 6) : dataset?.fields.slice(0, 6).map((field) => field.name) || [];
    return <div><div className="flex items-center gap-2"><Database className="h-4 w-4 text-teal-600" /><h3 className="text-sm font-bold text-slate-800">{card.title || dataset?.name || 'Table preview'}</h3></div>{preview.length ? <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200"><table className="w-full text-left text-[10px]"><thead className="bg-slate-50 text-slate-500"><tr>{columns.map((column) => <th key={column} className="whitespace-nowrap px-2 py-1.5 font-bold">{column}</th>)}</tr></thead><tbody>{preview.slice(0, 10).map((row, index) => <tr key={index} className="border-t border-slate-100">{columns.map((column) => <td key={column} className="max-w-40 truncate px-2 py-1.5 text-slate-600">{String(row[column] ?? '—')}</td>)}</tr>)}</tbody></table></div> : <p className="mt-4 text-xs text-slate-400">No bounded rows were captured.</p>}</div>;
  }
  if (card.kind === 'finding') return <div><div className="flex flex-wrap items-center gap-2"><NotebookPen className="h-5 w-5 text-amber-500" /><span className={cn('rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-wide', card.conclusionStatus === 'supported' ? 'bg-emerald-50 text-emerald-700' : card.conclusionStatus === 'contested' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600')}>{card.conclusionStatus || 'draft'}</span><span className="text-[9px] font-semibold capitalize text-slate-500">{card.confidence || 'tentative'} confidence</span></div><h3 className="mt-3 text-base font-extrabold leading-6 text-slate-900">{card.claim || 'Select this finding to write its claim.'}</h3>{card.interpretation && <p className="mt-3 text-xs leading-5 text-slate-600">{card.interpretation}</p>}{card.caveat && <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-[10px] leading-4 text-amber-900"><strong>Caveat:</strong> {card.caveat}</p>}<p className="mt-3 text-[9px] font-semibold text-slate-500">{card.evidenceLinks?.length || 0} linked evidence item{card.evidenceLinks?.length === 1 ? '' : 's'}</p></div>;
  if (card.kind === 'map') return <div className="flex h-full min-h-32 items-center justify-center rounded-lg bg-slate-100 text-center"><div><Map className="mx-auto h-6 w-6 text-slate-400" /><p className="mt-2 text-xs font-semibold text-slate-600">Replayable map view</p><p className="mt-1 text-[10px] text-slate-400">Camera, visible layers, legend, and source fingerprint preserved.</p></div></div>;
  if (card.kind === 'chart') return <div><BarChart3 className="h-5 w-5 text-blue-600" /><h3 className="mt-3 text-sm font-bold text-slate-800">{card.title || chart?.title || 'Chart'}</h3><p className="mt-2 text-xs text-slate-500">{chart ? `${chart.type} · ${chart.dimensionField} · ${chart.aggregation}` : 'The source chart is no longer available.'}</p>{card.frozenValues ? <pre className="mt-3 max-h-36 overflow-auto text-[9px] text-slate-400">{JSON.stringify(card.frozenValues, null, 2)}</pre> : null}</div>;
  if (card.kind === 'kpi') return <div><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{card.title || kpi?.title || 'Metric'}</p><p className="mt-6 text-4xl font-black tabular-nums text-slate-900">{typeof card.frozenValues === 'number' ? card.frozenValues.toLocaleString() : '—'}</p><p className="mt-2 text-[10px] text-slate-400">Baseline, delta, denominator, and status are preserved when captured.</p></div>;
  return <div className="flex h-full flex-col"><NotebookPen className="h-5 w-5 text-amber-500" /><input value={card.title || ''} onChange={(event) => update(card.id, { title: event.target.value })} placeholder="Heading" className="mt-3 text-sm font-extrabold text-slate-800 outline-none" /><textarea value={card.note || ''} onChange={(event) => update(card.id, { note: event.target.value })} placeholder="Write an interpretation, caveat, or next step…" className="mt-3 min-h-20 flex-1 resize-none text-xs leading-5 text-slate-600 outline-none" /></div>;
};

const SortableCard = ({ card, presenting, selected, onSelect }: { card: ExplainCard; presenting: boolean; selected: boolean; onSelect: () => void }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id, disabled: presenting });
  const update = useStore((state) => state.updateExplainCard);
  const registry = useStore((state) => state.datasetRegistry);
  const addToast = useStore((state) => state.addToast);
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
  return <article id={`explain-card-${card.id}`} ref={setNodeRef} onClick={onSelect} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn('relative overflow-hidden rounded-xl border bg-white p-4 shadow-sm outline-none transition-colors', widthClass[card.width], presenting ? 'min-h-0' : heightClass[card.height], !presenting && 'cursor-pointer pt-12', presenting && card.behaviour === 'live' && 'pt-9', selected ? 'border-blue-400 ring-2 ring-blue-100' : 'border-slate-200', isDragging && 'z-20 opacity-45 shadow-xl')} tabIndex={presenting ? -1 : 0} onFocus={onSelect} aria-label={`${card.title || card.claim || card.kind} card`}>
    {!presenting && <div className="absolute right-2 top-2 z-10 flex rounded-md border border-slate-100 bg-white/95 p-0.5 shadow-sm"><button type="button" {...attributes} {...listeners} className="cursor-grab rounded p-1.5 text-slate-600 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500" aria-label={`Drag to reorder ${card.title || card.kind}`}><GripVertical className="h-3.5 w-3.5" /></button>{card.provenance && <button type="button" onClick={() => void refresh()} disabled={sourceMissing} className="rounded p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-30" aria-label="Refresh frozen evidence"><RefreshCw className="h-3.5 w-3.5" /></button>}<button type="button" onClick={() => update(card.id, { behaviour: card.behaviour === 'frozen' ? 'live' : 'frozen' })} className="rounded px-1.5 text-[9px] font-bold text-slate-600 hover:bg-slate-50" aria-label={`Make card ${card.behaviour === 'frozen' ? 'live' : 'frozen'}`}>{card.behaviour === 'frozen' ? 'Live' : 'Freeze'}</button></div>}
    {(sourceMissing || sourceChanged) && <div className={cn('mb-3 mr-28 rounded-md px-2 py-1 text-[9px] font-bold', sourceMissing ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700')}>{sourceMissing ? 'Source missing — frozen evidence retained' : 'Source changed — refresh is optional'}</div>}
    {card.takeaway && <div className="mb-3 border-l-2 border-blue-500 pl-3"><p className="text-xs font-bold leading-5 text-slate-800">{card.takeaway}</p></div>}
    <CardContent card={card} presenting={presenting} />
    {card.caption && <p className="mt-3 border-t border-slate-100 pt-2 text-[9px] leading-4 text-slate-600">{card.caption}</p>}
    {(!presenting || card.behaviour === 'live') && <div className="absolute left-4 top-3 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-slate-600">{card.behaviour === 'live' ? <><RefreshCw className="h-2.5 w-2.5" /> Live evidence</> : 'Frozen evidence'}</div>}
  </article>;
};

const ExplainSectionGrid = ({ section, index, sectionCount, cards, presenting, selectedCardId, onSelectCard, onAdd, onUpdate, onReorderSection, onRemoveSection }: {
  section: ExplainDocument['sections'][number];
  index: number;
  sectionCount: number;
  cards: ExplainCard[];
  presenting: boolean;
  selectedCardId?: string;
  onSelectCard: (cardId: string) => void;
  onAdd: (kind: ExplainCardKind, sectionId: string) => void;
  onUpdate: (sectionId: string, patch: Partial<Omit<ExplainDocument['sections'][number], 'id'>>) => void;
  onReorderSection: (sectionId: string, target: number) => void;
  onRemoveSection: (sectionId: string) => void;
}) => {
  const { setNodeRef, isOver } = useDroppable({ id: `section:${section.id}`, disabled: presenting });
  return <section id={`explain-section-${section.id}`} ref={setNodeRef} className={cn('break-inside-avoid scroll-mt-6 rounded-xl transition-colors', isOver && 'bg-blue-50/70 ring-2 ring-blue-200')}>
    <div className="mb-3 border-b border-slate-200 pb-2"><div className="flex items-center gap-2"><input value={section.title} readOnly={presenting} onChange={(event) => onUpdate(section.id, { title: event.target.value })} className="min-w-0 flex-1 bg-transparent text-sm font-extrabold uppercase tracking-[.12em] text-slate-600 outline-none" aria-label="Section title" />{!presenting && <><button type="button" disabled={index === 0} onClick={() => onReorderSection(section.id, index - 1)} className="p-1 text-slate-500 disabled:opacity-20" aria-label={`Move ${section.title} up`}><ArrowUp className="h-3.5 w-3.5" /></button><button type="button" disabled={index === sectionCount - 1} onClick={() => onReorderSection(section.id, index + 1)} className="p-1 text-slate-500 disabled:opacity-20" aria-label={`Move ${section.title} down`}><ArrowDown className="h-3.5 w-3.5" /></button><button type="button" disabled={sectionCount <= 1} onClick={() => onRemoveSection(section.id)} className="p-1 text-slate-500 hover:text-rose-700 disabled:opacity-20" aria-label={`Remove ${section.title}`}><Trash2 className="h-3.5 w-3.5" /></button></>}</div>{!presenting && <input value={section.purpose || ''} onChange={(event) => onUpdate(section.id, { purpose: event.target.value })} placeholder="What belongs in this section?" className="mt-1 w-full bg-transparent text-[10px] text-slate-500 outline-none" aria-label={`${section.title} purpose`} />}</div>
    <SortableContext items={cards.map((card) => card.id)} strategy={rectSortingStrategy}><div className="grid grid-cols-1 gap-4 md:grid-cols-6 xl:grid-cols-12">{cards.map((card) => <SortableCard key={card.id} card={card} presenting={presenting} selected={!presenting && selectedCardId === card.id} onSelect={() => onSelectCard(card.id)} />)}{!cards.length && !presenting && <button type="button" onClick={() => onAdd(section.id === 'evidence' ? 'table' : section.id === 'interpretation' || section.id === 'conclusion' ? 'finding' : 'note', section.id)} className="col-span-full flex min-h-20 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 px-4 text-xs font-semibold text-slate-600 hover:border-blue-400 hover:text-blue-700"><span><Plus className="mr-1 inline h-3.5 w-3.5" /> Add to {section.title}</span>{section.purpose && <span className="mt-1 max-w-lg text-center text-[10px] font-normal text-slate-500">{section.purpose}</span>}</button>}</div></SortableContext>
  </section>;
};

export const ExplainWorkspace = () => {
  const explain = useStore((state) => state.visualAnalytics.explain);
  const registry = useStore((state) => state.datasetRegistry);
  const datasets = useMemo(() => Object.values(registry), [registry]);
  const setTitle = useStore((state) => state.setExplainTitle);
  const updateDocument = useStore((state) => state.updateExplainDocument);
  const addSection = useStore((state) => state.addExplainSection);
  const updateSection = useStore((state) => state.updateExplainSection);
  const reorderSection = useStore((state) => state.reorderExplainSection);
  const removeSection = useStore((state) => state.removeExplainSection);
  const addCard = useStore((state) => state.addExplainCard);
  const reorderCard = useStore((state) => state.reorderExplainCard);
  const setPresenting = useStore((state) => state.setPresentationMode);
  const presenting = useStore((state) => state.ui.isPresentationMode);
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const [addMenu, setAddMenu] = useState(false);
  const [selectedCardId, setSelectedCardId] = useState<string>();
  const [activeDragId, setActiveDragId] = useState<string>();
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const cardsBySection = useMemo<Record<string, ExplainCard[]>>(() => Object.fromEntries(explain.sections.map((section) => [section.id, explain.cards.filter((card) => card.sectionId === section.id)])), [explain]);
  const currentVersions = useMemo(() => Object.fromEntries(Object.values(registry).map((dataset) => [dataset.id, dataset.sourceUpdatedAt])), [registry]);
  const healthIssues = useMemo(() => evaluateExplainDocument(explain, currentVersions), [explain, currentVersions]);
  const selectedCard = explain.cards.find((card) => card.id === selectedCardId);
  const visibleSections = presenting ? explain.sections.filter((section) => section.presentationVisibility !== 'hidden' && (section.presentationVisibility === 'always' || (cardsBySection[section.id]?.length || 0) > 0)) : explain.sections;

  const add = async (kind: ExplainCardKind, sectionId = 'evidence') => {
    const dataset = datasets[0];
    const card: ExplainCard = { id: `explain-${kind}-${Date.now()}`, sectionId, kind, datasetId: kind === 'table' ? dataset?.id : undefined, title: kind === 'finding' ? 'Finding' : kind === 'note' ? 'Note' : undefined, width: kind === 'comparison' || kind === 'map' ? 12 : 6, height: kind === 'finding' ? 'standard' : 'compact', behaviour: 'frozen', provenance: { capturedAt: Date.now(), datasetIds: dataset && kind === 'table' ? [dataset.id] : [], sourceVersions: dataset ? { [dataset.id]: dataset.sourceUpdatedAt } : {}, filtersByDataset: {}, caveats: [] } };
    if (kind === 'finding') { card.claim = ''; card.interpretation = ''; card.caveat = ''; card.conclusionStatus = 'draft'; card.confidence = 'tentative'; card.evidenceLinks = []; }
    if (kind === 'note') card.note = '';
    if (kind === 'table' && dataset?.relationName) try {
      const result = await duckdbService.query(`SELECT * FROM ${quoteIdentifier(dataset.relationName)} LIMIT 10;`);
      card.frozenValues = result.toArray().map((row) => Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([key, value]) => [key, typeof value === 'bigint' ? Number(value) : value])));
    } catch { card.provenance?.caveats.push('The bounded table preview could not be captured.'); }
    addCard(card); setSelectedCardId(card.id); setInspectorOpen(true); setAddMenu(false);
  };
  const dragStart = ({ active }: DragStartEvent) => { setActiveDragId(String(active.id)); setSelectedCardId(String(active.id)); };
  const dragEnd = ({ active, over }: DragEndEvent) => {
    setActiveDragId(undefined);
    if (!over || active.id === over.id) return;
    const activeCard = explain.cards.find((card) => card.id === active.id);
    if (!activeCard) return;
    const overId = String(over.id);
    const overCard = explain.cards.find((card) => card.id === overId);
    const targetSectionId = overId.startsWith('section:') ? overId.slice(8) : overCard?.sectionId;
    if (!targetSectionId) return;
    const targetCards = cardsBySection[targetSectionId] || [];
    if (activeCard.sectionId === targetSectionId && overCard) {
      const oldIndex = targetCards.findIndex((card) => card.id === activeCard.id);
      const newIndex = targetCards.findIndex((card) => card.id === overCard.id);
      const ordered = arrayMove(targetCards, oldIndex, newIndex);
      reorderCard(activeCard.id, targetSectionId, ordered.findIndex((card) => card.id === activeCard.id));
    } else reorderCard(activeCard.id, targetSectionId, overCard ? Math.max(0, targetCards.findIndex((card) => card.id === overCard.id)) : targetCards.length);
  };
  const removeSectionSafely = (sectionId: string) => {
    const section = explain.sections.find((item) => item.id === sectionId);
    const count = cardsBySection[sectionId]?.length || 0;
    if (count && !window.confirm(`Remove ${section?.title || 'this section'} and its ${count} card${count === 1 ? '' : 's'}?`)) return;
    if (selectedCard?.sectionId === sectionId) setSelectedCardId(undefined);
    removeSection(sectionId);
  };

  return <div className="relative flex min-h-0 flex-1 overflow-hidden bg-slate-50">
    {!presenting && <ExplainOutline document={explain} issues={healthIssues} selectedCardId={selectedCardId} onSelectCard={setSelectedCardId} className="hidden xl:flex" />}
    <main className={cn('min-h-0 min-w-0 flex-1 overflow-y-auto bg-slate-50 print:overflow-visible print:bg-white', presenting && 'bg-white')}>
      <div className="mx-auto max-w-[1320px] p-4 md:p-7 print:max-w-none print:p-0">
        <header className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm print:border-0 print:shadow-none"><div className="flex flex-wrap items-start gap-3"><div className="min-w-52 flex-1"><input value={explain.title} readOnly={presenting} onChange={(event) => setTitle(event.target.value)} className="w-full bg-transparent text-xl font-black text-slate-900 outline-none" aria-label="Explanation title" />{presenting ? explain.summary && <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">{explain.summary}</p> : <textarea value={explain.summary || ''} onChange={(event) => updateDocument({ summary: event.target.value })} placeholder="Executive summary or central analytical question…" className="mt-1 min-h-8 w-full resize-none bg-transparent text-xs leading-5 text-slate-600 outline-none" aria-label="Explanation summary" />}{explain.audience && presenting && <p className="mt-1 text-[10px] font-semibold text-slate-500">For {explain.audience}</p>}</div><div className="flex flex-wrap gap-2">{!presenting && <><button type="button" onClick={() => { setOutlineOpen(true); setInspectorOpen(false); }} className="flex h-8 items-center gap-1.5 rounded-md border border-slate-200 px-3 text-[10px] font-bold text-slate-700 xl:hidden"><PanelLeft className="h-3.5 w-3.5" /> Outline</button>{selectedCard && <button type="button" onClick={() => { setInspectorOpen(true); setOutlineOpen(false); }} className="flex h-8 items-center gap-1.5 rounded-md border border-slate-200 px-3 text-[10px] font-bold text-slate-700 xl:hidden"><SlidersHorizontal className="h-3.5 w-3.5" /> Inspect</button>}<div className="relative"><button type="button" onClick={() => setAddMenu(!addMenu)} className="flex h-8 items-center gap-1.5 rounded-md border border-slate-200 px-3 text-[10px] font-bold text-slate-700"><Plus className="h-3.5 w-3.5" /> Add</button>{addMenu && <div className="absolute right-0 top-10 z-30 grid w-56 rounded-lg border border-slate-200 bg-white p-1 shadow-xl">{(['finding', 'note', 'table', 'map'] as const).map((kind) => <button key={kind} type="button" onClick={() => void add(kind)} disabled={kind === 'table' && !datasets.length} className="rounded px-3 py-2 text-left text-[11px] font-semibold capitalize text-slate-700 hover:bg-slate-50 disabled:opacity-40">{kind === 'map' ? 'Capture map definition' : `Add ${kind}`}</button>)}<p className="border-t border-slate-100 px-3 py-2 text-[9px] leading-4 text-slate-500">Charts, KPIs and comparison views are pinned from their analytical workspace so their current context can be captured.</p></div>}</div></>}<button type="button" onClick={() => setPresenting(!presenting)} className="flex h-8 items-center gap-1.5 rounded-md bg-slate-900 px-3 text-[10px] font-bold text-white"><MonitorPlay className="h-3.5 w-3.5" />{presenting ? 'Exit presentation' : 'Present'}</button></div></div>{!presenting && <input value={explain.audience || ''} onChange={(event) => updateDocument({ audience: event.target.value })} placeholder="Audience or decision owner (optional)" className="mt-2 w-full border-t border-slate-100 pt-2 text-[10px] text-slate-600 outline-none" aria-label="Explanation audience" />}</header>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={dragStart} onDragEnd={dragEnd} onDragCancel={() => setActiveDragId(undefined)}><div className={cn('mt-6 space-y-8', presenting && 'space-y-6')}>{visibleSections.map((section, sectionIndex) => <ExplainSectionGrid key={section.id} section={section} index={sectionIndex} sectionCount={visibleSections.length} cards={cardsBySection[section.id] || []} presenting={presenting} selectedCardId={selectedCardId} onSelectCard={setSelectedCardId} onAdd={(kind, sectionId) => void add(kind, sectionId)} onUpdate={updateSection} onReorderSection={reorderSection} onRemoveSection={removeSectionSafely} />)}</div><DragOverlay>{activeDragId ? <div className="w-64 rounded-xl border border-blue-300 bg-white p-4 text-xs font-bold text-slate-700 shadow-2xl">{explain.cards.find((card) => card.id === activeDragId)?.title || 'Moving evidence'}</div> : null}</DragOverlay></DndContext>
        {!presenting && <button type="button" onClick={() => addSection({ id: `section-${Date.now()}`, title: 'New section', purpose: 'Describe the role of this section in the argument.' })} className="mt-8 flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs font-bold text-slate-600"><Plus className="h-3.5 w-3.5" /> Add section</button>}
        {explain.cards.some((card) => card.provenance?.caveats.length) && <div className="mt-8 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-[10px] text-amber-900"><AlertCircle className="h-3.5 w-3.5 shrink-0" /> Frozen evidence retains caveats and source fingerprints. Refresh is always explicit.</div>}
      </div>
    </main>
    {!presenting && selectedCard && <ExplainInspector card={selectedCard} document={explain} issues={healthIssues} className="hidden xl:flex" />}
    {!presenting && outlineOpen && <div className="fixed inset-0 z-50 bg-slate-950/30 xl:hidden" onClick={() => setOutlineOpen(false)}><div onClick={(event) => event.stopPropagation()}><ExplainOutline document={explain} issues={healthIssues} selectedCardId={selectedCardId} onSelectCard={(id) => { setSelectedCardId(id); setOutlineOpen(false); }} onClose={() => setOutlineOpen(false)} className="absolute bottom-3 left-3 top-20 w-[min(88vw,320px)] overflow-hidden rounded-xl shadow-2xl" /></div></div>}
    {!presenting && inspectorOpen && selectedCard && <div className="fixed inset-0 z-50 bg-slate-950/30 xl:hidden" onClick={() => setInspectorOpen(false)}><div onClick={(event) => event.stopPropagation()}><ExplainInspector card={selectedCard} document={explain} issues={healthIssues} onClose={() => setInspectorOpen(false)} className="absolute bottom-3 right-3 top-20 w-[min(92vw,360px)] overflow-hidden rounded-xl shadow-2xl" /></div></div>}
  </div>;
};
