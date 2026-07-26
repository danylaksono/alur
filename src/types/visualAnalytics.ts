export const FEATURE_ID_PROPERTY = '_alur_feature_id';

export type DatasetInteractionState = {
  hoveredFeatureId?: string;
  highlightedFeatureIds?: string[];
  selectedFeatureIds: string[];
  filters: VisualFilter[];
};

export type VisualAnalyticsState = {
  datasets: Record<string, DatasetInteractionState>;
  charts: VisualChartSpec[];
  kpis: KpiSpec[];
  cohorts: CohortSpec[];
  bookmarks: AnalyticalBookmark[];
  comparisons?: ComparisonSpec[];
  activeComparisonId?: string;
  explain?: ExplainDocument;
  variants?: AnalysisVariant[];
  comparison?: CohortComparisonSelection;
  /** @deprecated v1 compatibility only. New projects use `explain`. */
  dashboard?: DashboardLayout;
};

export type ComparisonScope =
  | { kind: 'whole-dataset' }
  | { kind: 'filters'; filters: VisualFilter[] }
  | { kind: 'cohort'; cohortId: string; definition: CohortSpec['definition'] }
  | { kind: 'materialised-selection'; tableName: string; rowIds?: string[] }
  | { kind: 'time-window'; field: string; start?: string; end?: string };

export type ComparisonOperand = {
  id: string;
  label: string;
  colour: string;
  datasetId: string;
  scope: ComparisonScope;
  sourceVersion?: string | number;
};

export type ComparisonAlignment = {
  mode: 'aggregate-only' | 'entity-keyed' | 'temporal' | 'spatial';
  keyFields?: Record<string, string>;
  timeFields?: Record<string, string>;
  spatialFields?: Record<string, string>;
};

export type ComparisonMeasure = {
  id: string;
  label: string;
  fields: Record<string, string | undefined>;
  aggregation: KpiAggregation;
  format?: KpiFormat;
  unit?: string;
  preferredDirection?: 'higher' | 'lower';
};

export type ComparisonView = 'overview' | 'distribution' | 'categories' | 'time' | 'map' | 'records';

export type ComparisonSpec = {
  id: string;
  name: string;
  operands: ComparisonOperand[];
  alignment: ComparisonAlignment;
  measures: ComparisonMeasure[];
  dimensions: string[];
  requestedViews: ComparisonView[];
  sourceVersions: Record<string, string | number | undefined>;
  createdAt: number;
  updatedAt: number;
};

export type ComparisonValue = {
  operandId: string;
  value: number | null;
  denominator: number;
  missing: number;
};

export type ComparisonAlignedRecord = {
  key: string;
  presentOperandIds: string[];
  values: Record<string, Record<string, number | null>>;
  /** B minus A for two-operand numeric measures. */
  deltas: Record<string, number | null>;
};

export type ComparisonSpatialSample = {
  operandId: string;
  measureId?: string;
  features: GeoJSON.FeatureCollection;
  sampled: boolean;
  featureCount: number;
};

export type ComparisonResult = {
  specId: string;
  summaries: Array<{ measureId: string; values: ComparisonValue[] }>;
  distributions: Array<{ measureId: string; operandId: string; bins: Array<{ label: string; count: number; share: number }> }>;
  categoryShares: Array<{ dimension: string; operandId: string; values: Array<{ label: string; count: number; share: number }> }>;
  temporalSeries: Array<{ measureId: string; operandId: string; points: Array<{ period: string; value: number | null }> }>;
  overlap?: Array<{ operandAId: string; operandBId: string; count: number }>;
  alignedRecords?: ComparisonAlignedRecord[];
  alignedRecordCount?: number;
  alignedRecordsTruncated?: boolean;
  spatialSamples?: ComparisonSpatialSample[];
  differenceSpatialSample?: ComparisonSpatialSample;
  warnings: string[];
  generatedAt: number;
};

export type EvidenceProvenance = {
  capturedAt: number;
  datasetIds: string[];
  sourceVersions: Record<string, string | number | undefined>;
  filtersByDataset: Record<string, VisualFilter[]>;
  query?: string;
  comparisonSpec?: ComparisonSpec;
  caveats: string[];
};

