import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatasetDescriptor } from '../types/datasets';
import type { ComparisonSpec } from '../types/visualAnalytics';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('./duckdb', () => ({ duckdbService: { query } }));

import { clearComparisonCache, comparisonCompatibility, operandWhereClause, queryComparison } from './comparisonService';

const dataset = (id: string, spatial = false): DatasetDescriptor => ({ id, name: id, sourceVersion: 1, source: { kind: 'table', datasetId: id, tableName: id, rowIdColumn: 'id' }, fields: [{ name: 'id', type: 'VARCHAR' }, { name: 'value', type: 'DOUBLE' }, { name: 'date', type: 'DATE' }], rowIdColumn: 'id', rowIdQuality: 'validated-unique', sourceUpdatedAt: 1, spatial, relationName: id });
const spec = (operandCount = 2): ComparisonSpec => ({ id: `compare-${operandCount}`, name: 'Comparison', operands: Array.from({ length: operandCount }, (_, index) => ({ id: `o${index}`, label: `Operand ${index + 1}`, colour: '#2563eb', datasetId: `d${index}`, scope: { kind: 'whole-dataset' as const } })), alignment: { mode: 'aggregate-only' }, measures: [{ id: 'rows', label: 'Rows', fields: {}, aggregation: 'count' }], dimensions: [], requestedViews: ['overview'], sourceVersions: {}, createdAt: 1, updatedAt: 1 });

describe('generic comparison service', () => {
  beforeEach(() => { query.mockReset(); clearComparisonCache(); });

  it.each([2, 3, 4])('queries and retains explicit denominators for %i operands', async (count) => {
    query.mockImplementation(async () => ({ toArray: () => [{ denominator: count * 10, m0: count * 10, missing0: 0 }] }));
    const comparison = spec(count);
    const datasets = Object.fromEntries(comparison.operands.map((operand) => [operand.datasetId, dataset(operand.datasetId)]));
    const result = await queryComparison(comparison, datasets);
    expect(result.summaries[0].values).toHaveLength(count);
    expect(result.summaries[0].values.every((value) => value.denominator === count * 10)).toBe(true);
  });

  it('compiles immutable filter scopes for spatial and non-spatial data alike', () => {
    expect(operandWhereClause({ id: 'a', label: 'A', colour: '#000', datasetId: 'table', scope: { kind: 'filters', filters: [{ kind: 'range', field: 'value', min: 5, includeNull: false }] } })).toContain('CAST("value" AS DOUBLE) >= 5');
  });

  it('requires explicit compatible keys for record deltas and difference maps', () => {
    const comparison = spec(2);
    comparison.alignment = { mode: 'entity-keyed', keyFields: { o0: 'id' } };
    comparison.measures[0] = { id: 'value', label: 'Value', aggregation: 'avg', fields: { o0: 'value', o1: 'value' } };
    const datasets = { d0: dataset('d0', true), d1: dataset('d1', true) };
    expect(comparisonCompatibility(comparison, datasets)).toMatchObject({ differenceMapEligible: false });
    comparison.alignment.keyFields!.o1 = 'id';
    expect(comparisonCompatibility(comparison, datasets)).toMatchObject({ differenceMapEligible: true });
  });

  it('preserves temporal gaps instead of manufacturing missing periods', async () => {
    query.mockImplementation(async (sql: string) => ({ toArray: () => sql.includes('date_trunc') ? [{ period: '2025-01-01', value: 4 }, { period: '2025-03-01', value: 8 }] : [{ denominator: 12, m0: 12, missing0: 0 }] }));
    const comparison = spec(2);
    comparison.alignment = { mode: 'temporal', timeFields: { o0: 'date', o1: 'date' } };
    const result = await queryComparison(comparison, { d0: dataset('d0'), d1: dataset('d1') });
    expect(result.temporalSeries[0].points.map((point) => point.period)).toEqual(['2025-01-01', '2025-03-01']);
  });

  it('reports unavailable sources without running a misleading query', async () => {
    const result = await queryComparison(spec(2), { d0: dataset('d0') });
    expect(result.warnings.join(' ')).toContain('Missing source');
    expect(query).not.toHaveBeenCalled();
  });
});
