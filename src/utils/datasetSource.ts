import type { MapLayer } from '../store/useStore';
import type { DatasetDescriptor, DatasetSource } from '../types/datasets';
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


/** Where a chart's rows are read from: a map layer, or a registered table's relation. */
export const chartQueryTarget = (
  chart: VisualChartSpec,
  layers: MapLayer[],
  registry: Record<string, DatasetDescriptor>,
) => {
  const source = chartDatasetSource(chart);
  if (source.kind === 'layer') return { layer: layers.find((layer) => layer.id === source.layerId) };
  const descriptor = registry[source.datasetId];
  return {
    tableName: source.kind === 'table' ? source.tableName : descriptor?.relationName,
    rowIdColumn: descriptor?.rowIdColumn,
  };
};
