import { describe, expect, it } from 'vitest';
import type { VisualChartSpec } from '../types/visualAnalytics';
import { buildChartCsv, chartExportMetadata, compactChartEvidence, EVIDENCE_SCATTER_POINTS, isChartEvidenceCapture } from './chartExportService';

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

describe('chart evidence capture', () => {
  it('recognises a capture and rejects values from older cards', () => {
    const data = { kind: 'aggregate' as const, result: { chartId: 'c', totalRows: 1, filteredRows: 1, data: [] } };
    expect(isChartEvidenceCapture({ chart, data, filters: [] })).toBe(true);
    expect(isChartEvidenceCapture({ A: 3 })).toBe(false);
    expect(isChartEvidenceCapture(undefined)).toBe(false);
  });

  it('thins a large scatter evenly and marks it sampled, leaving small ones alone', () => {
    const points = Array.from({ length: EVIDENCE_SCATTER_POINTS * 3 }, (_, index) => ({ x: index, y: index, inContext: 1 as const }));
    const scatter = { kind: 'scatter' as const, result: { chartId: 'c', totalRows: points.length, filteredRows: points.length, sampled: false, points, xMin: 0, xMax: 1, yMin: 0, yMax: 1 } };
    const compact = compactChartEvidence(scatter);
    expect(compact.kind === 'scatter' && compact.result.points).toHaveLength(EVIDENCE_SCATTER_POINTS);
    expect(compact.kind === 'scatter' && compact.result.sampled).toBe(true);
    const small = { ...scatter, result: { ...scatter.result, points: points.slice(0, 10) } };
    expect(compactChartEvidence(small)).toBe(small);
  });
});
