import { useMemo } from 'react';
import { AlertTriangle, ArrowLeftRight, Check, Database, GitCompareArrows, Minus, X } from 'lucide-react';
import type { AlurStory } from '../../types/story';
import type { ExplainCard } from '../../types/visualAnalytics';
import { diffStories, type ClaimComparison, type DivergenceReason } from '../../utils/storyDiff';
import { cn } from '../../utils/cn';

const REASON_LABEL: Record<DivergenceReason, string> = {
  'different-sources': 'Different sources',
  'different-source-versions': 'Different source versions',
  'different-scope': 'Different question asked',
};

const REASON_DETAIL: Record<DivergenceReason, string> = {
  'different-sources': 'The two findings do not rest on the same datasets.',
  'different-source-versions': 'The same source was read at different versions, so the inputs were not identical.',
  'different-scope': 'The supporting comparisons used different groups or measures.',
};

const STATUS_STYLE = {
  conflict: { label: 'Conflict', className: 'border-rose-200 bg-rose-50/60', badge: 'bg-rose-100 text-rose-800', icon: AlertTriangle },
  agreement: { label: 'Agreement', className: 'border-emerald-200 bg-emerald-50/40', badge: 'bg-emerald-100 text-emerald-800', icon: Check },
  'only-left': { label: 'Only in yours', className: 'border-slate-200', badge: 'bg-slate-100 text-slate-700', icon: Minus },
  'only-right': { label: 'Only in theirs', className: 'border-slate-200', badge: 'bg-slate-100 text-slate-700', icon: Minus },
} as const;

const ClaimSide = ({ card, label, colour }: { card?: ExplainCard; label: string; colour: string }) => (
  <div className="min-w-0 flex-1">
    <p className={cn('text-[9px] font-bold uppercase tracking-wider', colour)}>{label}</p>
    {card ? (
      <>
        <p className="mt-1 text-xs font-semibold leading-5 text-slate-800">{card.claim}</p>
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[9px]">
          <span className={cn('rounded-full px-1.5 py-0.5 font-bold uppercase tracking-wide',
            card.conclusionStatus === 'supported' ? 'bg-emerald-100 text-emerald-800'
              : card.conclusionStatus === 'contested' ? 'bg-rose-100 text-rose-800'
                : 'bg-slate-100 text-slate-600')}>
            {card.conclusionStatus || 'draft'}
          </span>
          <span className="capitalize text-slate-500">{card.confidence || 'tentative'} confidence</span>
          <span className="text-slate-500">{card.evidenceLinks?.length || 0} linked evidence</span>
        </p>
        {card.caveat && <p className="mt-1.5 text-[10px] leading-4 text-amber-800">Caveat: {card.caveat}</p>}
      </>
    ) : (
      <p className="mt-1 text-xs italic text-slate-400">No matching claim</p>
    )}
  </div>
);

const ClaimRow = ({ claim }: { claim: ClaimComparison }) => {
  const style = STATUS_STYLE[claim.status];
  const Icon = style.icon;
  return (
    <article className={cn('rounded-xl border p-4', style.className)}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className={cn('flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide', style.badge)}>
          <Icon className="h-3 w-3" />{style.label}
        </span>
        {claim.similarity > 0 && (
          <span className="text-[9px] text-slate-500">matched on wording · {Math.round(claim.similarity * 100)}% overlap</span>
        )}
        {claim.reasons.map((reason) => (
          <span key={reason} className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[9px] font-bold text-amber-900" title={REASON_DETAIL[reason]}>
            {REASON_LABEL[reason]}
          </span>
        ))}
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:gap-6">
        <ClaimSide card={claim.left} label="Your finding" colour="text-blue-700" />
        <ArrowLeftRight className="hidden h-3.5 w-3.5 shrink-0 self-center text-slate-300 md:block" aria-hidden="true" />
        <ClaimSide card={claim.right} label="Their finding" colour="text-violet-700" />
      </div>

      {claim.status === 'conflict' && claim.reasons.length > 0 && (
        <p className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-[10px] leading-4 text-slate-700">
          These may not actually disagree — {claim.reasons.map((reason) => REASON_DETAIL[reason].toLowerCase()).join(' ')}
        </p>
      )}
      {claim.status === 'conflict' && claim.reasons.length === 0 && (
        <p className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-[10px] leading-4 text-rose-900">
          Same sources, same versions, same question — this is a genuine disagreement about what the evidence means.
        </p>
      )}
    </article>
  );
};

