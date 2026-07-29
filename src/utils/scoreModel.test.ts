import { describe, expect, it } from 'vitest';
import { buildCriterionExpression, buildScoreExpression, equalWeightedScoreModel } from './scoreModel';
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

    it('substitutes the column mean', () => {
      expect(buildCriterionExpression(criterion(), 'mean')).toContain('AVG(TRY_CAST("heat" AS DOUBLE)) OVER ()');
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
