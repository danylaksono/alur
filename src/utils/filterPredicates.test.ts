import { describe, it, expect } from 'vitest';
import {
  buildExclusionSelects,
  buildFunnelQuery,
  buildKeepExpression,
  exclusionColumns,
  filterPredicateErrors,
  predicateLabel,
  predicatePassesExpression,
  type FilterPredicate,
} from './filterPredicates';

const predicate = (over: Partial<FilterPredicate> = {}): FilterPredicate => ({
  id: 'p1',
  expression: 'area > 500',
  severity: 'hard',
  ...over,
});

describe('filterPredicates', () => {
  it('coalesces each condition so a NULL column counts as a failure', () => {
    // Without this, NOT (area > 500) is NULL for a NULL area: the row is
    // dropped by WHERE but records no reason for it.
    expect(predicatePassesExpression(predicate())).toBe('COALESCE((area > 500), FALSE)');
  });

  it('builds the keep clause from hard conditions only', () => {
    const keep = buildKeepExpression([
      predicate({ id: 'a', expression: 'a > 1' }),
      predicate({ id: 'b', expression: 'b > 2', severity: 'soft' }),
      predicate({ id: 'c', expression: 'c > 3' }),
    ]);
    expect(keep).toBe('COALESCE((a > 1), FALSE) AND COALESCE((c > 3), FALSE)');
  });

  it('has no keep clause when every condition is soft', () => {
    expect(buildKeepExpression([predicate({ severity: 'soft' })])).toBeNull();
  });

  it('names conditions by label, falling back to the expression', () => {
    expect(predicateLabel(predicate({ label: '  Big enough  ' }), 0)).toBe('Big enough');
    expect(predicateLabel(predicate(), 0)).toBe('area > 500');
  });

  it('records every failing condition, hard and soft, but only marks hard ones as excluding', () => {
    const selects = buildExclusionSelects([
      predicate({ id: 'a', label: 'Big enough', expression: 'a > 1' }),
      predicate({ id: 'b', label: 'Near a stop', expression: 'b > 2', severity: 'soft' }),
    ])!;

    expect(selects.inner[1]).toContain("THEN 'Big enough'");
    expect(selects.inner[1]).toContain("THEN 'Near a stop'");
    // The boolean is "would a hard condition have removed this", so the soft
    // one must not appear in it.
    expect(selects.inner[0]).toContain('COALESCE((a > 1), FALSE)');
    expect(selects.inner[0]).not.toContain('b > 2');
  });

  it('escapes quotes in a condition name', () => {
    const selects = buildExclusionSelects([predicate({ label: "Owner's land" })])!;
    expect(selects.inner[1]).toContain("'Owner''s land'");
  });

  it('marks nothing as excluded when every condition is soft', () => {
    const selects = buildExclusionSelects([predicate({ severity: 'soft' })])!;
    expect(selects.inner[0]).toContain('FALSE AS "alur_excluded"');
  });

  it('derives the readable reason and the count from one list rather than recomputing', () => {
    const selects = buildExclusionSelects([predicate(), predicate({ id: 'p2', expression: 'b > 2' })])!;
    expect(selects.outer.join(' ')).toContain('array_to_string("__alur_exclusion_reasons"');
    expect(selects.outer.join(' ')).toContain('len("__alur_exclusion_reasons")');
    // Each predicate is evaluated once in the inner pass and never again.
    expect(selects.outer.join(' ')).not.toContain('area > 500');
  });

  it('honours a custom column prefix', () => {
    const selects = buildExclusionSelects([predicate()], 'ineligible')!;
    expect(selects.columns).toEqual({ excluded: 'ineligible', reasons: 'ineligible_by', count: 'ineligible_count' });
    expect(selects.outer.join(' ')).toContain('"ineligible_by"');
  });

  it('returns null when there is nothing to record', () => {
    expect(buildExclusionSelects([])).toBeNull();
    expect(buildExclusionSelects([predicate({ expression: '   ' })])).toBeNull();
  });

  it('names the three columns it writes', () => {
    expect(exclusionColumns()).toEqual({ excluded: 'alur_excluded', reasons: 'alur_excluded_by', count: 'alur_excluded_count' });
  });

  describe('errors', () => {
    it('requires a condition', () => {
      expect(filterPredicateErrors([])).toContain('Add at least one condition.');
    });

    it('rejects two conditions sharing a name, which would make a reason ambiguous', () => {
      const errors = filterPredicateErrors([
        predicate({ id: 'a', label: 'Eligible', expression: 'a > 1' }),
        predicate({ id: 'b', label: 'Eligible', expression: 'b > 2' }),
      ]);
      expect(errors.join(' ')).toContain('"Eligible"');
    });

    it('accepts distinct conditions', () => {
      expect(filterPredicateErrors([predicate({ id: 'a', expression: 'a > 1' }), predicate({ id: 'b', expression: 'b > 2' })])).toEqual([]);
    });
  });

  describe('funnel query', () => {
    it('measures each condition alone and cumulatively in one pass', () => {
      const { selects, steps } = buildFunnelQuery([
        predicate({ id: 'a', expression: 'a > 1' }),
        predicate({ id: 'b', expression: 'b > 2' }),
      ]);

      expect(selects[0]).toBe('COUNT(*) AS total');
      expect(selects).toContain('COUNT(*) FILTER (WHERE COALESCE((a > 1), FALSE)) AS solo0');
      expect(selects).toContain('COUNT(*) FILTER (WHERE COALESCE((a > 1), FALSE) AND COALESCE((b > 2), FALSE)) AS cum1');
      expect(steps.map((step) => step.cumulativeKey)).toEqual(['cum0', 'cum1']);
    });

    it('leaves soft conditions out of the cumulative sequence but still measures them', () => {
      const { selects, steps } = buildFunnelQuery([
        predicate({ id: 'a', expression: 'a > 1', severity: 'soft' }),
        predicate({ id: 'b', expression: 'b > 2' }),
      ]);

      expect(steps[0].cumulativeKey).toBeNull();
      expect(steps[0].soloKey).toBe('solo0');
      // The hard condition's cumulative count must not be diluted by the soft one.
      expect(selects).toContain('COUNT(*) FILTER (WHERE COALESCE((b > 2), FALSE)) AS cum1');
    });
  });
});
