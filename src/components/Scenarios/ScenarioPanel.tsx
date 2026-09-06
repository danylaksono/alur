import { useMemo, useState } from 'react';
import { GitBranch, GitCompareArrows, Play, Plus } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { buildVariantTree, flattenVariantTree, formatVariantValue, type VariantDifference } from '../../utils/variantLineage';
import { comparableVariants, comparisonFromVariants } from '../../utils/scenarioComparison';
import { parametersUsed } from '../../utils/workflowParameters';
import { sweepVariants } from '../../services/variantSweepService';
import { cn } from '../../utils/cn';

/** Deepest indent the panel will render; past this, nesting stops earning width. */
const MAX_INDENT = 4;

/**
 * What a scenario changed, rendered instead of described.
 *
 * `variantDifferences` already humanises the paths and both values, so a row
 * needs no prose around it: `uptake 0.30 → 0.45` states the claim more precisely
 * than a sentence would, in less space, and stays true when the value changes.
 */
const Delta = ({ differences }: { differences: VariantDifference[] }) => {
  if (!differences.length) return null;
  const shown = differences.slice(0, 3);
  return (
    <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 font-mono text-[11px] leading-4">
      {shown.map((difference) => (
        <span key={difference.path} className="whitespace-nowrap">
          <span className="text-slate-500">{difference.path.split('.').slice(-2).join('.')}</span>{' '}
          <span className="text-slate-500 line-through">{formatVariantValue(difference.before)}</span>{' '}
          <span className="text-slate-500">→</span>{' '}
          <span className="font-semibold text-emerald-700">{formatVariantValue(difference.after)}</span>
        </span>
      ))}
      {differences.length > shown.length && (
        <span className="text-slate-500">+{differences.length - shown.length} more</span>
      )}
    </div>
  );
};

/**
 * Scenarios, as a lineage rather than a form.
 *
 * This replaces the disclosure that used to sit at the bottom of the node
 * palette. That panel asked the analyst to build a score before they could have
 * a scenario at all, which is why it grew a second, worse copy of the score
 * panel; here a scenario receives its content from whichever bench produced it
 * and this panel only ever shows, branches, runs and compares them.
 */
