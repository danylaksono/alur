import { useRef, type ChangeEvent } from 'react';
import { BarChart3, Database, Gauge, GitCompareArrows, NotebookPen, X } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { parseStory } from '../../services/storyService';
import type { AlurStory } from '../../types/story';
import type { ComparisonResult, ExplainCard } from '../../types/visualAnalytics';
import { ComparisonMapEvidence, ComparisonRecordsEvidence } from '../Compare/ComparisonEvidenceViews';
import { MapEvidence } from './MapEvidence';
import { cn } from '../../utils/cn';

const widthClass: Record<ExplainCard['width'], string> = {
  3: 'md:col-span-3',
  4: 'md:col-span-3 xl:col-span-4',
  6: 'md:col-span-3 xl:col-span-6',
  8: 'md:col-span-6 xl:col-span-8',
  12: 'md:col-span-6 xl:col-span-12',
};
const heightClass: Record<ExplainCard['height'], string> = { compact: 'min-h-32', standard: 'min-h-56', tall: 'min-h-80' };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Everything renders from captured values — there is no store or engine here. */
const StoryCardContent = ({ card }: { card: ExplainCard }) => {
  if (card.kind === 'map') return <MapEvidence card={card} />;

  if (card.kind === 'finding') {
    return (
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <NotebookPen className="h-5 w-5 text-amber-500" />
          <span className={cn('rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-wide',
            card.conclusionStatus === 'supported' ? 'bg-emerald-50 text-emerald-700'
              : card.conclusionStatus === 'contested' ? 'bg-rose-50 text-rose-700'
                : 'bg-slate-100 text-slate-600')}>
            {card.conclusionStatus || 'draft'}
          </span>
          <span className="text-[9px] font-semibold capitalize text-slate-500">{card.confidence || 'tentative'} confidence</span>
        </div>
        <h3 className="mt-3 text-base font-extrabold leading-6 text-slate-900">{card.claim || 'Untitled finding'}</h3>
        {card.interpretation && <p className="mt-3 text-xs leading-5 text-slate-600">{card.interpretation}</p>}
        {card.caveat && <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-[10px] leading-4 text-amber-900"><strong>Caveat:</strong> {card.caveat}</p>}
      </div>
    );
  }

  if (card.kind === 'note') {
    return (
      <div>
        <NotebookPen className="h-5 w-5 text-amber-500" />
        {card.title && <h3 className="mt-3 text-sm font-extrabold text-slate-800">{card.title}</h3>}
        {card.note && <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-600">{card.note}</p>}
      </div>
    );
  }

  if (card.kind === 'table') {
    const rows = Array.isArray(card.frozenValues) ? card.frozenValues as Array<Record<string, unknown>> : [];
    if (!rows.length) return <EmptyCapture title={card.title || 'Table preview'} />;
    const columns = Object.keys(rows[0]).slice(0, 6);
    return (
      <div>
        <div className="flex items-center gap-2"><Database className="h-4 w-4 text-teal-600" /><h3 className="text-sm font-bold text-slate-800">{card.title || 'Table preview'}</h3></div>
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-[10px]">
            <thead className="bg-slate-50 text-slate-600"><tr>{columns.map((column) => <th key={column} className="whitespace-nowrap px-2 py-1.5 font-bold">{column}</th>)}</tr></thead>
            <tbody>{rows.slice(0, 10).map((row, index) => <tr key={index} className="border-t border-slate-100">{columns.map((column) => <td key={column} className="max-w-40 truncate px-2 py-1.5 text-slate-600">{String(row[column] ?? '—')}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </div>
    );
  }

  if (card.kind === 'kpi') {
    if (typeof card.frozenValues !== 'number') return <EmptyCapture title={card.title || 'Metric'} />;
    return (
      <div>
        <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500"><Gauge className="h-3.5 w-3.5" />{card.title || 'Metric'}</p>
        <p className="mt-6 text-4xl font-black tabular-nums text-slate-900">{card.frozenValues.toLocaleString()}</p>
      </div>
    );
  }

  if (card.kind === 'comparison') {
    if (!isRecord(card.frozenValues)) return <EmptyCapture title={card.title || 'Comparison'} />;
    const result = card.frozenValues as unknown as ComparisonResult;
    const spec = card.provenance?.comparisonSpec;
    if (spec && card.comparisonView === 'map' && result.spatialSamples?.length) {
      return <ComparisonMapEvidence spec={spec} result={result} differenceEligible={Boolean(result.differenceSpatialSample)} mode={card.comparisonMapMode || 'multiples'} onModeChange={() => {}} interactive={false} />;
    }
    if (spec && card.comparisonView === 'records' && result.alignedRecords?.length) {
      return <ComparisonRecordsEvidence spec={spec} result={result} />;
    }
    const max = Math.max(1, ...result.summaries.flatMap((summary) => summary.values.map((value) => value.value || 0)));
    return (
      <div className="space-y-4">
        {result.summaries.map((summary) => (
          <div key={summary.measureId}>
            <h4 className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{spec?.measures.find((item) => item.id === summary.measureId)?.label || summary.measureId}</h4>
            <div className="mt-2 space-y-2">
              {summary.values.map((value) => {
                const operand = spec?.operands.find((item) => item.id === value.operandId);
                return (
                  <div key={value.operandId} className="grid grid-cols-[100px_1fr_64px] items-center gap-2 text-[10px]">
                    <span className="truncate font-semibold text-slate-600">{operand?.label || value.operandId}</span>
                    <div className="h-2 rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${Math.max(2, ((value.value || 0) / max) * 100)}%`, backgroundColor: operand?.colour || '#64748b' }} /></div>
                    <span className="text-right tabular-nums">{value.value?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? '—'}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <BarChart3 className="h-5 w-5 text-blue-600" />
      <h3 className="mt-3 text-sm font-bold text-slate-800">{card.title || 'Chart'}</h3>
      {card.frozenValues === undefined && <p className="mt-2 text-xs text-slate-500">No values were captured for this chart.</p>}
    </div>
  );
};

const EmptyCapture = ({ title }: { title: string }) => (
  <div className="flex h-full min-h-24 flex-col items-center justify-center rounded-lg bg-slate-50 p-4 text-center">
    <p className="text-xs font-semibold text-slate-600">{title}</p>
    <p className="mt-1 text-[10px] text-slate-500">The author shared this without its captured values.</p>
  </div>
);

/**
 * Reads a story on its own terms: no rail, no workspace, no editing. This is
 * what a recipient sees, and it must work with no data loaded.
 */
export const StoryViewer = ({ story }: { story: AlurStory }) => {
  const closeStory = useStore((state) => state.closeStory);
  const compareStories = useStore((state) => state.compareStories);
  const addToast = useStore((state) => state.addToast);
  const compareInputRef = useRef<HTMLInputElement>(null);
  const sections = story.sections.filter((section) => story.cards.some((card) => card.sectionId === section.id));

  const handleCompareImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      compareStories(story, parseStory(await file.text()));
    } catch (error: any) {
      addToast({ type: 'error', message: `Could not open story: ${error?.message || 'Unknown error'}` });
    }
  };

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-slate-50">
      <header className="z-50 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <img src="/alur-mark.svg" alt="" className="h-7 w-7 shrink-0" />
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">Story</span>
          <span className="truncate text-[13px] font-semibold text-slate-800">{story.title}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => compareInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
            title="Compare this story with another one"
          >
            <GitCompareArrows className="h-3.5 w-3.5" /> Compare with…
          </button>
          <input ref={compareInputRef} type="file" accept=".json,.alur-story.json,application/json" className="hidden" onChange={handleCompareImport} />
          <button type="button" onClick={closeStory} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
            <X className="h-3.5 w-3.5" /> Close story
          </button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto print:overflow-visible">
        <div className="mx-auto max-w-[1320px] p-4 md:p-7">
          <header className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <h1 className="text-2xl font-black tracking-tight text-slate-950">{story.title}</h1>
            {story.summary && <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">{story.summary}</p>}
            <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 pt-3 text-[10px] text-slate-500">
              {story.author && <span className="font-semibold text-slate-600">By {story.author}</span>}
              {story.audience && <span>For {story.audience}</span>}
              <span>Exported {new Date(story.exportedAt).toLocaleDateString()}</span>
              {story.sources.length > 0 && <span>Sources: {story.sources.map((source) => source.name).join(', ')}</span>}
            </p>
          </header>

          <div className="mt-6 space-y-8">
            {sections.map((section) => (
              <section key={section.id}>
                <div className="mb-3 border-b border-slate-200 pb-2">
                  <h2 className="text-sm font-extrabold uppercase tracking-[.12em] text-slate-600">{section.title}</h2>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-6 xl:grid-cols-12">
                  {story.cards.filter((card) => card.sectionId === section.id).map((card) => (
                    <article key={card.id} className={cn('flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm', widthClass[card.width], heightClass[card.height])} aria-label={`${card.title || card.kind} card`}>
                      <div className="min-h-0 flex-1"><StoryCardContent card={card} /></div>
                      {card.takeaway && <p className="mt-3 border-t border-slate-100 pt-2 text-[11px] leading-5 text-slate-700">{card.takeaway}</p>}
                      {card.caption && <p className="mt-1 text-[10px] text-slate-500">{card.caption}</p>}
                      {card.provenance?.caveats.length ? (
                        <p className="mt-2 text-[9px] leading-4 text-amber-800">{card.provenance.caveats.join(' · ')}</p>
                      ) : null}
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <p className="mt-10 border-t border-slate-200 pt-4 text-[10px] leading-5 text-slate-500">
            This is a frozen account. Values were captured when the author exported it and do not update.
            Built with ALUR {story.appVersion}.
          </p>
        </div>
      </main>
    </div>
  );
};
