import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatasetDescriptor } from '../types/datasets';
import type { ComparisonSpec } from '../types/visualAnalytics';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('./duckdb', () => ({ duckdbService: { query } }));

import { clearComparisonCache, comparisonCompatibility, operandWhereClause, queryComparison } from './comparisonService';

const dataset = (id: string, spatial = false): DatasetDescriptor => ({ id, name: id, sourceVersion: 1, source: { kind: 'table', datasetId: id, tableName: id, rowIdColumn: 'id' }, fields: [{ name: 'id', type: 'VARCHAR' }, { name: 'value', type: 'DOUBLE' }, { name: 'date', type: 'DATE' }, ...(spatial ? [{ name: 'geometry', type: 'GEOMETRY' }] : [])], rowIdColumn: 'id', rowIdQuality: 'validated-unique', sourceUpdatedAt: 1, spatial, relationName: id, geometryColumn: spatial ? 'geometry' : undefined, geometryCrs: spatial ? 'EPSG:4326' : undefined, geometryKind: spatial ? 'point' : undefined });
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

  it('returns a bounded entity alignment preview with explicit B minus A deltas and overlap', async () => {
    query.mockImplementation(async (sql: string) => ({ toArray: () => {
      if (sql.includes('aligned_total')) return [{ alignment_key: 'entity-1', aligned_total: 2, present0: true, present1: true, o0m0: 5, o1m0: 8 }];
      if (sql.includes('overlap_0_1')) return [{ overlap_0_1: 1 }];
      if (sql.includes('WITH values')) return [];
      return [{ denominator: 2, m0: 6.5, missing0: 0 }];
    } }));
    const comparison = spec(2);
    comparison.requestedViews = ['records'];
    comparison.alignment = { mode: 'entity-keyed', keyFields: { o0: 'id', o1: 'id' } };
    comparison.measures[0] = { id: 'value', label: 'Value', aggregation: 'avg', fields: { o0: 'value', o1: 'value' } };
    const result = await queryComparison(comparison, { d0: dataset('d0'), d1: dataset('d1') });
    expect(result.alignedRecordCount).toBe(2);
    expect(result.alignedRecords?.[0]).toMatchObject({ key: 'entity-1', deltas: { value: 3 }, presentOperandIds: ['o0', 'o1'] });
    expect(result.overlap?.[0].count).toBe(1);
  });

  it('captures bounded spatial features with the comparison key and mapped value', async () => {
    query.mockImplementation(async (sql: string) => ({ toArray: () => {
      if (sql.includes('ST_AsGeoJSON')) return [{ __alur_key: 'place-1', __alur_value: 12, geojson: '{"type":"Point","coordinates":[-0.1,51.5]}' }];
      return [{ denominator: 1, m0: 1, missing0: 0 }];
    } }));
    const comparison = spec(2);
    comparison.requestedViews = ['map'];
    const result = await queryComparison(comparison, { d0: dataset('d0', true), d1: dataset('d1', true) });
    expect(result.spatialSamples).toHaveLength(2);
    expect(result.spatialSamples?.[0].features.features[0]).toMatchObject({ id: 'place-1', properties: { __alur_key: 'place-1', __alur_value: 12 } });
  });

  it('computes the difference map from the full aligned spatial query rather than the record preview', async () => {
    query.mockImplementation(async (sql: string) => ({ toArray: () => {
      if (sql.includes('value_b - a.value_a')) return [{ __alur_key: 'place-1', __alur_value: 4, feature_total: 900, geojson: '{"type":"Point","coordinates":[-0.1,51.5]}' }];
      if (sql.includes('aligned_total')) return [{ alignment_key: 'place-1', aligned_total: 900, present0: true, present1: true, o0m0: 8, o1m0: 12 }];
      if (sql.includes('overlap_0_1')) return [{ overlap_0_1: 900 }];
      if (sql.includes('ST_AsGeoJSON')) return [{ __alur_key: 'place-1', __alur_value: 8, geojson: '{"type":"Point","coordinates":[-0.1,51.5]}' }];
      if (sql.includes('WITH values')) return [];
      return [{ denominator: 900, m0: 10, missing0: 0 }];
    } }));
    const comparison = spec(2);
    comparison.requestedViews = ['map'];
    comparison.alignment = { mode: 'entity-keyed', keyFields: { o0: 'id', o1: 'id' } };
    comparison.measures[0] = { id: 'value', label: 'Value', aggregation: 'avg', fields: { o0: 'value', o1: 'value' } };
    const result = await queryComparison(comparison, { d0: dataset('d0', true), d1: dataset('d1', true) });
    expect(result.alignedRecords).toHaveLength(1);
    expect(result.differenceSpatialSample).toMatchObject({ featureCount: 900, sampled: false });
    expect(result.differenceSpatialSample?.features.features[0].properties?.__alur_value).toBe(4);
  });
});
