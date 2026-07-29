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

/**
 * Where the column mean comes from when the policy is to substitute it.
 *
 * The obvious `AVG(x) OVER ()` cannot be used: every normalisation below is
 * itself a window function, and DuckDB rejects a window nested inside a window
 * definition. A scalar subquery over the same relation is evaluated once and
 * composes anywhere, so the caller supplies the relation the score is being
 * computed over — a table name for a live preview, a CTE alias inside a
 * compiled workflow.
 */
export type ScoreCompileOptions = { relation?: string };

export class ScoreCompileError extends Error {}

/** Row value after the missing-value policy, before normalisation. */
const criterionValue = (
  criterion: ScoreCriterion,
  treatment: ScoreModelSpec['missingValueTreatment'],
  options: ScoreCompileOptions,
) => {
  const numeric = `TRY_CAST(${quoteIdentifier(criterion.field)} AS DOUBLE)`;
  if (treatment === 'zero') return `COALESCE(${numeric}, 0)`;
  if (treatment === 'mean') {
    if (!options.relation) {
      throw new ScoreCompileError('Substituting the column mean needs to know which relation to average over.');
    }
    return `COALESCE(${numeric}, (SELECT AVG(${numeric}) FROM ${options.relation}))`;
  }
  // 'exclude': the NULL survives, so the whole score is NULL and the row drops
  // out of the ranking rather than being scored on partial evidence.
  return numeric;
};

/** Normalised, direction-corrected contribution of one criterion, before weighting. */
export const buildCriterionExpression = (
  criterion: ScoreCriterion,
  treatment: ScoreModelSpec['missingValueTreatment'] = 'zero',
  options: ScoreCompileOptions = {},
) => {
  const value = criterionValue(criterion, treatment, options);
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

const weightedCriteria = (spec: ScoreModelSpec) =>
  spec.criteria.filter((criterion) => Boolean(criterion.field) && Number.isFinite(criterion.weight) && criterion.weight !== 0);

const totalWeight = (criteria: ScoreCriterion[]) =>
  criteria.reduce((total, criterion) => total + Math.abs(criterion.weight), 0);

/**
 * The full weighted score. Returns `NULL` for an empty or zero-weighted model
 * so a misconfigured score reads as absent rather than as a uniform zero.
 */
export const buildScoreExpression = (spec: ScoreModelSpec, options: ScoreCompileOptions = {}): string => {
  const weighted = weightedCriteria(spec);
  const total = totalWeight(weighted);
  if (!weighted.length || total === 0) return 'NULL';

  return weighted
    .map((criterion) => `(${criterion.weight / total}) * (${buildCriterionExpression(criterion, spec.missingValueTreatment, options)})`)
    .join(' + ');
};

/** Equal-weighted model over the given fields — the starting point before the user edits weights. */
export const equalWeightedScoreModel = (fields: string[]): ScoreModelSpec => ({
  criteria: fields.map((field) => ({ field, weight: 1 / fields.length, direction: 'higher', normalisation: 'min-max' })),
  missingValueTreatment: 'zero',
});

const sanitise = (name: string) => name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^(\d)/, '_$1');

/** Column holding one criterion's weighted share of the total score. */
export const contributionAlias = (resultField: string, field: string) => sanitise(`${resultField}_c_${field}`);

/**
 * Each criterion's weighted contribution, as its own column.
 *
 * These are what makes a ranking arguable rather than merely visible: with
 * them in the data you can chart, map, sort and pin the reason a candidate
 * ranked where it did, instead of taking the total on trust. They sum to the
 * score, so a stacked bar of them is exact rather than indicative.
 */
export const buildContributionSelects = (spec: ScoreModelSpec, resultField: string, options: ScoreCompileOptions = {}) => {
  const weighted = weightedCriteria(spec);
  const total = totalWeight(weighted);
  if (!weighted.length || total === 0) return [];
  return weighted.map((criterion) => ({
    field: criterion.field,
    alias: contributionAlias(resultField, criterion.field),
    expression: `(${criterion.weight / total}) * (${buildCriterionExpression(criterion, spec.missingValueTreatment, options)})`,
  }));
};

export const scoreModelErrors = (spec: ScoreModelSpec) => {
  const errors: string[] = [];
  if (!spec.criteria.length) errors.push('Add at least one criterion.');
  if (spec.criteria.some((criterion) => !Number.isFinite(criterion.weight))) errors.push('Every criterion needs a finite weight.');
  else if (spec.criteria.length && spec.criteria.every((criterion) => criterion.weight === 0)) errors.push('At least one weight must be above zero.');
  if (spec.criteria.some((criterion) => !criterion.field)) errors.push('Every criterion needs a column.');
  const fields = spec.criteria.map((criterion) => criterion.field);
  const duplicate = fields.find((field, index) => fields.indexOf(field) !== index);
  if (duplicate) errors.push(`"${duplicate}" is used twice. Weight it once instead.`);
  return errors;
};

/** Weights as shares of the total, which is how they actually enter the score. */
export const normalisedWeights = (spec: ScoreModelSpec) => {
  const weighted = weightedCriteria(spec);
  const total = totalWeight(weighted);
  return new Map(weighted.map((criterion) => [criterion.field, total === 0 ? 0 : Math.abs(criterion.weight) / total]));
};

/**
 * The same model with one criterion's weight nudged, for asking how much the
 * ranking depends on that choice. Other weights are left alone: they are
 * renormalised downstream anyway, so nudging one genuinely shifts its share.
 */
export const perturbedScoreModel = (spec: ScoreModelSpec, field: string, delta: number): ScoreModelSpec => ({
  ...spec,
  criteria: spec.criteria.map((criterion) => criterion.field === field
    ? { ...criterion, weight: Math.max(0, criterion.weight * (1 + delta)) }
    : criterion),
});
