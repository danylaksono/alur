import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FEATURE_ID_PROPERTY } from '../types/visualAnalytics';
import { duckdbService } from './duckdb';
import {
  __visualAnalyticsCacheSizeForTests,
  __kpiQueryCacheSizeForTests,
  __datasetProfileCacheSizeForTests,
  clearLayerAnalyticsCache,
  queryLayerChart,
  queryLayerKpi,
  queryLayerDatasetProfile,
  queryLayerSummary,
  queryLayerRows,
  queryLayerScatter,
  queryLayerTemporalChart,
  queryLayerSelectionBounds,
  queryCohortComparison,
  queryTableChart,
  listChartTables,
  explainLayerSelection,
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
        { name: '__alur_mvt_id' },
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
          featureIdColumn: '__alur_mvt_id',
          fields: [{ name: 'Annual Generation [kWh]', type: 'DOUBLE' }],
          tileSource: {
            tableName: '__alur_mvt_rooftop_pv',
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

    expect(query.mock.calls[0][0]).toContain('FROM "__alur_mvt_rooftop_pv"');
    expect(query.mock.calls[2][0]).toContain('STRING_AGG(CAST("__alur_mvt_id" AS VARCHAR)');
    expect(query.mock.calls[2][0]).not.toContain('FROM "rooftop_pv"');
    expect(result.data[0].featureIds).toEqual(['7']);
  });

  it('queries DuckDB table rows from the rendered MVT table so selection ids match', async () => {
    const query = vi.spyOn(duckdbService, 'query')
      .mockResolvedValueOnce({ toArray: () => [{ row_count: 1 }] } as any)
      .mockResolvedValueOnce({ toArray: () => [{ __alur_mvt_id: 7, name: 'Selected row' }] } as any);
    const source = {
      kind: 'duckdb-table' as const,
      tableName: 'source_table',
      geometryColumn: 'geometry',
      crs: 'EPSG:4326',
      geometryKind: 'point' as const,
      featureIdColumn: '__alur_mvt_id',
      fields: [{ name: 'name', type: 'VARCHAR' }],
      tileSource: { tableName: '__alur_mvt_source_table', layerName: 'features', geometryKind: 'point' as const, propertyColumns: ['name'] },
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

    expect(query.mock.calls[0][0]).toContain('FROM "__alur_mvt_source_table"');
    expect(query.mock.calls[1][0]).toContain('FROM "__alur_mvt_source_table"');
    expect(query.mock.calls[1][0]).toContain('AS "name_length"');
    expect(query.mock.calls[1][0]).toContain('ORDER BY "name_length" DESC');
    expect(result.rows[0].__alur_mvt_id).toBe(7);
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

  it('scopes faceted chart queries to the facet value, including totals', async () => {
    vi.spyOn(duckdbService, 'registerJsonRows').mockResolvedValue(undefined);
    const query = vi.spyOn(duckdbService, 'query')
      .mockResolvedValueOnce({ toArray: () => [{ row_count: 2 }] } as any)
      .mockResolvedValueOnce({ toArray: () => [{ row_count: 2 }] } as any)
      .mockResolvedValueOnce({
        toArray: () => [
          { label: 'Camden', total_count: 2, total_value: 2, count_value: 2, aggregate_value: 2, feature_ids: 'a' },
        ],
      } as any);

    await queryLayerChart({
      layer: layer('areas'),
      filters: [],
      chart: {
        id: 'chart-7',
        title: 'Faceted',
        layerId: 'areas',
        type: 'bar',
        dimensionField: 'borough',
        aggregation: 'count',
        paletteId: 'categorical',
        maxCategories: 8,
        facetField: 'tenure',
      },
      facet: { field: 'tenure', value: "owner's" },
    });

    const totalSql = String(query.mock.calls[0][0]);
    const groupSql = String(query.mock.calls[2][0]);
    expect(totalSql).toContain(`CAST("tenure" AS VARCHAR) = 'owner''s'`);
    expect(groupSql).toContain(`AND CAST("tenure" AS VARCHAR) = 'owner''s'`);
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
      tableName: 'alur_manual_123',
      chart: {
        id: 'chart-6',
        title: 'Manual result',
        layerId: '',
        tableName: 'alur_manual_123',
        type: 'bar',
        dimensionField: 'category',
        aggregation: 'count',
        paletteId: 'categorical',
        maxCategories: 8,
      },
    });

    const groupSql = String(query.mock.calls[2][0]);
    expect(groupSql).toContain('FROM "alur_manual_123"');
    expect(groupSql).toContain('CAST(NULL AS VARCHAR)');
    expect(groupSql).not.toContain('FILTER (WHERE');
    expect(result.totalRows).toBe(4);
    expect(result.data[0]).toMatchObject({ label: 'A', value: 3, featureIds: [] });
  });

  it('lists chartable tables and hides internal ones', async () => {
    vi.spyOn(duckdbService, 'query').mockResolvedValueOnce({
      toArray: () => [
        { table_name: '__alur_mvt_pv' },
        { table_name: 'need_london' },
        { table_name: 'visual_layer_areas' },
        { table_name: 'alur_manual_99' },
      ],
    } as any);

    await expect(listChartTables()).resolves.toEqual(['need_london', 'alur_manual_99']);
  });

  it('calculates bounds for selected legacy features', async () => {
    const bounds = await queryLayerSelectionBounds(layer('areas'), ['b']);
    expect(bounds).toEqual([[1, 1], [1, 1]]);
  });

  it('ranks selection divergence across numeric and categorical fields', async () => {
    vi.spyOn(duckdbService, 'registerJsonRows').mockResolvedValue(undefined);
    const query = vi.spyOn(duckdbService, 'query')
      // probe: classify fields, count selection split
      .mockResolvedValueOnce({
        toArray: () => [{ sel_count: 2, rest_count: 3, p0_num: 5, p0_all: 5, p1_num: 0, p1_all: 5 }],
      } as any)
      // numeric stats
      .mockResolvedValueOnce({
        toArray: () => [{ n0_sel: 10, n0_rest: 4, n0_std: 3 }],
      } as any)
      // categorical shares
      .mockResolvedValueOnce({
        toArray: () => [
          { label: 'Camden', sel_n: 2, rest_n: 0 },
          { label: 'Brent', sel_n: 0, rest_n: 3 },
        ],
      } as any);

    const richLayer = {
      id: 'mix',
      geojson: {
        type: 'FeatureCollection' as const,
        features: [{
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [0, 0] },
          properties: { [FEATURE_ID_PROPERTY]: 'a', value: 1, borough: 'Camden' },
        }],
      },
    };

    const result = await explainLayerSelection({ layer: richLayer, selectedFeatureIds: ['a', 'b'] });

    expect(String(query.mock.calls[0][0])).toContain("IN ('a', 'b')");
    expect(result).not.toBeNull();
    expect(result!.selectedCount).toBe(2);
    expect(result!.restCount).toBe(3);
    expect(result!.fields[0]).toMatchObject({ kind: 'numeric', field: 'value', score: 2, selectedMean: 10, restMean: 4 });
    expect(result!.fields[1]).toMatchObject({ kind: 'categorical', field: 'borough', score: 1 });
  });

  it('builds stable chart filter keys for linked brushing', () => {
    expect(visualChartFilterKey({ kind: 'category', field: 'type', values: ['A'] })).toBe('type:category:A::include');
    expect(visualChartFilterKey({ kind: 'range', field: 'score', min: 10, max: 20 })).toBe('score:range:10:20::include');
  });

  it('queries ordered temporal series with explicit gaps and a top-N remainder', async () => {
    vi.spyOn(duckdbService, 'registerJsonRows').mockResolvedValue(undefined);
    const query = vi.spyOn(duckdbService, 'query')
      .mockResolvedValueOnce({ toArray: () => [{ row_count: 12 }] } as any)
      .mockResolvedValueOnce({ toArray: () => [{ row_count: 7 }] } as any)
      .mockResolvedValueOnce({ toArray: () => [{ min_date: '2026-01-10T00:00:00Z', max_date: '2026-03-04T00:00:00Z' }] } as any)
      .mockResolvedValueOnce({ toArray: () => [{ series: 'A' }, { series: 'B' }, { series: 'C' }] } as any)
      .mockResolvedValueOnce({
        toArray: () => [
          { bucket: '2026-01-01T00:00:00Z', series: 'A', total_count: 3, total_value: 3, count_value: 2, aggregate_value: 2 },
          { bucket: '2026-03-01T00:00:00Z', series: 'A', total_count: 2, total_value: 2, count_value: 1, aggregate_value: 1 },
          { bucket: '2026-02-01T00:00:00Z', series: 'Other', total_count: 1, total_value: 1, count_value: 1, aggregate_value: 1 },
        ],
      } as any);

    const result = await queryLayerTemporalChart({
      layer: layer('areas'),
      filters: [{ kind: 'category', field: 'borough', values: ['Camden'] }],
      chart: {
        id: 'time-1',
        title: 'Events over time',
        layerId: 'areas',
        type: 'line',
        dimensionField: 'created_at',
        seriesField: 'type',
        timeGrain: 'month',
        aggregation: 'count',
        paletteId: 'categorical',
        maxCategories: 2,
      },
    });

    const sql = String(query.mock.calls[4][0]);
    expect(sql).toContain("DATE_TRUNC('month'");
    expect(sql).toContain("ELSE 'Other'");
    expect(sql).toContain('FILTER (WHERE');
    expect(result).toMatchObject({ grain: 'month', totalRows: 12, filteredRows: 7, hasOtherSeries: true });
    expect(result.series.map((series) => series.label)).toEqual(['A', 'B', 'Other']);
    expect(result.series[0].points).toHaveLength(3);
    expect(result.series[0].points[1].value).toBeNull();
    expect(result.series[2].points[1].value).toBe(1);
  });

  it('caches KPI summaries and avoids misleading zero-baseline deltas', async () => {
    vi.spyOn(duckdbService, 'registerJsonRows').mockResolvedValue(undefined);
    const query = vi.spyOn(duckdbService, 'query').mockResolvedValueOnce({
      toArray: () => [{ active_value: 20, total_value: 40, comparison_value: 40, active_rows: 2, total_rows: 4 }],
    } as any);
    const args = {
      layer: layer('areas'),
      filters: [{ kind: 'range' as const, field: 'value', min: 1 }],
      spec: { id: 'kpi-1', datasetId: 'areas', title: 'Mean value', field: 'value', aggregation: 'avg' as const, comparison: 'total' as const },
    };
    const first = await queryLayerKpi(args);
    const second = await queryLayerKpi(args);
    expect(query).toHaveBeenCalledOnce();
    expect(__kpiQueryCacheSizeForTests()).toBe(1);
    expect(first).toMatchObject({ value: 20, comparisonValue: 40, delta: -0.5, activeRows: 2, totalRows: 4 });
    expect(second).toEqual(first);

    clearLayerAnalyticsCache();
    query.mockResolvedValueOnce({ toArray: () => [{ active_value: 5, total_value: 0, comparison_value: 0, active_rows: 1, total_rows: 1 }] } as any);
    const zeroBaseline = await queryLayerKpi({ ...args, spec: { ...args.spec, id: 'kpi-2' } });
    expect(zeroBaseline.delta).toBeNull();
    expect(zeroBaseline.comparisonNote).toContain('zero');

    clearLayerAnalyticsCache();
    query.mockResolvedValueOnce({ toArray: () => [{ active_value: 12, total_value: 50, comparison_value: 10, active_rows: 3, total_rows: 10 }] } as any);
    const previous = await queryLayerKpi({
      ...args,
      filters: [{ kind: 'temporal', field: 'created_at', start: '2026-02-01T00:00:00.000Z', end: '2026-02-28T23:59:59.999Z' }],
      spec: { ...args.spec, id: 'kpi-3', comparison: 'previous-period' },
    });
    expect(String(query.mock.calls.at(-1)?.[0])).toContain('2026-01-04T00:00:00.000Z');
    expect(previous).toMatchObject({ comparisonValue: 10, delta: 0.2, comparisonAvailable: true });
  });

  it('compares cohorts with explicit overlap, missingness, effect size, and deterministic shares', async () => {
    const query = vi.spyOn(duckdbService, 'query')
      .mockResolvedValueOnce({ toArray: () => [{ total_rows: 100, a_rows: 40, b_rows: 50, overlap_rows: 10 }] } as any)
      .mockResolvedValueOnce({ toArray: () => [{ a_count: 36, b_count: 45, a_mean: 10, b_mean: 14, a_sd: 2, b_sd: 4, range_min: 0, range_max: 20 }] } as any)
      .mockResolvedValueOnce({ toArray: () => [{ a_bin_0: 2, b_bin_0: 1, a_bin_1: 3, b_bin_1: 2 }] } as any)
      .mockResolvedValueOnce({ toArray: () => [{ label: 'North', a_count: 20, b_count: 10 }, { label: 'South', a_count: 20, b_count: 40 }] } as any)
      .mockResolvedValueOnce({ toArray: () => [{ period: '2026-01-01 00:00:00', a_count: 8, b_count: 12 }] } as any);
    const mapLayer = {
      id: 'areas', name: 'Areas', visible: true, opacity: 0.8, createdAt: 1, featureCount: 100, styleVersion: 1,
      source: {
        kind: 'duckdb-table' as const, tableName: 'areas', geometryColumn: 'geometry', crs: 'EPSG:4326', geometryKind: 'point' as const, featureIdColumn: 'fid', bounds: [[0, 0], [1, 1]] as [[number, number], [number, number]],
        fields: [{ name: 'score', type: 'DOUBLE' }, { name: 'region', type: 'VARCHAR' }, { name: 'observed_at', type: 'TIMESTAMP' }],
        tileSource: { tableName: '__alur_mvt_areas', layerName: 'features', geometryKind: 'point' as const, propertyColumns: ['score', 'region', 'observed_at'] }, renderVersion: 1,
      },
    };
    const result = await queryCohortComparison({
      layer: mapLayer,
      cohortA: { id: 'a', datasetId: 'areas', name: 'A', colour: '#0284c7', createdAt: 1, definition: { kind: 'filters', filters: [{ kind: 'category', field: 'region', values: ['North'] }] } },
      cohortB: { id: 'b', datasetId: 'areas', name: 'B', colour: '#f97316', createdAt: 2, definition: { kind: 'filters', filters: [{ kind: 'range', field: 'score', min: 5 }] } },
    });
    expect(result).toMatchObject({ totalRows: 100, aRows: 40, bRows: 50, overlapRows: 10, aOnlyRows: 30, bOnlyRows: 40 });
    expect(result.numeric[0]).toMatchObject({ aMissing: 4, bMissing: 5, aMean: 10, bMean: 14 });
    expect(result.numeric[0].effectSize).toBeCloseTo(-1.2649, 3);
    expect(result.categorical[0].values[0]).toMatchObject({ label: 'North', aShare: 0.5, bShare: 0.2, shareDifference: 0.3 });
    expect(result.temporal?.points[0]).toMatchObject({ aCount: 8, bCount: 12 });
    expect(String(query.mock.calls[0][0])).toContain('overlap_rows');
  });

  it('links non-spatial table chart filters and stable row identities', async () => {
    const query = vi.spyOn(duckdbService, 'query')
      .mockResolvedValueOnce({ toArray: () => [{ row_count: 4 }] } as any)
      .mockResolvedValueOnce({ toArray: () => [{ row_count: 2 }] } as any)
      .mockResolvedValueOnce({ toArray: () => [{ label: 'North', total_count: 2, total_value: 2, count_value: 1, aggregate_value: 1, feature_ids: 'row-1' }] } as any);
    const result = await queryTableChart({
      tableName: 'sales',
      rowIdColumn: 'sale_id',
      filters: [{ kind: 'range', field: 'amount', min: 10 }],
      chart: { id: 'sales-chart', title: 'Sales', layerId: '', tableName: 'sales', type: 'bar', dimensionField: 'region', aggregation: 'count', paletteId: 'categorical', maxCategories: 8 },
    });
    expect(result).toMatchObject({ totalRows: 4, filteredRows: 2 });
    expect(result.data[0]).toMatchObject({ label: 'North', value: 1, totalValue: 2, featureIds: ['row-1'] });
    expect(String(query.mock.calls[1][0])).toContain('"amount"');
    expect(String(query.mock.calls[2][0])).toContain('CAST("sale_id" AS VARCHAR)');
  });

  it('builds and caches progressive field profiles with cautious quality signals', async () => {
    vi.spyOn(duckdbService, 'registerJsonRows').mockResolvedValue(undefined);
    const query = vi.spyOn(duckdbService, 'query').mockResolvedValueOnce({
      toArray: () => [{
        profile_row_count: 10,
        p0_nulls: 0, p0_distinct: 60,
        p1_nulls: 0, p1_distinct: 8,
        p2_nulls: 3, p2_distinct: 6,
        p2_min: 1, p2_max: 9, p2_mean: 4.5, p2_quantiles: [1, 2, 4, 7, 9],
      }],
    } as any);
    const richLayer = {
      id: 'profiled', name: 'Profiled', visible: true, opacity: 1, createdAt: 1, featureCount: 10, styleVersion: 1,
      source: { kind: 'legacy-geojson' as const, geometryKind: 'point' as const, fields: [
        { name: 'id', type: 'VARCHAR' }, { name: 'score', type: 'DOUBLE' }, { name: 'category', type: 'VARCHAR' },
      ] },
      geojson: layer('profiled').geojson,
    };
    const profile = await queryLayerDatasetProfile(richLayer);
    const cached = await queryLayerDatasetProfile(richLayer);
    expect(query).toHaveBeenCalledOnce();
    expect(cached).toEqual(profile);
    expect(__datasetProfileCacheSizeForTests()).toBe(1);
    expect(profile.fields.find((field) => field.name === 'score')).toMatchObject({ name: 'score', nullCount: 3, nullPercent: 0.3, min: 1, max: 9, mean: 4.5 });
    expect(profile.issues.map((issue) => issue.id)).toEqual(expect.arrayContaining(['duplicate-id', 'missing-score', 'cardinality-category']));
  });

  it('summarises configured fields across selected, active, and total scopes', async () => {
    vi.spyOn(duckdbService, 'registerJsonRows').mockResolvedValue(undefined);
    const query = vi.spyOn(duckdbService, 'query')
      .mockResolvedValueOnce({ toArray: () => [{ total_rows: 10, active_rows: 6, selected_rows: 2 }] } as any)
      .mockResolvedValueOnce({ toArray: () => [{ score__numeric_count: 9, score__non_null_count: 9, type__numeric_count: 0, type__non_null_count: 10 }] } as any)
      .mockResolvedValueOnce({ toArray: () => [{ selected_count: 2, selected_min: 4, selected_max: 8, selected_mean: 6, selected_sum: 12, active_count: 6, active_min: 1, active_max: 9, active_mean: 5, active_sum: 30, total_count: 9, total_min: 0, total_max: 10, total_mean: 4, total_sum: 36 }] } as any)
      .mockResolvedValueOnce({ toArray: () => [{ label: 'A', selected_count: 2, active_count: 4, total_count: 7 }] } as any);
    const richLayer = {
      id: 'summary',
      geojson: {
        type: 'FeatureCollection' as const,
        features: [{ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [0, 0] }, properties: { [FEATURE_ID_PROPERTY]: 'a', score: 4, type: 'A' } }],
      },
    };
    const summary = await queryLayerSummary({
      layer: richLayer,
      filters: [{ kind: 'category', field: 'type', values: ['A'] }],
      selectedFeatureIds: ['a', 'b'],
      summaryFields: ['score', 'type'],
    });
    expect(String(query.mock.calls[0][0])).toContain("IN ('a', 'b')");
    expect(summary).toMatchObject({ totalRows: 10, filteredRows: 6, selectedRows: 2 });
    expect(summary.numericMetrics[0]).toMatchObject({ field: 'score', selected: { mean: 6 }, active: { mean: 5 }, total: { mean: 4 } });
    expect(summary.categoryBreakdowns[0].values[0]).toEqual({ label: 'A', selectedCount: 2, activeCount: 4, totalCount: 7 });
  });
});
