import { describe, expect, it } from 'vitest';
import {
  allocationColumns,
  allocationErrors,
  buildAllocationSelects,
  buildMeasureSelect,
  buildTopNQualify,
  measureAlias,
  summaryMeasureErrors,
  type SummaryMeasure,
} from './aggregationSql';

const measure = (patch: Partial<SummaryMeasure> = {}): SummaryMeasure => ({ id: 'm1', fn: 'sum', field: 'cost', ...patch });

describe('summary measures', () => {
  it('counts rows without needing a column', () => {
    expect(buildMeasureSelect(measure({ fn: 'count', field: undefined }))).toBe('COUNT(*) AS "row_count"');
  });

  it('casts arithmetic aggregates so numeric text columns still add up', () => {
    expect(buildMeasureSelect(measure({ fn: 'sum' }))).toBe('SUM(TRY_CAST("cost" AS DOUBLE)) AS "sum_cost"');
    expect(buildMeasureSelect(measure({ fn: 'avg' }))).toContain('AVG(TRY_CAST(');
    expect(buildMeasureSelect(measure({ fn: 'median' }))).toContain('MEDIAN(TRY_CAST(');
  });

  it('leaves min and max uncast, so they still work on dates and text', () => {
    expect(buildMeasureSelect(measure({ fn: 'min', field: 'opened_on' }))).toBe('MIN("opened_on") AS "min_opened_on"');
    expect(buildMeasureSelect(measure({ fn: 'max', field: 'ward' }))).toBe('MAX("ward") AS "max_ward"');
  });

  it('counts distinct values of the raw column', () => {
    expect(buildMeasureSelect(measure({ fn: 'count_distinct', field: 'ward' }))).toBe('COUNT(DISTINCT "ward") AS "count_distinct_ward"');
  });

  it('honours an explicit alias', () => {
    expect(measureAlias(measure({ alias: 'Total cost ' }))).toBe('Total cost');
    expect(buildMeasureSelect(measure({ alias: 'total' }))).toContain('AS "total"');
  });

  it('sanitises a derived alias that would not be a plain identifier', () => {
    expect(measureAlias(measure({ field: 'cost (£)' }))).toBe('sum_cost____');
  });

  it('returns null rather than broken SQL when a measure has no column yet', () => {
    expect(buildMeasureSelect(measure({ fn: 'sum', field: undefined }))).toBeNull();
  });

  describe('validation', () => {
    it('requires at least one measure', () => {
      expect(summaryMeasureErrors([])).toContain('Add at least one measure.');
    });

    it('reports a measure missing its column', () => {
      expect(summaryMeasureErrors([measure({ fn: 'avg', field: undefined })])).toEqual(['avg needs a column.']);
    });

    it('catches two measures competing for the same output name', () => {
      const errors = summaryMeasureErrors([measure({ id: 'a' }), measure({ id: 'b' })]);
      expect(errors.some((error) => error.includes('sum_cost'))).toBe(true);
    });

    it('passes a well-formed set', () => {
      expect(summaryMeasureErrors([measure({ fn: 'count', field: undefined }), measure()])).toEqual([]);
    });
  });
});

describe('running-total allocation', () => {
  const config = { orderBy: 'score', amountField: 'cost', limit: 1000 };

  it('accumulates in priority order, highest first by default', () => {
    const { selects } = buildAllocationSelects(config);
    expect(selects[0]).toContain('ORDER BY "score" DESC ROWS UNBOUNDED PRECEDING');
    expect(selects[0]).toContain('AS "cumulative_cost"');
  });

  it('accumulates ascending when asked, for a lower-is-better ordering', () => {
    expect(buildAllocationSelects({ ...config, direction: 'asc' }).selects[0]).toContain('ORDER BY "score" ASC');
  });

  it('flags each row as within or over the limit', () => {
    const { selects } = buildAllocationSelects(config);
    expect(selects[1]).toContain("THEN 'within' ELSE 'over'");
    expect(selects[1]).toContain('<= 1000');
  });

  it('treats a missing amount as zero rather than voiding the running total', () => {
    expect(buildAllocationSelects(config).selects[0]).toContain('COALESCE(TRY_CAST("cost" AS DOUBLE), 0)');
  });

  it('gives each group its own budget when partitioned', () => {
    expect(buildAllocationSelects({ ...config, partitionBy: 'ward' }).selects[0]).toContain('PARTITION BY "ward" ORDER BY');
  });

  it('emits no allocated column unless scaling', () => {
    expect(buildAllocationSelects(config).selects).toHaveLength(2);
    expect(buildAllocationSelects({ ...config, mode: 'flag' }).selects).toHaveLength(2);
  });

  it('gives the row straddling the limit a partial share when scaling', () => {
    const { selects, columns } = buildAllocationSelects({ ...config, mode: 'scale' });
    expect(selects).toHaveLength(3);
    expect(columns.allocated).toBe('allocated_cost');
    // Clamped between zero and the budget remaining before this row.
    expect(selects[2]).toContain('LEAST(');
    expect(selects[2]).toContain('GREATEST(0,');
  });

  it('names its output columns from the amount it consumes', () => {
    expect(allocationColumns(config)).toEqual({ cumulative: 'cumulative_cost', status: 'cost_status', allocated: 'allocated_cost' });
  });

  describe('validation', () => {
    it('accepts a complete config', () => {
      expect(allocationErrors(config)).toEqual([]);
    });

    it('reports every missing piece', () => {
      expect(allocationErrors({})).toHaveLength(3);
    });

    it('rejects a limit that cannot allocate anything', () => {
      expect(allocationErrors({ ...config, limit: 0 })).toEqual(['The limit must be greater than zero.']);
    });
  });
});

describe('top-N selection', () => {
  it('qualifies on rank so ties are kept together', () => {
    expect(buildTopNQualify('score', 50)).toBe('RANK() OVER (ORDER BY "score" DESC) <= 50');
  });

  it('supports a lowest-first ordering', () => {
    expect(buildTopNQualify('travel_time', 20, 'asc')).toContain('ASC) <= 20');
  });

  it('never qualifies on a fractional or empty count', () => {
    expect(buildTopNQualify('score', 12.7)).toContain('<= 12');
    expect(buildTopNQualify('score', 0)).toContain('<= 1');
  });
});
