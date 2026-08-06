import { describe, expect, it } from 'vitest';
import {
  buildContributionSelects,
  buildCriterionExpression,
  buildScoreExpression,
  contributionAlias,
  equalWeightedScoreModel,
  normalisedWeights,
  perturbedScoreModel,
  scoreModelErrors,
  ScoreCompileError,
} from './scoreModel';
import type { ScoreCriterion, ScoreModelSpec } from '../types/visualAnalytics';

const criterion = (patch: Partial<ScoreCriterion> = {}): ScoreCriterion => ({
  field: 'heat', weight: 1, direction: 'higher', normalisation: 'min-max', ...patch,
});

const model = (criteria: ScoreCriterion[], missingValueTreatment: ScoreModelSpec['missingValueTreatment'] = 'zero'): ScoreModelSpec =>
  ({ criteria, missingValueTreatment });

describe('score model compilation', () => {
  it('weights each criterion by its share of the total weight', () => {
    const sql = buildScoreExpression(model([
      criterion({ field: 'heat', weight: 3 }),
      criterion({ field: 'imd', weight: 1 }),
    ]));
    expect(sql).toContain('(0.75) *');
    expect(sql).toContain('(0.25) *');
  });

  it('keeps the score on the same scale when weights do not sum to one', () => {
    const proportional = buildScoreExpression(model([criterion({ weight: 30 }), criterion({ field: 'imd', weight: 10 })]));
    const normalised = buildScoreExpression(model([criterion({ weight: 0.75 }), criterion({ field: 'imd', weight: 0.25 })]));
    expect(proportional).toBe(normalised);
  });

  it('drops zero-weighted criteria rather than letting them dilute the total', () => {
    const sql = buildScoreExpression(model([criterion({ weight: 1 }), criterion({ field: 'ignored', weight: 0 })]));
    expect(sql).not.toContain('ignored');
    expect(sql).toContain('(1) *');
  });

  it('returns NULL when nothing carries weight, so a broken model reads as absent', () => {
    expect(buildScoreExpression(model([]))).toBe('NULL');
    expect(buildScoreExpression(model([criterion({ weight: 0 })]))).toBe('NULL');
  });

  describe('direction', () => {
    it('inverts a min-max criterion when lower is better', () => {
      expect(buildCriterionExpression(criterion({ direction: 'lower' }))).toMatch(/^\(1 - \(/);
    });

    it('negates a z-score rather than subtracting it from one, because z is unbounded', () => {
      const sql = buildCriterionExpression(criterion({ direction: 'lower', normalisation: 'z-score' }));
      expect(sql).toMatch(/^-\(/);
      expect(sql).not.toContain('1 - ');
    });

    it('reverses the window ordering for a rank criterion', () => {
      expect(buildCriterionExpression(criterion({ direction: 'lower', normalisation: 'rank' }))).toContain('DESC)');
      expect(buildCriterionExpression(criterion({ direction: 'higher', normalisation: 'rank' }))).toContain('ASC)');
    });
  });

  describe('normalisation', () => {
    it('normalises min-max across the whole result set', () => {
      const sql = buildCriterionExpression(criterion());
      expect(sql).toContain('MIN(');
      expect(sql).toContain('OVER ()');
      expect(sql).toContain('NULLIF(');
    });

    it('uses population standard deviation for z-scores', () => {
      expect(buildCriterionExpression(criterion({ normalisation: 'z-score' }))).toContain('STDDEV_POP(');
    });

    it('uses PERCENT_RANK for rank normalisation', () => {
      expect(buildCriterionExpression(criterion({ normalisation: 'rank' }))).toContain('PERCENT_RANK()');
    });
  });

  describe('missing values', () => {
    it('substitutes zero', () => {
      expect(buildCriterionExpression(criterion(), 'zero')).toContain('COALESCE(TRY_CAST("heat" AS DOUBLE), 0)');
    });

    it('substitutes the column mean from a scalar subquery, not a nested window', () => {
      const sql = buildCriterionExpression(criterion(), 'mean', { relation: '"wards"' });
      expect(sql).toContain('(SELECT AVG(TRY_CAST("heat" AS DOUBLE)) FROM "wards")');
      // The regression this guards: `AVG(x) OVER ()` inside a normalisation
      // window is a window nested in a window definition, which DuckDB rejects.
      expect(sql).not.toContain('AVG(TRY_CAST("heat" AS DOUBLE)) OVER ()');
    });

    it('composes the mean substitution with every normalisation without nesting windows', () => {
      for (const normalisation of ['min-max', 'z-score', 'rank'] as const) {
        const sql = buildCriterionExpression(criterion({ normalisation }), 'mean', { relation: '"wards"' });
        expect(sql).toContain('SELECT AVG(');
        // No `OVER ()` may appear inside the ORDER BY or argument of another window.
        expect(/OVER \([^)]*OVER \(/.test(sql)).toBe(false);
      }
    });

    it('refuses to compile the mean policy without knowing what to average over', () => {
      expect(() => buildCriterionExpression(criterion(), 'mean')).toThrow(ScoreCompileError);
      expect(() => buildScoreExpression(model([criterion()], 'mean'))).toThrow('which relation');
    });

    it('lets the null through when the policy is to exclude, so the row scores NULL', () => {
      const sql = buildCriterionExpression(criterion(), 'exclude');
      expect(sql).not.toContain('COALESCE');
    });
  });

  it('quotes field names so columns needing escaping still compile', () => {
    expect(buildCriterionExpression(criterion({ field: 'heat "demand"' }))).toContain('"heat ""demand"""');
  });

  it('builds an equal-weighted starting model', () => {
    const spec = equalWeightedScoreModel(['a', 'b', 'c', 'd']);
    expect(spec.criteria).toHaveLength(4);
    expect(spec.criteria.every((item) => item.weight === 0.25)).toBe(true);
    expect(spec.missingValueTreatment).toBe('zero');
  });
});

describe('contributions', () => {
  it('emits one column per weighted criterion, named from the score field', () => {
    const contributions = buildContributionSelects(model([criterion({ field: 'heat', weight: 3 }), criterion({ field: 'imd', weight: 1 })]), 'priority');
    expect(contributions.map((item) => item.alias)).toEqual(['priority_c_heat', 'priority_c_imd']);
  });

  it('shares out the same weights the score uses, so contributions sum to it', () => {
    const spec = model([criterion({ field: 'heat', weight: 3 }), criterion({ field: 'imd', weight: 1 })]);
    const summed = buildContributionSelects(spec, 'priority').map((item) => item.expression).join(' + ');
    expect(summed).toBe(buildScoreExpression(spec));
  });

  it('skips criteria carrying no weight', () => {
    const contributions = buildContributionSelects(model([criterion({ weight: 1 }), criterion({ field: 'ignored', weight: 0 })]), 'score');
    expect(contributions).toHaveLength(1);
  });

  it('returns nothing for a model that cannot score', () => {
    expect(buildContributionSelects(model([]), 'score')).toEqual([]);
  });

  it('sanitises an alias built from an awkward column name', () => {
    expect(contributionAlias('score', 'heat (kWh)')).toBe('score_c_heat__kWh_');
  });
});

describe('weights and sensitivity', () => {
  it('reports each criterion share of the total weight', () => {
    const weights = normalisedWeights(model([criterion({ field: 'heat', weight: 3 }), criterion({ field: 'imd', weight: 1 })]));
    expect(weights.get('heat')).toBeCloseTo(0.75);
    expect(weights.get('imd')).toBeCloseTo(0.25);
  });

  it('nudges one weight and leaves the others alone', () => {
    const spec = model([criterion({ field: 'heat', weight: 2 }), criterion({ field: 'imd', weight: 1 })]);
    const perturbed = perturbedScoreModel(spec, 'heat', 0.25);
    expect(perturbed.criteria[0].weight).toBeCloseTo(2.5);
    expect(perturbed.criteria[1].weight).toBe(1);
  });

  it('never drives a weight below zero', () => {
    expect(perturbedScoreModel(model([criterion({ weight: 1 })]), 'heat', -2).criteria[0].weight).toBe(0);
  });
});

describe('validation', () => {
  it('accepts a well-formed model', () => {
    expect(scoreModelErrors(model([criterion()]))).toEqual([]);
  });

  it('requires a criterion', () => {
    expect(scoreModelErrors(model([]))).toContain('Add at least one criterion.');
  });

  it('requires some weight somewhere', () => {
    expect(scoreModelErrors(model([criterion({ weight: 0 })]))).toContain('At least one weight must be above zero.');
  });

  it('catches the same column weighted twice', () => {
    const errors = scoreModelErrors(model([criterion({ field: 'heat' }), criterion({ field: 'heat' })]));
    expect(errors.some((error) => error.includes('used twice'))).toBe(true);
  });
});