/**
 * Compares two accounts of the same subject. The interesting output is not
 * "these differ" but "these differ *and* rest on identical inputs" — which is
 * the only kind of disagreement worth arguing about.
 */
export const StoryDiffView = ({ left, right, onClose }: { left: AlurStory; right: AlurStory; onClose: () => void }) => {
  const diff = useMemo(() => diffStories(left, right), [left, right]);
  const { counts } = diff;

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-slate-50">
      <header className="z-50 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <GitCompareArrows className="h-4 w-4 shrink-0 text-blue-600" />
          <span className="truncate text-[13px] font-semibold text-slate-800">Comparing findings</span>
        </div>
        <button type="button" onClick={onClose} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
          <X className="h-3.5 w-3.5" /> Close comparison
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl p-4 md:p-7">
          <div className="grid gap-3 md:grid-cols-2">
            <section className="rounded-xl border border-blue-200 bg-white p-4">
              <p className="text-[9px] font-bold uppercase tracking-wider text-blue-700">Yours</p>
              <h2 className="mt-1 truncate text-sm font-bold text-slate-900">{left.title}</h2>
              <p className="mt-1 text-[10px] text-slate-500">{left.author || 'Unattributed'}</p>
            </section>
            <section className="rounded-xl border border-violet-200 bg-white p-4">
              <p className="text-[9px] font-bold uppercase tracking-wider text-violet-700">Theirs</p>
              <h2 className="mt-1 truncate text-sm font-bold text-slate-900">{right.title}</h2>
              <p className="mt-1 text-[10px] text-slate-500">{right.author || 'Unattributed'}</p>
            </section>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
            {([
              ['Conflicts', counts.conflicts, 'text-rose-700'],
              ['Agreements', counts.agreements, 'text-emerald-700'],
              ['Only yours', counts.onlyLeft, 'text-slate-700'],
              ['Only theirs', counts.onlyRight, 'text-slate-700'],
            ] as const).map(([label, value, colour]) => (
              <div key={label} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
                <p className={cn('mt-0.5 text-xl font-black tabular-nums', colour)}>{value}</p>
              </div>
            ))}
          </div>

          <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              <Database className="h-3.5 w-3.5" /> Sources
            </h3>
            <div className="mt-2 grid gap-2 text-[11px] md:grid-cols-3">
              <p className="text-slate-700"><strong className="block text-[9px] uppercase tracking-wide text-slate-500">In common</strong>{diff.sharedSources.join(', ') || 'None'}</p>
              <p className="text-slate-700"><strong className="block text-[9px] uppercase tracking-wide text-blue-700">Only yours</strong>{diff.leftOnlySources.join(', ') || 'None'}</p>
              <p className="text-slate-700"><strong className="block text-[9px] uppercase tracking-wide text-violet-700">Only theirs</strong>{diff.rightOnlySources.join(', ') || 'None'}</p>
            </div>
          </section>

          <div className="mt-5 space-y-3">
            {diff.claims.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
                <p className="text-sm font-semibold text-slate-600">Neither explanation records a finding yet</p>
                <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-slate-500">
                  Findings — claims with a conclusion and linked evidence — are what this view compares. Add some to either side.
                </p>
              </div>
            ) : diff.claims.map((claim) => <ClaimRow key={`${claim.status}-${claim.key}`} claim={claim} />)}
          </div>

          <p className="mt-8 border-t border-slate-200 pt-4 text-[10px] leading-5 text-slate-500">
            Findings are paired by how similarly their claims are worded, which is approximate — check the pairings before
            drawing conclusions from the counts. Both accounts are frozen; neither is modified by this comparison.
          </p>
        </div>
      </main>
    </div>
  );
};
