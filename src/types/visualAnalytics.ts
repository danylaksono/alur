export const FEATURE_ID_PROPERTY = '_alur_feature_id';

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

export type VisualChartType = 'bar' | 'donut' | 'rose' | 'histogram' | 'scatter';

export type VisualChartAggregation = 'count' | 'sum' | 'avg' | 'min' | 'max';

export type VisualChartSpec = {
  id: string;
  title: string;
  layerId: string;
  /**
   * When set, the chart reads this DuckDB table directly (workflow output or
   * SQL result). Table charts are unlinked: layerId is ignored, no visual
   * filters apply, and marks don't emit filters or highlights.
   */
  tableName?: string;
  type: VisualChartType;
  dimensionField: string;
  measureField?: string;
  /** Small multiples: one mini-chart per top value of this field (not for scatter). */
  facetField?: string;
  aggregation: VisualChartAggregation;
  paletteId: string;
  maxCategories: number;
};

export type VisualChartDatum = {
  key: string;
  label: string;
  /** Aggregate over rows passing the chart's context filters (other fields' filters). */
  value: number;
  count: number;
  /** Aggregate over all rows, ignoring filters — the grey context series. */
  totalValue: number;
  totalCount: number;
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

export type VisualScatterPoint = {
  x: number;
  y: number;
  /** 1 when the row passes the chart's context filters (other fields' filters). */
  inContext: 0 | 1;
};

export type VisualScatterResult = {
  chartId: string;
  totalRows: number;
  filteredRows: number;
  /** True when points are a reservoir sample rather than every row. */
  sampled: boolean;
  points: VisualScatterPoint[];
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
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

export type SelectionDivergence =
  | {
      kind: 'numeric';
      field: string;
      /** Standardized mean difference |mean_sel − mean_rest| / std (effect size). */
      score: number;
      selectedMean: number;
      restMean: number;
    }
  | {
      kind: 'categorical';
      field: string;
      /** Total variation distance between category shares (0..1). */
      score: number;
      categories: Array<{ label: string; selectedShare: number; restShare: number }>;
    };

export type SelectionExplanation = {
  selectedCount: number;
  restCount: number;
  /** Fields ranked by how strongly the selection diverges from the rest. */
  fields: SelectionDivergence[];
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
