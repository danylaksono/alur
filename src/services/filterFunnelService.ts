import { duckdbService } from './duckdb';
import {
  activeFilterPredicates,
  buildFunnelQuery,
  filterPredicateErrors,
  type ConstraintFunnel,
  type FilterPredicate,
  type FunnelStep,
} from '../utils/filterPredicates';

/**
 * Measures how much each condition in a filter actually removes.
 *
 * Runs against whatever relation the filter sits on — a table for a standalone
 * check, a CTE alias for a node partway through a workflow — so the counts are
 * the ones the workflow would produce, not an approximation of them.
 */

const normaliseRows = (rows: any[]) => rows.map((row) => (typeof row?.toJSON === 'function' ? row.toJSON() : row));
const count = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

export const queryConstraintFunnel = async ({
  relation,
  withClause = '',
  predicates,
}: {
  /** Quoted table name or CTE alias. */
  relation: string;
  /** Leading `WITH …` when the relation is a workflow CTE. */
  withClause?: string;
  predicates: FilterPredicate[];
}): Promise<ConstraintFunnel> => {
  const errors = filterPredicateErrors(predicates);
  if (errors.length || !relation) {
    return { total: 0, kept: 0, steps: [], warnings: errors.length ? errors : ['Nothing to measure yet.'] };
  }

  const active = activeFilterPredicates(predicates);
  const { selects, steps } = buildFunnelQuery(active);
  const result = await duckdbService.query(`${withClause} SELECT ${selects.join(', ')} FROM ${relation};`);
  const row = normaliseRows(result.toArray())[0] || {};

  const total = count(row.total);
  let previousRemaining = total;
  const resolved: FunnelStep[] = steps.map((step) => {
    const removedAlone = total - count(row[step.soloKey]);
    if (!step.cumulativeKey) {
      // A soft condition removes nothing, so it has no place in the sequence.
      // Its solo count still says what it would cost if it were made hard.
      return { id: step.id, label: step.label, severity: step.severity, removedAlone, remaining: null, removedHere: null };
    }
    const remaining = count(row[step.cumulativeKey]);
    const removedHere = previousRemaining - remaining;
    previousRemaining = remaining;
    return { id: step.id, label: step.label, severity: step.severity, removedAlone, remaining, removedHere };
  });

  const warnings: string[] = [];
  if (total > 0 && previousRemaining === 0) warnings.push('These conditions remove every row. Loosen one, or make it soft so it annotates instead.');
  // A condition that removes a great deal alone but almost nothing in sequence
  // is already implied by the ones before it — worth saying, because it is
  // invisible from the surviving row count.
  const redundant = resolved.filter((step) => step.removedHere !== null && step.removedAlone > 0 && step.removedHere / step.removedAlone < 0.05);
  if (redundant.length) {
    warnings.push(`${redundant.map((step) => `"${step.label}"`).join(', ')} removes almost nothing the earlier conditions had not already removed.`);
  }

  return { total, kept: previousRemaining, steps: resolved, warnings };
};
