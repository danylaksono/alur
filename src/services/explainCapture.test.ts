import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../store/useStore';
import type { KpiResult, KpiSpec, VisualChartSpec } from '../types/visualAnalytics';
import { isChartEvidenceCapture } from './chartExportService';
import { pinChartEvidence, pinKpiEvidence } from './explainCapture';

const chart: VisualChartSpec = { id: 'c1', title: 'Tenure', layerId: '', type: 'bar', dimensionField: 'tenure', aggregation: 'count', paletteId: 'categorical', maxCategories: 8, source: { kind: 'table', datasetId: 'table:homes', tableName: 'homes', rowIdColumn: '__alur_row_id' } };
const data = { kind: 'aggregate' as const, result: { chartId: 'c1', totalRows: 5, filteredRows: 2, data: [] } };

describe('pinning exploration evidence to the report', () => {
  beforeEach(() => {
    useStore.getState().resetWorkspace();
    useStore.setState({ toasts: [] });
  });

  it('freezes a copy of the chart, its values and its filters against the chart dataset', () => {
    const filters = [{ kind: 'category' as const, field: 'region', values: ['North'] }];
    pinChartEvidence(chart, filters, data);
    const card = useStore.getState().visualAnalytics.explain!.cards.at(-1)!;
    expect(card).toMatchObject({ kind: 'chart', referenceId: 'c1', title: 'Tenure', behaviour: 'frozen' });
    expect(card.provenance).toMatchObject({ datasetIds: ['table:homes'], filtersByDataset: { 'table:homes': filters } });
    expect(isChartEvidenceCapture(card.frozenValues)).toBe(true);
    // Editing the chart afterwards must not rewrite what the report says it showed.
    chart.title = 'Renamed';
    expect((card.frozenValues as { chart: VisualChartSpec }).chart.title).toBe('Tenure');
    chart.title = 'Tenure';
  });

  it('pins a metric value with its denominator and comparison as the caption', () => {
    const spec: KpiSpec = { id: 'k1', datasetId: 'table:homes', title: 'Mean rent', field: 'rent', aggregation: 'avg', comparison: 'total' };
    const result: KpiResult = { specId: 'k1', value: 812.5, comparisonValue: 750, delta: 0.0833, activeRows: 40, totalRows: 100, comparisonAvailable: true };
    pinKpiEvidence(spec, [], result);
    const card = useStore.getState().visualAnalytics.explain!.cards.at(-1)!;
    expect(card).toMatchObject({ kind: 'kpi', frozenValues: 812.5, caption: '40 of 100 rows · +8.3% vs the unfiltered total' });
  });

  it('refuses to pin a metric that has no value', () => {
    const before = useStore.getState().visualAnalytics.explain!.cards.length;
    pinKpiEvidence({ id: 'k2', datasetId: 'x', title: 'Empty', aggregation: 'count', comparison: 'none' }, [], { specId: 'k2', value: null, comparisonValue: null, delta: null, activeRows: 0, totalRows: 0, comparisonAvailable: false });
    expect(useStore.getState().visualAnalytics.explain!.cards).toHaveLength(before);
  });
});
