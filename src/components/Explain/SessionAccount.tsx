import { History } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { cn } from '../../utils/cn';
import { eventsForSession } from '../../utils/provenance';
import type { ProvenanceEvent } from '../../types/provenance';

/**
 * Renders the account: what was done, in the order it was done.
 *
 * The lineage card answers "what came from what" by reading the variants that
 * still exist. This answers "what happened", which is a different question — it
 * includes the filter that was applied and cleared, the weighting that was
 * tried and abandoned, and the branch that was later deleted. None of those
 * leave a trace in the variant tree, and all of them are part of how the
 * analyst arrived where they did.
 *
 * Given `events` it renders those and touches no store, so a shared story can
 * carry its account into a browser that holds none of this.
 */

/** Groups by activity family, which is what the eye scans for. */
const TONE: Record<string, string> = {
  variant: 'bg-emerald-50 text-emerald-700',
  filter: 'bg-sky-50 text-sky-700',
  weights: 'bg-purple-50 text-purple-700',
  operation: 'bg-amber-50 text-amber-700',
  workflow: 'bg-slate-100 text-slate-600',
  sweep: 'bg-slate-100 text-slate-600',
  dataset: 'bg-teal-50 text-teal-700',
  history: 'bg-rose-50 text-rose-600',
  project: 'bg-slate-100 text-slate-500',
  session: 'bg-indigo-50 text-indigo-700',
};

const family = (activity: string) => activity.split('.')[0];

const dayLabel = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? 'Undated'
    : date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
};

const timeLabel = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

/** Consecutive events on the same day, so the reader sees sittings not a wall. */
const byDay = (events: ProvenanceEvent[]) => {
  const days: Array<{ label: string; events: ProvenanceEvent[] }> = [];
  for (const event of events) {
    const label = dayLabel(event.timestamp);
    const current = days[days.length - 1];
    if (current?.label === label) current.events.push(event);
    else days.push({ label, events: [event] });
  }
  return days;
};

export const SessionAccount = ({
  events,
  presenting = false,
  limit = 200,
}: {
  events?: ProvenanceEvent[];
  presenting?: boolean;
  limit?: number;
}) => {
  const live = useStore((state) => state.provenanceEvents);
  const activeSessionId = useStore((state) => state.visualAnalytics.activeSessionId);
  const sessions = useStore((state) => state.visualAnalytics.sessions);
  const session = sessions.find((item) => item.id === activeSessionId);
  // Frozen events are shown whole — a story carries the account it was given.
  // Live ones follow whichever line of enquiry is open, matching the variant
  // panel; with none selected the reader is asking about the whole project.
  const all = events ?? (activeSessionId ? eventsForSession(live, activeSessionId) : live);
  // Newest work is what a reader wants first, but within a day the order has to
  // stay chronological or the account stops reading as a narrative.
  const shown = all.slice(Math.max(0, all.length - limit));
  const days = byDay(shown);

  const heading = (
    <div className="flex items-center gap-2">
      <History className="h-4 w-4 text-slate-500" />
      <h3 className="text-sm font-bold text-slate-800">How this came about</h3>
      {!events && session && (
        <span className="truncate text-[11px] font-semibold text-indigo-600">{session.name}</span>
      )}
      {all.length > 0 && (
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          {all.length} step{all.length === 1 ? '' : 's'}
        </span>
      )}
    </div>
  );

  if (!shown.length) {
    return (
      <div>
        {heading}
        <p className="mt-3 text-xs leading-5 text-slate-500">
          Nothing recorded yet. Filter, weight, branch or run something and it will be written here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {heading}
      {all.length > shown.length && (
        <p className="mt-2 text-[11px] text-slate-500">
          Showing the most recent {shown.length} of {all.length}.
        </p>
      )}
      <ol className={cn('mt-3 space-y-4 overflow-y-auto pr-1', presenting ? 'text-sm' : 'text-xs')}>
        {days.map((day) => (
          <li key={`${day.label}-${day.events[0].id}`}>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{day.label}</p>
            <ul className="mt-2 space-y-1.5 border-l border-slate-200 pl-3">
              {day.events.map((event) => (
                <li key={event.id} className="flex items-baseline gap-2">
                  <span className="w-10 shrink-0 tabular-nums text-[11px] text-slate-500">{timeLabel(event.timestamp)}</span>
                  <span
                    className={cn(
                      'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                      TONE[family(event.activity)] || 'bg-slate-100 text-slate-500',
                    )}
                  >
                    {family(event.activity)}
                  </span>
                  <span className="min-w-0 flex-1 leading-5 text-slate-600">{event.summary}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
};
