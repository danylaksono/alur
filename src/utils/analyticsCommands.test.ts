import { describe, expect, it, vi } from 'vitest';
import type { DatasetMetadata } from '../types/datasets';
import type { AnalyticsCommandContext } from './analyticsCommands';
import { buildDefaultChartForField, executeAnalyticsCommand } from './analyticsCommands';

const dataset: DatasetMetadata = {
  id: 'places',
  name: 'Places',
  kind: 'layer',
  fields: [
    { name: 'category', type: 'VARCHAR', semanticType: 'categorical' },
    { name: 'score', type: 'DOUBLE', semanticType: 'numeric' },
    { name: 'created_at', type: 'TIMESTAMP', semanticType: 'temporal' },
  ],
};

const context = (): AnalyticsCommandContext => ({
  datasets: [dataset],
  visualAnalytics: { datasets: { places: { selectedFeatureIds: ['a'], filters: [] } }, charts: [], kpis: [], cohorts: [], bookmarks: [] },
  addChart: vi.fn(),
  addKpi: vi.fn(),
  setLayerFilters: vi.fn(),
  clearLayerFilters: vi.fn(),
  updateLayerVisualisation: vi.fn(),
  openLayerStyle: vi.fn(),
  openChartsPanel: vi.fn(),
  selectDataset: vi.fn(),
  focusSelection: vi.fn().mockResolvedValue(true),
});

describe('analytical commands', () => {
  it('chooses chart defaults from field semantics', () => {
    expect(buildDefaultChartForField(dataset, 'category', 'category-chart')).toMatchObject({
      id: 'category-chart',
      type: 'bar',
      dimensionField: 'category',
    });
    expect(buildDefaultChartForField(dataset, 'score', 'score-chart')).toMatchObject({
      id: 'score-chart',
      type: 'histogram',
      dimensionField: 'score',
    });
    expect(buildDefaultChartForField(dataset, 'created_at', 'time-chart')).toMatchObject({
      id: 'time-chart',
      type: 'line',
      dimensionField: 'created_at',
      timeGrain: 'auto',
      connectMissing: false,
    });
  });

  it('creates a chart and opens the linked chart panel', async () => {
    const actions = context();
    const result = await executeAnalyticsCommand({
      type: 'create-chart',
      datasetId: 'places',
      field: 'score',
      chartId: 'chart-1',
    }, actions);

    expect(result).toMatchObject({ ok: true, entityId: 'chart-1' });
    expect(actions.addChart).toHaveBeenCalledWith(expect.objectContaining({ type: 'histogram' }));
    expect(actions.selectDataset).toHaveBeenCalledWith('places');
    expect(actions.openChartsPanel).toHaveBeenCalledOnce();
  });

  it('validates fields before applying filters', async () => {
    const actions = context();
    const result = await executeAnalyticsCommand({
      type: 'apply-filter',
      datasetId: 'places',
      filter: { kind: 'category', field: 'missing', values: ['x'] },
    }, actions);
    expect(result).toMatchObject({ ok: false, code: 'field_not_found' });
    expect(actions.setLayerFilters).not.toHaveBeenCalled();
  });

  it('pins a numeric field as an undoable metric specification', async () => {
    const actions = context();
    const result = await executeAnalyticsCommand({ type: 'pin-kpi', datasetId: 'places', field: 'score', kpiId: 'kpi-1' }, actions);
    expect(result).toMatchObject({ ok: true, entityId: 'kpi-1' });
    expect(actions.addKpi).toHaveBeenCalledWith(expect.objectContaining({
      id: 'kpi-1', datasetId: 'places', field: 'score', aggregation: 'avg', comparison: 'total',
    }));
  });

  it('merges included categories on the same field', async () => {
    const actions = context();
    actions.visualAnalytics.datasets.places.filters = [
      { kind: 'category', field: 'category', values: ['park'] },
    ];
    const result = await executeAnalyticsCommand({
      type: 'apply-filter',
      datasetId: 'places',
      filter: { kind: 'category', field: 'category', values: ['school'] },
    }, actions);
    expect(result.ok).toBe(true);
    expect(actions.setLayerFilters).toHaveBeenCalledWith('places', [
      { kind: 'category', field: 'category', values: ['park', 'school'] },
    ]);
  });

  it('focuses a non-empty selection through the command context', async () => {
    const actions = context();
    const result = await executeAnalyticsCommand({ type: 'focus-selection', datasetId: 'places' }, actions);
    expect(result.ok).toBe(true);
    expect(actions.focusSelection).toHaveBeenCalledWith('places');
  });
});