export type ExplainCardKind = 'chart' | 'kpi' | 'table' | 'comparison' | 'map' | 'finding' | 'note' | 'section-intro';
export type ExplainEvidenceRole = 'supports' | 'contradicts' | 'context';
export type ExplainEvidenceLink = { cardId: string; role: ExplainEvidenceRole; note?: string };
export type ExplainCard = {
  id: string;
  sectionId: string;
  kind: ExplainCardKind;
  referenceId?: string;
  comparisonView?: ComparisonView;
  comparisonMapMode?: 'multiples' | 'difference';
  datasetId?: string;
  title?: string;
  /** Editorial explanation attached to the visual, separate from its title. */
  takeaway?: string;
  caption?: string;
  note?: string;
  claim?: string;
  interpretation?: string;
  caveat?: string;
  conclusionStatus?: 'draft' | 'supported' | 'contested';
  confidence?: 'tentative' | 'moderate' | 'strong';
  evidenceLinks?: ExplainEvidenceLink[];
  width: 3 | 4 | 6 | 8 | 12;
  height: 'compact' | 'standard' | 'tall';
  behaviour: 'frozen' | 'live';
  presentationInteraction?: 'captured' | 'interactive';
  frozenValues?: unknown;
  provenance?: EvidenceProvenance;
};

export type ExplainSection = {
  id: string;
  title: string;
  purpose?: string;
  presentationVisibility?: 'auto' | 'always' | 'hidden';
};
export type ExplainDocument = {
  title: string;
  audience?: string;
  summary?: string;
  sections: ExplainSection[];
  cards: ExplainCard[];
  presentationMode?: boolean;
};

export type ScoreCriterion = {
  field: string;
  weight: number;
  direction: 'higher' | 'lower';
  normalisation: 'min-max' | 'z-score' | 'rank';
};

export type ScoreModelSpec = {
  criteria: ScoreCriterion[];
  missingValueTreatment: 'exclude' | 'zero' | 'mean';
  sensitivity?: number[];
};

export type VariantOperation = {
  id: string;
  type: 'weighted-score' | 'ranked-selection' | 'value-change' | 'allocation' | 'phase-assignment' | 'remove-operation';
  parameters: Record<string, unknown>;
  assumptions?: string[];
};

export type AnalysisVariant = {
  id: string;
  name: string;
  baselineDatasetId: string;
  parentVariantId?: string;
  workflowOutputDatasetId?: string;
  parameters: Record<string, unknown>;
  assumptions: string[];
  operations: VariantOperation[];
  createdAt: number;
  provenance: { workflowNodeIds: string[]; sourceVersion?: string | number };
};

export type DashboardCard = {
  id: string;
  kind: 'chart' | 'kpi' | 'table' | 'note';
  referenceId?: string;
  datasetId?: string;
  title?: string;
  note?: string;
  width: 1 | 2;
  height: 'compact' | 'standard' | 'tall';
};

export type DashboardLayout = {
  title: string;
  cards: DashboardCard[];
};

export type CohortSpec = {
  id: string;
  datasetId: string;
  name: string;
  colour: string;
  definition:
    | { kind: 'filters'; filters: VisualFilter[] }
    | { kind: 'selection-table'; tableName: string };
  createdAt: number;
};

export type CohortComparisonSelection = {
  datasetId: string;
  cohortAId: string;
  cohortBId?: string;
  compareToRemainder?: boolean;
};

export type AnalyticalBookmark = {
  id: string;
  name: string;
  note?: string;
  createdAt: number;
  datasetId: string | null;
  filtersByDataset: Record<string, VisualFilter[]>;
  cohorts: CohortSpec[];
  mapCamera: { longitude: number; latitude: number; zoom: number; bearing: number; pitch: number };
  charts: VisualChartSpec[];
  kpis: KpiSpec[];
};

export type CohortNumericComparison = {
  field: string;
  aCount: number;
  bCount: number;
  aMissing: number;
  bMissing: number;
  aMean: number | null;
  bMean: number | null;
  effectSize: number | null;
  bins: Array<{ label: string; aCount: number; bCount: number }>;
};

