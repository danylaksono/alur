import { AlertTriangle, Loader2, X } from 'lucide-react';
import type { StoryLinkState } from '../../hooks/useStoryLink';

/**
 * A shared link is often someone's first contact with ALUR, so a broken one
 * has to explain itself rather than dumping the reader into an empty
 * workspace with no idea the link was even attempted.
 */
export const StoryLinkStatus = ({ state, onDismiss }: { state: StoryLinkState; onDismiss: () => void }) => {
  if (state.status === 'idle') return null;

  if (state.status === 'loading') {
    return (
      <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-slate-950/40" role="status" aria-live="polite">
        <div className="flex items-center gap-3 rounded-xl bg-white px-5 py-4 shadow-2xl">
          <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
          <span className="text-xs font-semibold text-slate-700">Opening shared story…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onDismiss(); }}>
      <section role="alertdialog" aria-modal="true" aria-labelledby="story-link-error" className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <h2 id="story-link-error" className="flex items-center gap-2 text-sm font-bold text-slate-800">
            <AlertTriangle className="h-4 w-4 text-amber-500" /> This story link could not be opened
          </h2>
          <button type="button" onClick={onDismiss} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Dismiss"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <p className="text-xs leading-5 text-slate-700">{state.message}</p>
          <p className="break-all rounded-lg bg-slate-50 px-3 py-2 font-mono text-[10px] text-slate-600">{state.url}</p>
          <p className="text-[11px] leading-5 text-slate-600">
            The file must be reachable over HTTP(S) and its host must allow browser access from this site.
            Ask whoever shared it to check the link, or open the downloaded story file directly.
          </p>
        </div>
        <footer className="flex justify-end border-t bg-slate-50 px-5 py-3">
          <button type="button" onClick={onDismiss} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-black">
            Continue to ALUR
          </button>
        </footer>
      </section>
    </div>
  );
};
