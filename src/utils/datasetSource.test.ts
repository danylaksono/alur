import { describe, expect, it } from 'vitest';
import { chartDatasetId, chartDatasetSource, migrateVisualAnalyticsSources } from './datasetSource';

describe('dataset source migration', () => {
  it('migrates legacy layer and table charts into the discriminated source union', () => {
    const layerChart = { id: 'a', title: 'Layer', layerId: 'places', type: 'bar' as const, dimensionField: 'type', aggregation: 'count' as const, paletteId: 'categorical', maxCategories: 8 };
    const tableChart = { ...layerChart, id: 'b', layerId: '', tableName: 'sales' };
    expect(chartDatasetSource(layerChart)).toEqual({ kind: 'layer', layerId: 'places' });
    expect(chartDatasetSource(tableChart)).toEqual({ kind: 'table', datasetId: 'table:sales', tableName: 'sales', rowIdColumn: '__alur_row_id' });
    expect(chartDatasetId(tableChart)).toBe('table:sales');
  });

  it('normalises chart and KPI sources without changing dataset interaction state', () => {
    const migrated = migrateVisualAnalyticsSources({
      datasets: {}, cohorts: [], bookmarks: [],
      charts: [{ id: 'chart', title: 'Chart', layerId: 'places', type: 'bar', dimensionField: 'type', aggregation: 'count', paletteId: 'categorical', maxCategories: 8 }],
      kpis: [{ id: 'kpi', datasetId: 'places', title: 'Rows', aggregation: 'count', comparison: 'total' }],
    });
    expect(migrated.charts[0].source).toEqual({ kind: 'layer', layerId: 'places' });
    expect(migrated.kpis[0].source).toEqual({ kind: 'layer', layerId: 'places' });
  });
});

