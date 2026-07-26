import type { DatasetSource } from '../types/datasets';
import type { KpiSpec, VisualAnalyticsState, VisualChartSpec } from '../types/visualAnalytics';

export const tableDatasetId = (tableName: string) => `table:${tableName}`;
export const workflowDatasetId = (nodeId: string) => `workflow:${nodeId}`;

export const chartDatasetSource = (chart: VisualChartSpec): DatasetSource => {
  if (chart.source) return chart.source;
  if (chart.tableName) return { kind: 'table', datasetId: tableDatasetId(chart.tableName), tableName: chart.tableName, rowIdColumn: '__alur_row_id' };
  return { kind: 'layer', layerId: chart.layerId };
};

export const chartDatasetId = (chart: VisualChartSpec) => {
  const source = chartDatasetSource(chart);
  return source.kind === 'layer' ? source.layerId : source.datasetId;
};

export const kpiDatasetSource = (kpi: KpiSpec): DatasetSource => kpi.source || { kind: 'layer', layerId: kpi.datasetId };

export const migrateVisualAnalyticsSources = (analytics: VisualAnalyticsState): VisualAnalyticsState => ({
  ...analytics,
  charts: analytics.charts.map((chart) => ({ ...chart, source: chartDatasetSource(chart) })),
  kpis: analytics.kpis.map((kpi) => ({ ...kpi, source: kpiDatasetSource(kpi) })),
});

