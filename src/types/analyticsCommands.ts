import type { KpiAggregation, KpiComparison, KpiFormat, VisualFilter, VisualChartSpec } from './visualAnalytics';
import type { LayerVisualisation, LegendSpec } from './visualisation';

export type AnalyticsCommand =
  | {
      type: 'create-chart';
      datasetId: string;
      field: string;
      chartId?: string;
    }
  | {
      type: 'apply-filter';
      datasetId: string;
      filter: VisualFilter;
      mode?: 'append' | 'replace';
    }
  | {
      type: 'clear-filters';
      datasetId: string;
    }
  | {
      type: 'apply-layer-style';
      datasetId: string;
      visualisation: LayerVisualisation;
      legend?: LegendSpec;
    }
  | {
      type: 'open-layer-style';
      datasetId: string;
      field?: string;
    }
  | {
      type: 'focus-selection';
      datasetId: string;
    }
  | {
      type: 'pin-kpi';
      datasetId: string;
      field?: string;
      title?: string;
      aggregation?: KpiAggregation;
      comparison?: KpiComparison;
      format?: KpiFormat;
      kpiId?: string;
    };

export type AnalyticsCommandErrorCode =
  | 'dataset_not_found'
  | 'field_not_found'
  | 'unsupported_dataset'
  | 'empty_selection'
  | 'command_failed';

export type AnalyticsCommandResult =
  | {
      ok: true;
      message: string;
      entityId?: string;
      chart?: VisualChartSpec;
    }
  | {
      ok: false;
      code: AnalyticsCommandErrorCode;
      message: string;
    };
