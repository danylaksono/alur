export const FEATURE_ID_PROPERTY = '_ymn_feature_id';

export type LayerFeatureSelection = {
  hoveredFeatureId?: string;
  highlightedFeatureIds?: string[];
  selectedFeatureIds: string[];
  filters: VisualFilter[];
};

export type VisualAnalyticsState = {
  layers: Record<string, LayerFeatureSelection>;
  charts: VisualChartSpec[];
};

export type VisualChartType = 'bar' | 'donut' | 'rose' | 'histogram';

export type VisualChartAggregation = 'count' | 'sum' | 'avg' | 'min' | 'max';

export type VisualChartSpec = {
  id: string;
  title: string;
  layerId: string;
  type: VisualChartType;
  dimensionField: string;
  measureField?: string;
  aggregation: VisualChartAggregation;
  paletteId: string;
  maxCategories: number;
};

export type VisualChartDatum = {
  key: string;
  label: string;
  value: number;
  count: number;
  color: string;
  filter: VisualFilter;
  featureIds: string[];
};

export type VisualChartResult = {
  chartId: string;
  totalRows: number;
  filteredRows: number;
  data: VisualChartDatum[];
};

export type VisualFilter =
  | {
      kind: 'category';
      field: string;
      values: string[];
      includeNull?: boolean;
    }
  | {
      kind: 'range';
      field: string;
      min?: number;
      max?: number;
      includeNull?: boolean;
    }
  | {
      kind: 'temporal';
      field: string;
      start?: string;
      end?: string;
      includeNull?: boolean;
    };

export type LayerSummaryMetric = {
  field: string;
  kind: 'numeric';
  count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  sum: number | null;
};

export type LayerSummaryCategory = {
  field: string;
  values: Array<{ label: string; count: number }>;
};

export type LayerAnalyticsSummary = {
  totalRows: number;
  filteredRows: number;
  selectedRows: number;
  numericMetrics: LayerSummaryMetric[];
  categoryBreakdowns: LayerSummaryCategory[];
};
