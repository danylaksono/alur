import { GitBranch, Workflow } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { cn } from '../../utils/cn';
import { formatVariantValue, variantLineageSnapshot, type VariantLineageSnapshot } from '../../utils/variantLineage';

/**
 * Renders how the scenarios in an analysis came to be.
 *
 * The tree answers "where did this come from"; the per-branch differences
 * answer "and what did you change". Both were recorded on every variant from
 * the start and shown nowhere, so an account could describe a scenario's
 * result without ever describing its derivation.
 *
 * Given a `snapshot` it renders that and touches no store — which is what a
 * shared story needs, since it is read in a browser holding none of this.
 */
export const VariantLineageCard = ({ snapshot, presenting = false }: { snapshot?: VariantLineageSnapshot; presenting?: boolean }) => {
  const variants = useStore((state) => state.visualAnalytics.variants);
  const registry = useStore((state) => state.datasetRegistry);
  const live = variantLineageSnapshot(variants, (variant) => Boolean(variant.workflowOutputDatasetId && registry[variant.workflowOutputDatasetId]));
  const lineage = snapshot ?? live;

  const heading = (
    <div className="flex items-center gap-2">
      <Workflow className="h-4 w-4 text-emerald-600" />
      <h3 className="text-sm font-bold text-slate-800">Scenario lineage</h3>
      {lineage.rows.length > 0 && (
        <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">
          {lineage.rows.length} scenario{lineage.rows.length === 1 ? '' : 's'}
        </span>
      )}
    </div>
  );

  if (!lineage.rows.length) {
    return (
      <div>
        {heading}
        <p className="mt-3 text-xs leading-5 text-slate-400">
          No scenarios yet. Open Analyse › Scenarios and branch one — this card will show what came from what.
        </p>
      </div>
    );
  }

  return (
    <div>
      {heading}
      <ol className="mt-3 space-y-3">
        {lineage.rows.map((row) => (
          <li key={row.id} style={{ marginLeft: `${Math.min(row.depth, 4) * 14}px` }} className={cn(row.depth > 0 && 'border-l-2 border-slate-200 pl-3')}>
            <div className="flex flex-wrap items-baseline gap-x-2">
              {row.depth > 0 && <GitBranch className="h-3 w-3 shrink-0 text-slate-400" />}
              <span className="text-xs font-bold text-slate-800">{row.name}</span>
              <span className={cn('text-[9px] font-semibold uppercase tracking-wide', row.hasResult ? 'text-emerald-600' : 'text-slate-400')}>
                {row.hasResult ? 'result available' : 'not run'}
              </span>
            </div>

            {row.depth > 0 && (
              row.differences.length ? (
                <ul className="mt-1 space-y-0.5">
                  {row.differences.map((difference) => (
                    <li key={difference.path} className="text-[10px] leading-4 text-slate-600">
                      <span className="font-mono text-[9px] text-slate-500">{difference.path}</span>
                      {' '}
                      <span className="text-slate-400">{formatVariantValue(difference.before)}</span>
                      {' → '}
                      <span className="font-semibold text-slate-800">{formatVariantValue(difference.after)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                // A common state, and silence here would read as "nothing was
                // recorded" rather than "nothing was changed".
                <p className="mt-1 text-[10px] leading-4 text-slate-400">Branched but not yet changed from its parent.</p>
              )
            )}

            {row.assumptions.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {row.assumptions.map((assumption) => (
                  <li key={assumption} className="text-[10px] leading-4 text-slate-500">· {assumption}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>

      {!presenting && !snapshot && (
        <p className="mt-3 border-t border-slate-100 pt-2 text-[9px] leading-4 text-slate-400">
          Read from the scenarios themselves, so this stays true as you branch and edit. It is frozen when shared.
        </p>
      )}
    </div>
  );
};
