import type { AnalyticsCommand, AnalyticsCommandResult } from '../types/analyticsCommands';
import type { DatasetMetadata } from '../types/datasets';
import type { KpiSpec, VisualAnalyticsState, VisualChartSpec, VisualFilter } from '../types/visualAnalytics';
import type { LayerVisualisation, LegendSpec } from '../types/visualisation';
import { fieldByName, preferredExplorationField } from './datasetMetadata';

export type AnalyticsCommandContext = {
  datasets: DatasetMetadata[];
  visualAnalytics: VisualAnalyticsState;
  addChart: (chart: VisualChartSpec) => void;
  addKpi: (kpi: KpiSpec) => void;
  setLayerFilters: (datasetId: string, filters: VisualFilter[]) => void;
  clearLayerFilters: (datasetId: string) => void;
  updateLayerVisualisation: (datasetId: string, visualisation: LayerVisualisation, legend?: LegendSpec) => void;
  openLayerStyle: (datasetId: string, field?: string) => void;
  openChartsPanel: () => void;
  selectDataset: (datasetId: string) => void;
  focusSelection: (datasetId: string) => Promise<boolean>;
};

const chartTitle = (field: string, type: VisualChartSpec['type']) =>
  type === 'histogram' ? `${field} distribution` : type === 'line' ? `${field} over time` : `${field} breakdown`;

const appendFieldFilter = (current: VisualFilter[], next: VisualFilter): VisualFilter[] => {
  const sameFieldAndKind = (filter: VisualFilter) => filter.field === next.field && filter.kind === next.kind;
  if (next.kind === 'category') {
    const existing = current.find(
      (filter): filter is Extract<VisualFilter, { kind: 'category' }> => sameFieldAndKind(filter) && filter.kind === 'category',
    );
    if (!existing) return [...current, next];
    return current.map((filter) => filter === existing
      ? { ...existing, values: [...new Set([...existing.values, ...next.values])] }
      : filter);
  }
  return [...current.filter((filter) => !sameFieldAndKind(filter)), next];
};

export const buildDefaultChartForField = (
  metadata: DatasetMetadata,
  fieldName: string,
  chartId = `chart-${Date.now()}`,
): VisualChartSpec | null => {
  if (metadata.kind !== 'layer') return null;
  const field = fieldByName(metadata, fieldName);
  if (!field) return null;

  const type: VisualChartSpec['type'] = field.semanticType === 'numeric'
    ? 'histogram'
    : field.semanticType === 'temporal'
      ? 'line'
      : 'bar';
  return {
    id: chartId,
    title: chartTitle(field.name, type),
    layerId: metadata.id,
    type,
    dimensionField: field.name,
    aggregation: 'count',
    paletteId: field.semanticType === 'numeric' ? 'civic' : 'categorical',
    maxCategories: field.semanticType === 'temporal' ? 12 : 8,
    ...(field.semanticType === 'temporal' ? { timeGrain: 'auto' as const, showPoints: true, connectMissing: false } : {}),
  };
};

export const buildDefaultChartForDataset = (
  metadata: DatasetMetadata,
  chartId = `chart-${Date.now()}`,
) => {
  const field = preferredExplorationField(metadata);
  return field ? buildDefaultChartForField(metadata, field.name, chartId) : null;
};

export const executeAnalyticsCommand = async (
  command: AnalyticsCommand,
  context: AnalyticsCommandContext,
): Promise<AnalyticsCommandResult> => {
  const dataset = context.datasets.find((candidate) => candidate.id === command.datasetId);
  if (!dataset) {
    return { ok: false, code: 'dataset_not_found', message: `Dataset ${command.datasetId} is not available.` };
  }

  if (dataset.kind !== 'layer') {
    return {
      ok: false,
      code: 'unsupported_dataset',
      message: 'Linked commands for non-spatial tables arrive with the dataset-source milestone.',
    };
  }

  try {
    if (command.type === 'create-chart') {
      const chart = buildDefaultChartForField(dataset, command.field, command.chartId);
      if (!chart) {
        return { ok: false, code: 'field_not_found', message: `Field ${command.field} is not available.` };
      }
      context.addChart(chart);
      context.selectDataset(dataset.id);
      context.openChartsPanel();
      return { ok: true, message: `Created ${chart.title}.`, entityId: chart.id, chart };
    }

    if (command.type === 'apply-filter') {
      if (!fieldByName(dataset, command.filter.field)) {
        return { ok: false, code: 'field_not_found', message: `Field ${command.filter.field} is not available.` };
      }
      const current = context.visualAnalytics.datasets[dataset.id]?.filters || [];
      context.setLayerFilters(
        dataset.id,
        command.mode === 'replace' ? [command.filter] : appendFieldFilter(current, command.filter),
      );
      context.selectDataset(dataset.id);
      return { ok: true, message: `Filtered ${dataset.name} by ${command.filter.field}.` };
    }

    if (command.type === 'clear-filters') {
      context.clearLayerFilters(dataset.id);
      return { ok: true, message: `Cleared filters for ${dataset.name}.` };
    }

    if (command.type === 'apply-layer-style') {
      context.updateLayerVisualisation(dataset.id, command.visualisation, command.legend);
      context.selectDataset(dataset.id);
      return { ok: true, message: `Updated the style for ${dataset.name}.` };
    }

    if (command.type === 'open-layer-style') {
      if (command.field && !fieldByName(dataset, command.field)) {
        return { ok: false, code: 'field_not_found', message: `Field ${command.field} is not available.` };
      }
      context.openLayerStyle(dataset.id, command.field);
      return { ok: true, message: `Opened map styling for ${dataset.name}.` };
    }

    if (command.type === 'pin-kpi') {
      const field = command.field ? fieldByName(dataset, command.field) : undefined;
      if (command.field && !field) {
        return { ok: false, code: 'field_not_found', message: `Field ${command.field} is not available.` };
      }
      const aggregation = command.aggregation || (field?.semanticType === 'numeric' ? 'avg' : 'count');
      if (aggregation !== 'count' && field?.semanticType !== 'numeric') {
        return { ok: false, code: 'command_failed', message: `${aggregation} requires a numeric field.` };
      }
      const kpi: KpiSpec = {
        id: command.kpiId || `kpi-${Date.now()}`,
        datasetId: dataset.id,
        title: command.title || (field ? `${field.name} ${aggregation}` : `${dataset.name} rows`),
        field: field?.name,
        aggregation,
        comparison: command.comparison || 'total',
        format: command.format || 'compact',
      };
      context.addKpi(kpi);
      context.selectDataset(dataset.id);
      return { ok: true, message: `Pinned ${kpi.title}.`, entityId: kpi.id };
    }

    const selected = context.visualAnalytics.datasets[dataset.id]?.selectedFeatureIds || [];
    if (!selected.length) {
      return { ok: false, code: 'empty_selection', message: `Select records in ${dataset.name} first.` };
    }
    const focused = await context.focusSelection(dataset.id);
    return focused
      ? { ok: true, message: `Focused the selection in ${dataset.name}.` }
      : { ok: false, code: 'command_failed', message: 'The selected records do not have a usable extent.' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown analytical command error.';
    return { ok: false, code: 'command_failed', message };
  }
};