export type CohortCategoryComparison = {
  field: string;
  values: Array<{ label: string; aCount: number; bCount: number; aShare: number; bShare: number; shareDifference: number }>;
};

export type CohortTemporalComparison = {
  field: string;
  grain: 'month';
  points: Array<{ period: string; aCount: number; bCount: number }>;
};

export type CohortComparisonResult = {
  totalRows: number;
  aRows: number;
  bRows: number;
  overlapRows: number;
  aOnlyRows: number;
  bOnlyRows: number;
  denominatorNote: string;
  missingValueNote: string;
  numeric: CohortNumericComparison[];
  categorical: CohortCategoryComparison[];
  temporal?: CohortTemporalComparison;
};

export type KpiAggregation = 'count' | 'sum' | 'avg' | 'min' | 'max';
export type KpiComparison = 'none' | 'total' | 'previous-period' | 'cohort';
export type KpiFormat = 'number' | 'compact' | 'percent' | 'currency';

export type KpiSpec = {
  id: string;
  datasetId: string;
  title: string;
  field?: string;
  aggregation: KpiAggregation;
  comparison: KpiComparison;
  format?: KpiFormat;
  unit?: string;
  source?: import('./datasets').DatasetSource;
};

export type KpiResult = {
  specId: string;
  value: number | null;
  comparisonValue: number | null;
  delta: number | null;
  activeRows: number;
  totalRows: number;
  comparisonAvailable: boolean;
  comparisonNote?: string;
};

export type VisualChartType = 'bar' | 'donut' | 'rose' | 'histogram' | 'scatter' | 'line' | 'area';

export type TimeGrain = 'auto' | 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';

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
  timeGrain?: TimeGrain;
  seriesField?: string;
  showPoints?: boolean;
  /** When false (the default), periods without observations break the line. */
  connectMissing?: boolean;
  source?: import('./datasets').DatasetSource;
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

export type VisualTemporalPoint = {
  bucketStart: string;
  bucketEnd: string;
  label: string;
  value: number | null;
  count: number;
  totalValue: number | null;
  totalCount: number;
};

export type VisualTemporalSeries = {
  key: string;
  label: string;
  color: string;
  points: VisualTemporalPoint[];
};

export type VisualTemporalResult = {
  chartId: string;
  grain: Exclude<TimeGrain, 'auto'>;
  totalRows: number;
  filteredRows: number;
  minDate: string;
  maxDate: string;
  series: VisualTemporalSeries[];
  /** True when values outside the top-N series are combined into “Other”. */
  hasOtherSeries: boolean;
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
      mode?: 'include' | 'exclude';
    }
  | {
      kind: 'range';
      field: string;
      min?: number;
      max?: number;
      includeNull?: boolean;
      mode?: 'include' | 'exclude';
    }
  | {
      kind: 'temporal';
      field: string;
      start?: string;
      end?: string;
      includeNull?: boolean;
      mode?: 'include' | 'exclude';
    }
  | {
      kind: 'text';
      field: string;
      operator: 'contains' | 'starts_with' | 'ends_with' | 'equals';
      value: string;
      caseSensitive?: boolean;
      mode?: 'include' | 'exclude';
    }
  | {
      kind: 'boolean';
      field: string;
      value: boolean;
      mode?: 'include' | 'exclude';
    }
  | {
      kind: 'null';
      field: string;
      isNull: boolean;
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

export type LayerSummaryStatistic = {
  count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  sum: number | null;
};

export type LayerSummaryMetric = {
  field: string;
  kind: 'numeric';
  selected: LayerSummaryStatistic;
  active: LayerSummaryStatistic;
  total: LayerSummaryStatistic;
};

export type LayerSummaryCategory = {
  field: string;
  values: Array<{ label: string; selectedCount: number; activeCount: number; totalCount: number }>;
};

export type LayerAnalyticsSummary = {
  totalRows: number;
  filteredRows: number;
  selectedRows: number;
  numericMetrics: LayerSummaryMetric[];
  categoryBreakdowns: LayerSummaryCategory[];
};