export const ScenarioPanel = () => {
  const datasets = useStore((state) => state.datasetRegistry);
  const allVariants = useStore((state) => state.visualAnalytics.variants);
  const sessions = useStore((state) => state.visualAnalytics.sessions);
  const activeSessionId = useStore((state) => state.visualAnalytics.activeSessionId);
  const activeVariantId = useStore((state) => state.visualAnalytics.activeVariantId);
  const updateSession = useStore((state) => state.updateSession);
  const setActiveSession = useStore((state) => state.setActiveSession);
  const setActiveVariant = useStore((state) => state.setActiveVariant);
  const branchVariant = useStore((state) => state.branchVariant);
  const addComparison = useStore((state) => state.addComparison);
  const setActiveComparison = useStore((state) => state.setActiveComparison);
  const addToast = useStore((state) => state.addToast);
  const navigate = useStore((state) => state.navigate);
  const nodes = useStore((state) => state.nodes);

  const [sweeping, setSweeping] = useState(false);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId),
    [sessions, activeSessionId],
  );

  // Only this question's scenarios. Two questions asked of the same data are two
  // arguments, and interleaving their branches reads as one.
  const variants = useMemo(
    () => (activeSessionId ? allVariants.filter((variant) => variant.sessionId === activeSessionId) : allVariants),
    [allVariants, activeSessionId],
  );

  const rows = useMemo(() => flattenVariantTree(buildVariantTree(variants)), [variants]);
  const comparable = useMemo(() => comparableVariants(variants, datasets), [variants, datasets]);
  const parameters = useMemo(() => parametersUsed(nodes), [nodes]);
  const pending = variants.length - comparable.length;

  const runSweep = async () => {
    setSweeping(true);
    try {
      const report = await sweepVariants(variants);
      addToast({
        type: report.failed ? 'warning' : 'success',
        message: report.failed
          ? `Ran ${report.ok} of ${report.outcomes.length} scenarios. ${report.outcomes.find((outcome) => outcome.status === 'failed')?.error || ''}`
          : `Ran all ${report.ok} scenarios. Each result is registered under its own scenario.`,
      });
    } finally {
      setSweeping(false);
    }
  };

  const compareScenarios = () => {
    const spec = comparisonFromVariants(variants, datasets);
    if (!spec) return;
    addComparison(spec);
    setActiveComparison(spec.id);
    navigate('compare');
    addToast({ type: 'success', message: `Comparing ${spec.operands.length} scenario results on shared scales.` });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="shrink-0 border-b bg-slate-50 px-4 py-3">
        {/* The question is the panel's title, not a labelled field. An analyst
            reading "Where should the new clinics go?" needs no caption telling
            them it is a line of enquiry. */}
        {activeSession ? (
          <input
            value={activeSession.question}
            onChange={(event) => updateSession(activeSession.id, { question: event.target.value })}
            placeholder="What is this asking?"
            aria-label="Question"
            className="w-full bg-transparent text-[13px] font-bold leading-5 text-slate-800 placeholder:font-medium placeholder:text-slate-500 focus:outline-none"
          />
        ) : (
          <h3 className="text-[13px] font-bold text-slate-800">Scenarios</h3>
        )}
        {sessions.length > 1 && (
          <select
            value={activeSessionId || ''}
            onChange={(event) => setActiveSession(event.target.value || undefined)}
            aria-label="Question"
            className="mt-1.5 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600"
          >
            <option value="">All questions</option>
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>{session.name}</option>
            ))}
          </select>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {!rows.length ? (
          <p className="px-1 py-3 text-[11px] leading-5 text-slate-500">
            No scenarios yet. Build a score or a cohort, then add it to a scenario — this panel will
            show what came from what.
          </p>
        ) : (
          <ol className="flex flex-col">
            {rows.map((row) => {
              const ready = Boolean(row.variant.workflowOutputDatasetId && datasets[row.variant.workflowOutputDatasetId]);
              const isActive = row.variant.id === activeVariantId;
              return (
                <li
                  key={row.variant.id}
                  style={{ marginLeft: `${Math.min(row.depth, MAX_INDENT) * 10}px` }}
                  className={cn('py-1', row.depth > 0 && 'border-l border-slate-200 pl-2')}
                >
                  <div className="group flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setActiveVariant(isActive ? undefined : row.variant.id)}
                      aria-pressed={isActive}
                      className={cn(
                        'pressable flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left',
                        // Switching scenario happens constantly, so it stays a
                        // colour change only — no movement on the row itself.
                        'transition-colors duration-hover',
                        isActive ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50',
                      )}
                    >
                      <span
                        className={cn('h-1.5 w-1.5 shrink-0 rounded-full', ready ? 'bg-emerald-500' : 'bg-amber-500')}
                        title={ready ? 'Result ready' : 'Not run'}
                      />
                      <span className="truncate text-[11px] font-semibold">{row.variant.name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => branchVariant(row.variant.id)}
                      aria-label={`Branch ${row.variant.name}`}
                      title={`Branch ${row.variant.name}`}
                      className="pressable rounded p-1 text-slate-400 transition-colors duration-hover hover:bg-slate-50 hover:text-emerald-600 focus-visible:text-emerald-600"
                    >
                      <GitBranch className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {row.depth > 0 && (
                    <div className="pl-[26px]">
                      <Delta differences={row.differencesFromParent} />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {variants.length > 1 && (
        <div className="flex shrink-0 flex-col gap-1.5 border-t bg-slate-50/60 p-3">
          <button
            type="button"
            disabled={sweeping}
            onClick={runSweep}
            className="pressable flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold text-slate-700 transition-colors duration-hover hover:bg-slate-50 disabled:opacity-40"
          >
            <Play className="h-3 w-3" />
            {sweeping ? 'Running…' : pending ? `Run all · ${pending} pending` : `Run all ${variants.length}`}
          </button>
          <button
            type="button"
            disabled={comparable.length < 2}
            onClick={compareScenarios}
            className="pressable flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-[11px] font-bold text-white transition-colors duration-hover hover:bg-black disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <GitCompareArrows className="h-3 w-3" /> Compare {comparable.length > 1 ? comparable.length : ''} scenarios
          </button>
          {/* Name what is missing rather than leaving a dead control unexplained. */}
          {comparable.length < 2 && (
            <p className="text-center text-[11px] leading-4 text-slate-500">
              Run at least two scenarios to compare them.
            </p>
          )}
          {parameters.length > 0 && (
            <p className="text-[11px] leading-4 text-slate-500">
              Each run substitutes {parameters.join(', ')} from the scenario.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * The empty-state affordance, shown when a bench has nothing to add to yet.
 *
 * Kept here rather than in the benches so the copy stays in one place as the
 * "add to scenario" footer lands on Score, Cohorts and Calculations.
 */
export const StartScenarioButton = ({ onClick }: { onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    className="pressable flex w-full items-center justify-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-bold text-slate-600 transition-colors duration-hover hover:bg-slate-50"
  >
    <Plus className="h-2.5 w-2.5" /> New scenario
  </button>
);
