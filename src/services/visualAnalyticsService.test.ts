import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FEATURE_ID_PROPERTY } from '../types/visualAnalytics';
import { duckdbService } from './duckdb';
import {
  __visualAnalyticsCacheSizeForTests,
  clearLayerAnalyticsCache,
  queryLayerChart,
  queryLayerRows,
  queryLayerSelectionBounds,
  registerLayerForAnalytics,
  visualChartFilterKey,
} from './visualAnalyticsService';

const layer = (id: string): { id: string; geojson: GeoJSON.FeatureCollection } => ({
  id,
  geojson: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: { [FEATURE_ID_PROPERTY]: 'a', value: 1 },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [1, 1] },
        properties: { [FEATURE_ID_PROPERTY]: 'b', value: 2 },
      },
    ],
  },
});

describe('visual analytics cache helpers', () => {
  beforeEach(() => {
    clearLayerAnalyticsCache();
    vi.restoreAllMocks();
  });

  it('reuses registered layer tables while the layer signature is unchanged', async () => {
    const register = vi.spyOn(duckdbService, 'registerJsonRows').mockResolvedValue(undefined);

    await registerLayerForAnalytics(layer('areas'));
    await registerLayerForAnalytics(layer('areas'));

    expect(register).toHaveBeenCalledTimes(1);
    expect(__visualAnalyticsCacheSizeForTests()).toBe(1);
  });

  it('clears the in-memory layer registration cache', async () => {
    vi.spyOn(duckdbService, 'registerJsonRows').mockResolvedValue(undefined);
    await registerLayerForAnalytics(layer('areas'));

    expect(__visualAnalyticsCacheSizeForTests()).toBe(1);
    clearLayerAnalyticsCache('areas');
    expect(__visualAnalyticsCacheSizeForTests()).toBe(0);
    await registerLayerForAnalytics(layer('areas'));
    clearLayerAnalyticsCache();
    expect(__visualAnalyticsCacheSizeForTests()).toBe(0);
  });

  it('queries categorical chart data with active filters and feature ids', async () => {
    const register = vi.spyOn(duckdbService, 'registerJsonRows').mockResolvedValue(undefined);
    const query = vi.spyOn(duckdbService, 'query')
      .mockResolvedValueOnce({ toArray: () => [{ row_count: 3 }] } as any)
      .mockResolvedValueOnce({ toArray: () => [{ row_count: 2 }] } as any)
      .mockResolvedValueOnce({
        toArray: () => [
          { label: 'Camden', count_value: 2, aggregate_value: 2, feature_ids: 'a\u001fb' },
        ],
      } as any);

    const result = await queryLayerChart({
      layer: layer('areas'),
      filters: [{ kind: 'range', field: 'value', min: 1, max: 2 }],
      chart: {
        id: 'chart-1',
        title: 'Type counts',
        layerId: 'areas',
        type: 'bar',
        dimensionField: 'borough',
        aggregation: 'count',
        paletteId: 'categorical',
        maxCategories: 8,
      },
    });

    expect(register).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[1][0]).toContain('WHERE');
    expect(query.mock.calls[2][0]).toContain('GROUP BY label');
    expect(result.totalRows).toBe(3);
    expect(result.filteredRows).toBe(2);
    expect(result.data[0]).toMatchObject({
      label: 'Camden',
      value: 2,
      count: 2,
      featureIds: ['a', 'b'],
      filter: { kind: 'category', field: 'borough', values: ['Camden'] },
    });
  });

  it('uses the MVT backing table for DuckDB chart feature ids', async () => {
    vi.spyOn(duckdbService, 'getTableSchema').mockResolvedValue({
      toArray: () => [
        { name: '__ymn_mvt_id' },
        { name: 'Annual Generation [kWh]' },
      ],
    } as any);
    const query = vi.spyOn(duckdbService, 'query')
      .mockResolvedValueOnce({ toArray: () => [{ row_count: 3 }] } as any)
      .mockResolvedValueOnce({ toArray: () => [{ row_count: 3 }] } as any)
      .mockResolvedValueOnce({
        toArray: () => [
          { label: '1200', count_value: 1, aggregate_value: 1, feature_ids: '7' },
        ],
      } as any);

    const result = await queryLayerChart({
      layer: {
        id: 'pv',
        source: {
          kind: 'duckdb-table',
          tableName: 'rooftop_pv',
          geometryColumn: 'geometry',
          crs: 'EPSG:27700',
          geometryKind: 'polygon',
          featureIdColumn: '__ymn_mvt_id',
          fields: [{ name: 'Annual Generation [kWh]', type: 'DOUBLE' }],
          tileSource: {
            tableName: '__ymn_mvt_rooftop_pv',
            layerName: 'features',
            geometryKind: 'polygon',
            propertyColumns: ['Annual Generation [kWh]'],
          },
          renderVersion: 1,
        },
      },
      filters: [],
      chart: {
        id: 'chart-2',
        title: 'Generation',
        layerId: 'pv',
        type: 'bar',
        dimensionField: 'Annual Generation [kWh]',
        aggregation: 'count',
        paletteId: 'categorical',
        maxCategories: 8,
      },
    });

    expect(query.mock.calls[0][0]).toContain('FROM "__ymn_mvt_rooftop_pv"');
    expect(query.mock.calls[2][0]).toContain('STRING_AGG(CAST("__ymn_mvt_id" AS VARCHAR)');
    expect(query.mock.calls[2][0]).not.toContain('FROM "rooftop_pv"');
    expect(result.data[0].featureIds).toEqual(['7']);
  });

  it('queries DuckDB table rows from the rendered MVT table so selection ids match', async () => {
    const query = vi.spyOn(duckdbService, 'query')
      .mockResolvedValueOnce({ toArray: () => [{ row_count: 1 }] } as any)
      .mockResolvedValueOnce({ toArray: () => [{ __ymn_mvt_id: 7, name: 'Selected row' }] } as any);
    const source = {
      kind: 'duckdb-table' as const,
      tableName: 'source_table',
      geometryColumn: 'geometry',
      crs: 'EPSG:4326',
      geometryKind: 'point' as const,
      featureIdColumn: '__ymn_mvt_id',
      fields: [{ name: 'name', type: 'VARCHAR' }],
      tileSource: { tableName: '__ymn_mvt_source_table', layerName: 'features', geometryKind: 'point' as const, propertyColumns: ['name'] },
      renderVersion: 1,
    };

    const result = await queryLayerRows({
      layer: { id: 'points', source },
      filters: [],
      search: '',
      sortBy: 'name_length',
      sortDirection: 'desc',
      pageIndex: 0,
      pageSize: 50,
      computedFields: [{ id: 'length', name: 'name_length', expression: "concat(name, 'x')" }],
    });

    expect(query.mock.calls[0][0]).toContain('FROM "__ymn_mvt_source_table"');
    expect(query.mock.calls[1][0]).toContain('FROM "__ymn_mvt_source_table"');
    expect(query.mock.calls[1][0]).toContain('AS "name_length"');
    expect(query.mock.calls[1][0]).toContain('ORDER BY "name_length" DESC');
    expect(result.rows[0].__ymn_mvt_id).toBe(7);
  });

  it('calculates bounds for selected legacy features', async () => {
    const bounds = await queryLayerSelectionBounds(layer('areas'), ['b']);
    expect(bounds).toEqual([[1, 1], [1, 1]]);
  });

  it('builds stable chart filter keys for linked brushing', () => {
    expect(visualChartFilterKey({ kind: 'category', field: 'type', values: ['A'] })).toBe('type:category:A:');
    expect(visualChartFilterKey({ kind: 'range', field: 'score', min: 10, max: 20 })).toBe('score:range:10:20:');
  });
});
