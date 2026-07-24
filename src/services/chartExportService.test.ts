import { describe, expect, it } from 'vitest';
import type { VisualChartSpec } from '../types/visualAnalytics';
import { buildChartCsv, chartExportMetadata } from './chartExportService';

const chart: VisualChartSpec = { id: 'c', title: 'Need by area', layerId: 'areas', type: 'bar', dimensionField: 'area', aggregation: 'count', paletteId: 'categorical', maxCategories: 8 };

describe('chart export service', () => {
  it('exports exactly the plotted aggregate values with provenance metadata', () => {
    const csv = buildChartCsv(chart, [{ kind: 'category', field: 'status', values: ['open'] }], {
      kind: 'aggregate',
      result: { chartId: 'c', totalRows: 10, filteredRows: 4, data: [{ key: 'A', label: 'A', value: 3, count: 3, totalValue: 7, totalCount: 7, color: '#000', filter: { kind: 'category', field: 'area', values: ['A'] }, featureIds: [] }] },
    }, new Date('2026-07-24T10:00:00Z'));
    expect(csv).toContain('# title: Need by area');
    expect(csv).toContain('# filters: status: open');
    expect(csv).toContain('A,3,3,7,7');
  });

  it('records generated time and aggregation without mutating chart data', () => {
    expect(chartExportMetadata(chart, [], new Date('2026-01-01T00:00:00Z'))).toEqual({ title: 'Need by area', aggregation: 'count', filters: [], generatedAt: '2026-01-01T00:00:00.000Z' });
  });
});
