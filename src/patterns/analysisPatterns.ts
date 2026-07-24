import type { AnalysisPatternDefinition, AnalysisVariant, ComparisonSpec, VisualAnalyticsState } from '../types/visualAnalytics';

export const ANALYSIS_PATTERNS: AnalysisPatternDefinition[] = [
  {
    id: 'spatial-intervention-loop',
    name: 'Spatial Intervention Loop',
    description: 'Filter, prioritise, intervene, evaluate, and refine spatial decisions without enforcing a fixed sequence.',
    applicability: ['spatial data', 'candidate prioritisation', 'intervention planning'],
    capabilitySlots: [
      { id: 'filter', label: 'Filter', description: 'Define a scope or cohort.' },
      { id: 'prioritise', label: 'Prioritise', description: 'Create and inspect a score model.' },
      { id: 'intervene', label: 'Intervene', description: 'Apply an operation in a workflow-backed variant.' },
      { id: 'evaluate', label: 'Evaluate', description: 'Compare the variant with its baseline.' },
      { id: 'refine', label: 'Refine', description: 'Branch the variant and preserve reasoning.' },
    ],
    suggestedActions: ['Save a cohort', 'Create a weighted score', 'Branch a variant', 'Compare with baseline', 'Pin evidence'],
    recommendedViews: ['overview', 'distribution', 'map', 'records'],
  },
  {
    id: 'cohort-comparison',
    name: 'Cohort comparison',
    description: 'Compare two to four saved scopes with explicit denominators, overlap, and missingness.',
    applicability: ['segmentation', 'equity analysis', 'benchmarking'],
    capabilitySlots: [
      { id: 'scopes', label: 'Scopes', description: 'Define at least two operands.' },
      { id: 'measures', label: 'Measures', description: 'Choose comparable measures.' },
      { id: 'evidence', label: 'Evidence', description: 'Inspect common-scale views.' },
      { id: 'explain', label: 'Explain', description: 'Pin findings and caveats.' },
    ],
    suggestedActions: ['Add operands', 'Choose a measure', 'Inspect distribution', 'Pin a finding'],
    recommendedViews: ['overview', 'distribution', 'categories', 'records'],
  },
  {
    id: 'temporal-change',
    name: 'Temporal change analysis',
    description: 'Compare aligned time windows while preserving gaps and source context.',
    applicability: ['trends', 'before/after', 'seasonality'],
    capabilitySlots: [
      { id: 'time', label: 'Time fields', description: 'Map a time field for each operand.' },
      { id: 'windows', label: 'Windows', description: 'Define comparable time scopes.' },
      { id: 'trend', label: 'Trend', description: 'Inspect aligned temporal evidence.' },
      { id: 'explain', label: 'Explain', description: 'Capture the interpretation and limitations.' },
    ],
    suggestedActions: ['Map time fields', 'Add time windows', 'Inspect gaps', 'Pin the trend'],
    recommendedViews: ['overview', 'time', 'records'],
  },
];

export type PatternReadinessItem = { id: string; label: string; ready: boolean; note: string };

export const patternReadiness = (
  patternId: string,
  analytics: VisualAnalyticsState,
  comparisons: ComparisonSpec[] = analytics.comparisons || [],
  variants: AnalysisVariant[] = analytics.variants || [],
): PatternReadinessItem[] => {
  if (patternId === 'spatial-intervention-loop') {
    const hasScore = variants.some((variant) => variant.operations.some((operation) => operation.type === 'weighted-score'));
    return [
      { id: 'filter', label: 'Scope', ready: analytics.cohorts.length > 0 || Object.values(analytics.datasets).some((dataset) => dataset.filters.length > 0), note: 'No saved scope or active filter yet.' },
      { id: 'prioritise', label: 'Prioritisation', ready: hasScore, note: 'Prioritisation not yet defined.' },
      { id: 'intervene', label: 'Intervention', ready: variants.some((variant) => variant.operations.some((operation) => operation.type !== 'weighted-score')), note: 'Intervention not yet defined.' },
      { id: 'evaluate', label: 'Evaluation', ready: comparisons.length > 0, note: 'No baseline comparison yet.' },
      { id: 'refine', label: 'Refinement', ready: variants.some((variant) => Boolean(variant.parentVariantId)) || analytics.bookmarks.length > 0, note: 'No branch or saved analytical state yet.' },
    ];
  }
  if (patternId === 'temporal-change') {
    return [
      { id: 'time', label: 'Time mapping', ready: comparisons.some((comparison) => comparison.alignment.mode === 'temporal'), note: 'Time fields are not mapped.' },
      { id: 'windows', label: 'Time windows', ready: comparisons.some((comparison) => comparison.operands.some((operand) => operand.scope.kind === 'time-window')), note: 'No time-window operand yet.' },
      { id: 'trend', label: 'Trend view', ready: comparisons.some((comparison) => comparison.requestedViews.includes('time')), note: 'Temporal view not selected.' },
      { id: 'explain', label: 'Explanation', ready: (analytics.explain?.cards.length || 0) > 0, note: 'No evidence has been pinned.' },
    ];
  }
  return [
    { id: 'scopes', label: 'Operands', ready: comparisons.some((comparison) => comparison.operands.length >= 2), note: 'Add at least two operands.' },
    { id: 'measures', label: 'Measures', ready: comparisons.some((comparison) => comparison.measures.length > 0), note: 'Choose a comparison measure.' },
    { id: 'evidence', label: 'Evidence', ready: comparisons.length > 0, note: 'Create a saved comparison.' },
    { id: 'explain', label: 'Explanation', ready: (analytics.explain?.cards.length || 0) > 0, note: 'No evidence has been pinned.' },
  ];
};

export const analysisPatternById = (patternId?: string) => ANALYSIS_PATTERNS.find((pattern) => pattern.id === patternId);
