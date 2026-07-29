import type { ScoreCriterion, ScoreModelSpec } from '../types/visualAnalytics';
import { quoteIdentifier } from './visualFilterSql';

/**
 * Compiles a weighted multi-criteria score into a single DuckDB expression.
 *
 * Criteria arrive on different scales, so each is normalised across the whole
 * result set before being weighted — which is why every method below is a
 * window function rather than a row-local calculation. Weights are divided by
 * their total, so a score stays on the same scale whether the user's weights
 * sum to 1, to 100, or to nothing in particular.
 *
 * This is deliberately a pure string builder with no store or engine access:
 * the same expression has to work inside an Attribute node, a preview query
 * and a sensitivity sweep.
 */

/** Row value after the missing-value policy, before normalisation. */
const criterionValue = (criterion: ScoreCriterion, treatment: ScoreModelSpec['missingValueTreatment']) => {
  const numeric = `TRY_CAST(${quoteIdentifier(criterion.field)} AS DOUBLE)`;
  if (treatment === 'zero') return `COALESCE(${numeric}, 0)`;
  if (treatment === 'mean') return `COALESCE(${numeric}, AVG(${numeric}) OVER ())`;
  // 'exclude': the NULL survives, so the whole score is NULL and the row drops
  // out of the ranking rather than being scored on partial evidence.
  return numeric;
};

/** Normalised, direction-corrected contribution of one criterion, before weighting. */
export const buildCriterionExpression = (
  criterion: ScoreCriterion,
  treatment: ScoreModelSpec['missingValueTreatment'] = 'zero',
) => {
  const value = criterionValue(criterion, treatment);
  const lowerIsBetter = criterion.direction === 'lower';

  if (criterion.normalisation === 'rank') {
    // Ordering the window is how direction is expressed here; inverting the
    // result afterwards would give the same answer less legibly.
    return `PERCENT_RANK() OVER (ORDER BY ${value} ${lowerIsBetter ? 'DESC' : 'ASC'})`;
  }

  if (criterion.normalisation === 'z-score') {
    const z = `(${value} - AVG(${value}) OVER ()) / NULLIF(STDDEV_POP(${value}) OVER (), 0)`;
    // z-scores are unbounded, so direction flips the sign rather than
    // subtracting from one.
    return lowerIsBetter ? `-(${z})` : z;
  }

  const minMax = `(${value} - MIN(${value}) OVER ()) / NULLIF(MAX(${value}) OVER () - MIN(${value}) OVER (), 0)`;
  return lowerIsBetter ? `(1 - (${minMax}))` : minMax;
};

/**
 * The full weighted score. Returns `NULL` for an empty or zero-weighted model
 * so a misconfigured score reads as absent rather than as a uniform zero.
 */
export const buildScoreExpression = (spec: ScoreModelSpec): string => {
  const weighted = spec.criteria.filter((criterion) => Number.isFinite(criterion.weight) && criterion.weight !== 0);
  const totalWeight = weighted.reduce((total, criterion) => total + Math.abs(criterion.weight), 0);
  if (!weighted.length || totalWeight === 0) return 'NULL';

  return weighted
    .map((criterion) => `(${criterion.weight / totalWeight}) * (${buildCriterionExpression(criterion, spec.missingValueTreatment)})`)
    .join(' + ');
};

/** Equal-weighted model over the given fields — the starting point before the user edits weights. */
export const equalWeightedScoreModel = (fields: string[]): ScoreModelSpec => ({
  criteria: fields.map((field) => ({ field, weight: 1 / fields.length, direction: 'higher', normalisation: 'min-max' })),
  missingValueTreatment: 'zero',
});
