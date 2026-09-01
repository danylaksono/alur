import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { buildWorkflowSQL, cteAlias } from '../../utils/workflowEngine';
import { queryConstraintFunnel } from '../../services/filterFunnelService';
import type { ConstraintFunnel, FilterPredicate } from '../../utils/filterPredicates';
import { cn } from '../../utils/cn';

/**
 * Shows how much each condition actually removes, measured against the real
 * upstream rows rather than estimated.
 *
 * The bar is the share of the source still standing after each condition, so a
 * constraint that does nothing is visibly flat and one that empties the result
 * is visibly a cliff.
 */
export const ConstraintFunnelStrip = ({ nodeId, predicates }: { nodeId: string; predicates: FilterPredicate[] }) => {
  const [funnel, setFunnel] = useState<ConstraintFunnel | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const { nodes, edges, fragments } = useStore.getState();
      const source = edges.find((edge) => edge.target === nodeId)?.source;
      if (!source) throw new Error('Connect this filter to a source first.');
      const { withClause } = buildWorkflowSQL(nodes, edges, { fragments });
      setFunnel(await queryConstraintFunnel({ relation: cteAlias(source), withClause, predicates }));
    } catch (err: any) {
      setFunnel(null);
      setError(err?.message || 'Could not measure these conditions.');
    } finally {
      setBusy(false);
    }
  };

  const share = (value: number) => (funnel && funnel.total > 0 ? Math.max(0, Math.min(1, value / funnel.total)) : 0);

  return (
    <div className="nodrag rounded-md border border-slate-200 bg-slate-50/60 p-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">What each one removes</span>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="pressable flex items-center gap-1 rounded px-1 text-[10px] font-bold text-amber-700 hover:bg-amber-50 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
          {funnel ? 'Recheck' : 'Check'}
        </button>
      </div>

      {error && <p className="mt-1 text-[10px] leading-4 text-rose-600">{error}</p>}

      {funnel && (
        <div className="mt-1.5 space-y-1.5">
          <div className="text-[10px] font-semibold tabular-nums text-slate-600">
            {funnel.kept.toLocaleString()} of {funnel.total.toLocaleString()} rows kept
          </div>

          {funnel.steps.map((step) => (
            <div key={step.id}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 flex-1 truncate text-[10px] text-slate-700" title={step.label}>{step.label}</span>
                <span className="shrink-0 text-[10px] tabular-nums text-slate-500">
                  {step.remaining === null
                    ? `${step.removedAlone.toLocaleString()} tagged`
                    : `−${(step.removedHere ?? 0).toLocaleString()}`}
                </span>
              </div>
              <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div
                  className={cn('h-full rounded-full', step.severity === 'soft' ? 'bg-slate-400' : 'bg-amber-500')}
                  style={{ width: `${share(step.remaining ?? funnel.total - step.removedAlone) * 100}%` }}
                />
              </div>
              {/* Alone vs in sequence: the gap is what says whether a condition
                  is doing work or is already implied by the ones before it. */}
              {step.removedHere !== null && step.removedAlone !== step.removedHere && (
                <div className="text-[9px] leading-3 text-slate-400">
                  removes {step.removedAlone.toLocaleString()} on its own
                </div>
              )}
            </div>
          ))}

          {funnel.warnings.map((warning) => (
            <p key={warning} className="text-[10px] leading-4 text-amber-700">{warning}</p>
          ))}
        </div>
      )}
    </div>
  );
};
