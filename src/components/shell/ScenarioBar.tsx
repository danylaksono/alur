import { GitBranch } from 'lucide-react';
import { useMemo } from 'react';
import { useStore } from '../../store/useStore';
import { cn } from '../../utils/cn';

/**
 * Which scenario the workspace is standing in, always visible.
 *
 * Planning tools converged on this years ago: the scenario switcher belongs to
 * the view, not to a tool panel, because "which scenario am I looking at" is a
 * property of what is on screen. ALUR previously answered it two clicks deep
 * inside a collapsed disclosure in the node palette, which meant the honest
 * answer most of the time was that the analyst did not know.
 *
 * Baseline is always present and always first — it is the state before anything
 * was branched, and a comparison without it has nothing to be a change *from*.
 */
export const ScenarioBar = () => {
  const allVariants = useStore((state) => state.visualAnalytics.variants);
  const datasets = useStore((state) => state.datasetRegistry);
  const activeSessionId = useStore((state) => state.visualAnalytics.activeSessionId);
  const activeVariantId = useStore((state) => state.visualAnalytics.activeVariantId);
  const setActiveVariant = useStore((state) => state.setActiveVariant);
  const branchVariant = useStore((state) => state.branchVariant);
  const navigate = useStore((state) => state.navigate);

  const variants = useMemo(
    () => (activeSessionId ? allVariants.filter((variant) => variant.sessionId === activeSessionId) : allVariants),
    [allVariants, activeSessionId],
  );

  // Nothing to switch between is nothing to show. A bar reading "Baseline" and
  // nothing else costs a row of chrome to state the obvious.
  if (!variants.length) return null;

  const active = variants.find((variant) => variant.id === activeVariantId);

  return (
    <div
      className="flex min-h-9 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-slate-200 bg-white px-3 py-1.5"
      role="group"
      aria-label="Scenario"
    >
      <button
        type="button"
        onClick={() => setActiveVariant(undefined)}
        aria-pressed={!activeVariantId}
        // Switching is the whole point of the bar and happens constantly, so it
        // is a colour change and a press, never a movement.
        className={cn(
          'pressable flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] transition-colors duration-hover',
          !activeVariantId
            ? 'border-slate-900 bg-slate-900 font-bold text-white'
            : 'border-slate-200 text-slate-600 hover:bg-slate-50',
        )}
      >
        Baseline
      </button>

      {variants.map((variant) => {
        const ready = Boolean(variant.workflowOutputDatasetId && datasets[variant.workflowOutputDatasetId]);
        const isActive = variant.id === activeVariantId;
        return (
          <button
            key={variant.id}
            type="button"
            onClick={() => setActiveVariant(variant.id)}
            aria-pressed={isActive}
            title={ready ? `${variant.name} — result ready` : `${variant.name} — not run`}
            className={cn(
              'pressable flex max-w-[14rem] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] transition-colors duration-hover',
              isActive
                ? 'border-slate-900 bg-slate-900 font-bold text-white'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50',
            )}
          >
            {/* Run state as a dot, not a word. Filled means there is a result. */}
            <span
              className={cn(
                'h-1.5 w-1.5 shrink-0 rounded-full',
                ready ? 'bg-emerald-500' : 'bg-amber-500',
              )}
            />
            <span className="truncate">{variant.name}</span>
          </button>
        );
      })}

      {/* Branching should feel free, so the affordance sits inline with the
          scenarios rather than behind a menu. */}
      <button
        type="button"
        onClick={() => (active ? branchVariant(active.id) : navigate('scenarios'))}
        title={active ? `Branch ${active.name}` : 'Open scenarios'}
        aria-label={active ? `Branch ${active.name}` : 'Open scenarios'}
        className="pressable flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-[10px] text-slate-400 transition-colors duration-hover hover:border-slate-400 hover:text-slate-600"
      >
        <GitBranch className="h-3 w-3" /> Branch
      </button>
    </div>
  );
};
