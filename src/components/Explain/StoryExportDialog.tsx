import { useMemo, useState } from 'react';
import { AlertTriangle, Database, Download, Image, MapPin, Share2, X } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { createStory, downloadStory, storyDisclosure, withoutRecordLevelEvidence } from '../../services/storyService';
import { cn } from '../../utils/cn';

const formatBytes = (bytes: number) =>
  bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;

/**
 * Exporting a story publishes captured values — rows, sampled geometry, map
 * images. The project format never embeds source data, so the difference has
 * to be stated before the file leaves the browser, not buried in a doc.
 */
export const StoryExportDialog = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const authorName = useStore((state) => state.settings.authorName);
  const updateSettings = useStore((state) => state.updateSettings);
  const addToast = useStore((state) => state.addToast);
  const [includeRecords, setIncludeRecords] = useState(true);

  const { full, shared, disclosure } = useMemo(() => {
    if (!open) return { full: null, shared: null, disclosure: null };
    const base = createStory();
    const outgoing = includeRecords ? base : withoutRecordLevelEvidence(base);
    return { full: base, shared: outgoing, disclosure: storyDisclosure(outgoing) };
  }, [open, includeRecords, authorName]);

  if (!open || !shared || !disclosure || !full) return null;

  const droppedRecords = storyDisclosure(full).recordCards.length;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/35 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="story-export-title" className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div>
            <h2 id="story-export-title" className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <Share2 className="h-4 w-4 text-blue-600" /> Share this explanation
            </h2>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              A story is read-only and stands alone — the reader needs no data, no relinking, and no query engine.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Close share dialog"><X className="h-4 w-4" /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Author (optional)
            <input
              value={authorName}
              onChange={(event) => updateSettings({ authorName: event.target.value.slice(0, 80) })}
              placeholder="Who is presenting these findings?"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium normal-case tracking-normal text-slate-800 outline-none focus:border-sky-400"
            />
          </label>

          <section className="rounded-xl border border-slate-200">
            <h3 className="border-b border-slate-100 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              What the reader receives
            </h3>
            <dl className="divide-y divide-slate-100 text-xs">
              <div className="flex items-center justify-between px-3 py-2">
                <dt className="text-slate-600">
                  {disclosure.cardCount} {disclosure.cardCount === 1 ? 'card' : 'cards'} across{' '}
                  {shared.sections.length} {shared.sections.length === 1 ? 'section' : 'sections'}
                </dt>
                <dd className="font-bold tabular-nums text-slate-800">{formatBytes(disclosure.bytes)}</dd>
              </div>
              {disclosure.imageCards > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 text-slate-600">
                  <Image className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                  {disclosure.imageCards} captured map {disclosure.imageCards === 1 ? 'image' : 'images'}
                </div>
              )}
              {disclosure.spatialCards.length > 0 && (
                <div className="flex items-start gap-2 px-3 py-2 text-slate-600">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                  <span>{disclosure.spatialCards.reduce((total, card) => total + card.featureCount, 0).toLocaleString()} sampled locations across {disclosure.spatialCards.length} comparison {disclosure.spatialCards.length === 1 ? 'card' : 'cards'}</span>
                </div>
              )}
              {disclosure.recordCards.length > 0 && (
                <div className="flex items-start gap-2 bg-amber-50/60 px-3 py-2 text-amber-900">
                  <Database className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span><strong>{disclosure.recordCards.reduce((total, card) => total + card.rowCount, 0).toLocaleString()} individual records</strong> from {disclosure.recordCards.map((card) => card.title).join(', ')}</span>
                </div>
              )}
              <div className="px-3 py-2 text-slate-600">
                Sources cited by name only: {disclosure.sourceNames.length ? disclosure.sourceNames.join(', ') : 'none'}
              </div>
            </dl>
          </section>

          {droppedRecords > 0 && (
            <label className={cn('flex cursor-pointer items-start gap-2.5 rounded-xl border p-3', includeRecords ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200')}>
              <input type="checkbox" checked={includeRecords} onChange={(event) => setIncludeRecords(event.target.checked)} className="mt-0.5" />
              <span className="text-xs leading-5 text-slate-700">
                <strong className="block">Include row-level records</strong>
                Turn this off to share only aggregates, distributions and images. Individual records and sampled geometry are removed.
              </span>
            </label>
          )}

          {disclosure.emptyCards.length > 0 && (
            <div className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-[11px] leading-5 text-slate-600">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              <span>
                {disclosure.emptyCards.length} {disclosure.emptyCards.length === 1 ? 'card has' : 'cards have'} nothing captured and will render as a gap: {disclosure.emptyCards.map((card) => card.title).join(', ')}.
              </span>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t bg-slate-50 px-5 py-3">
          <p className="text-[10px] text-slate-500">Readers open this with “Open story” — no ALUR project needed.</p>
          <button
            type="button"
            onClick={() => {
              downloadStory(shared);
              addToast({ type: 'success', message: 'Story exported. Anyone can open it read-only.' });
              onClose();
            }}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-black"
          >
            <Download className="h-3.5 w-3.5" /> Export story
          </button>
        </footer>
      </section>
    </div>
  );
};
