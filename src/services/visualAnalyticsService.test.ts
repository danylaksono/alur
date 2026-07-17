import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FEATURE_ID_PROPERTY } from '../types/visualAnalytics';
import { duckdbService } from './duckdb';
import {
  __visualAnalyticsCacheSizeForTests,
  clearLayerAnalyticsCache,
  queryLayerChart,
  queryLayerRows,
  queryLayerScatter,
  queryLayerSelectionBounds,
  queryTableChart,
  listChartTables,
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

  it('excludes own-dimension filters from the chart series and reports totals (crossfilter)', async () => {
    vi.spyOn(duckdbService, 'registerJsonRows').mockResolvedValue(undefined);
    const query = vi.spyOn(duckdbService, 'query')
      .mockResolvedValueOnce({ toArray: () => [{ row_count: 3 }] } as any)
      .mockResolvedValueOnce({ toArray: () => [{ row_count: 1 }] } as any)
      .mockResolvedValueOnce({
        toArray: () => [
          { label: 'Camden', total_count: 2, total_value: 2, count_value: 1, aggregate_value: 1, feature_ids: 'a' },
        ],
      } as any);

    const result = await queryLayerChart({
      layer: layer('areas'),
      filters: [
        { kind: 'category', field: 'borough', values: ['Camden'] },
        { kind: 'range', field: 'value', min: 1, max: 2 },
      ],
      chart: {
        id: 'chart-3',
        title: 'Type counts',
        layerId: 'areas',
        type: 'bar',
        dimensionField: 'borough',
        aggregation: 'count',
        paletteId: 'categorical',
        maxCategories: 8,
      },
    });

    const groupSql = String(query.mock.calls[2][0]);
    expect(groupSql).toContain('FILTER (WHERE');
    expect(groupSql).toContain('"value"');
    expect(groupSql).not.toContain("'Camden'");
    expect(groupSql).toContain('ORDER BY total_value DESC');
    expect(result.data[0]).toMatchObject({
      label: 'Camden',
      value: 1,
      count: 1,
      totalValue: 2,
      totalCount: 2,
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

  it('queries scatter points with a context flag that ignores the chart axes', async () => {
    vi.spyOn(duckdbService, 'registerJsonRows').mockResolvedValue(undefined);
    const query = vi.spyOn(duckdbService, 'query')
      .mockResolvedValueOnce({ toArray: () => [{ row_count: 3 }] } as any)
      .mockResolvedValueOnce({ toArray: () => [{ row_count: 2 }] } as any)
      .mockResolvedValueOnce({
        toArray: () => [{ x_min: 0, x_max: 10, y_min: 1, y_max: 5, point_count: 3 }],
      } as any)
      .mockResolvedValueOnce({
        toArray: () => [
          { x: 1, y: 2, in_ctx: 1 },
          { x: 4, y: 3, in_ctx: 0 },
        ],
      } as any);

    const result = await queryLayerScatter({
      layer: layer('areas'),
      filters: [
        { kind: 'range', field: 'value', min: 1, max: 2 },
        { kind: 'category', field: 'borough', values: ['Camden'] },
      ],
      chart: {
        id: 'chart-4',
        title: 'value vs score',
        layerId: 'areas',
        type: 'scatter',
        dimensionField: 'value',
        measureField: 'score',
        aggregation: 'count',
        paletteId: 'categorical',
        maxCategories: 8,
      },
    });

    const pointsSql = String(query.mock.calls[3][0]);
    expect(pointsSql).toContain('CASE WHEN');
    expect(pointsSql).toContain("'Camden'");
    // The chart's own axis filter must not affect point classification.
    expect(pointsSql).not.toContain('"value" AS DOUBLE) >=');
    expect(pointsSql).not.toContain('USING SAMPLE');
    expect(result).toMatchObject({
      totalRows: 3,
      filteredRows: 2,
      sampled: false,
      xMin: 0,
      xMax: 10,
      yMin: 1,
      yMax: 5,
    });
    expect(result.points).toEqual([
      { x: 1, y: 2, inContext: 1 },
      { x: 4, y: 3, inContext: 0 },
    ]);
  });

  it('samples large scatter layers deterministically', async () => {
    vi.spyOn(duckdbService, 'registerJsonRows').mockResolvedValue(undefined);
    const query = vi.spyOn(duckdbService, 'query')
      .mockResolvedValueOnce({ toArray: () => [{ row_count: 50000 }] } as any)
      .mockResolvedValueOnce({ toArray: () => [{ row_count: 50000 }] } as any)
      .mockResolvedValueOnce({
        toArray: () => [{ x_min: 0, x_max: 1, y_min: 0, y_max: 1, point_count: 50000 }],
      } as any)
      .mockResolvedValueOnce({ toArray: () => [] } as any);

    const result = await queryLayerScatter({
      layer: layer('areas'),
      filters: [],
      chart: {
        id: 'chart-5',
        title: 'big scatter',
        layerId: 'areas',
        type: 'scatter',
        dimensionField: 'value',
        measureField: 'score',
        aggregation: 'count',
        paletteId: 'categorical',
        maxCategories: 8,
      },
    });

    expect(String(query.mock.calls[3][0])).toContain('USING SAMPLE reservoir(12000 ROWS) REPEATABLE');
    expect(result.sampled).toBe(true);
  });

  it('charts an arbitrary DuckDB table without filters or feature ids', async () => {
    const query = vi.spyOn(duckdbService, 'query')
      .mockResolvedValueOnce({ toArray: () => [{ row_count: 4 }] } as any)
      .mockResolvedValueOnce({ toArray: () => [{ row_count: 4 }] } as any)
      .mockResolvedValueOnce({
        toArray: () => [
          { label: 'A', total_count: 3, total_value: 3, count_value: 3, aggregate_value: 3, feature_ids: null },
        ],
      } as any);

    const result = await queryTableChart({
      tableName: 'ymn_manual_123',
      chart: {
        id: 'chart-6',
        title: 'Manual result',
        layerId: '',
        tableName: 'ymn_manual_123',
        type: 'bar',
        dimensionField: 'category',
        aggregation: 'count',
        paletteId: 'categorical',
        maxCategories: 8,
      },
    });

    const groupSql = String(query.mock.calls[2][0]);
    expect(groupSql).toContain('FROM "ymn_manual_123"');
    expect(groupSql).toContain('CAST(NULL AS VARCHAR)');
    expect(groupSql).not.toContain('FILTER (WHERE');
    expect(result.totalRows).toBe(4);
    expect(result.data[0]).toMatchObject({ label: 'A', value: 3, featureIds: [] });
  });

  it('lists chartable tables and hides internal ones', async () => {
    vi.spyOn(duckdbService, 'query').mockResolvedValueOnce({
      toArray: () => [
        { table_name: '__ymn_mvt_pv' },
        { table_name: 'need_london' },
        { table_name: 'visual_layer_areas' },
        { table_name: 'ymn_manual_99' },
      ],
    } as any);

    await expect(listChartTables()).resolves.toEqual(['need_london', 'ymn_manual_99']);
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
