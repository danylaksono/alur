import type { DatasetDescriptor } from '../types/datasets';
import type { AnalysisVariant, ComparisonSpec } from '../types/visualAnalytics';

const OPERAND_COLOURS = ['#2563eb', '#e11d48', '#059669', '#d97706'];

/** The most groups a comparison supports. */
export const MAX_SCENARIO_OPERANDS = 4;

/**
 * A variant is only comparable once its workflow has run and registered an
 * output dataset — the comparison reads datasets, not specifications.
 */
export const comparableVariants = (
  variants: AnalysisVariant[],
  registry: Record<string, DatasetDescriptor>,
) => variants.filter((variant) => Boolean(variant.workflowOutputDatasetId && registry[variant.workflowOutputDatasetId]));

/**
 * Builds a comparison whose groups are scenario outputs.
 *
 * Scenario comparison already worked — variants produce datasets and
 * comparisons consume them — but nothing connected the two, so the operand
 * dropdown just listed opaque dataset names.
 */
export const comparisonFromVariants = (
  variants: AnalysisVariant[],
  registry: Record<string, DatasetDescriptor>,
  now = Date.now(),
): ComparisonSpec | null => {
  const usable = comparableVariants(variants, registry).slice(0, MAX_SCENARIO_OPERANDS);
  if (usable.length < 2) return null;

  const operands = usable.map((variant, index) => {
    const datasetId = variant.workflowOutputDatasetId!;
    return {
      id: `operand-${variant.id}`,
      label: variant.name,
      colour: OPERAND_COLOURS[index % OPERAND_COLOURS.length],
      datasetId,
      scope: { kind: 'whole-dataset' as const },
      sourceVersion: registry[datasetId]?.sourceUpdatedAt,
    };
  });

  return {
    id: `comparison-scenarios-${now}`,
    name: `Scenarios: ${usable.map((variant) => variant.name).join(' vs ')}`.slice(0, 120),
    operands,
    alignment: { mode: 'aggregate-only' },
    measures: [{ id: 'rows', label: 'Rows', fields: {}, aggregation: 'count', format: 'compact' }],
    dimensions: [],
    requestedViews: ['overview', 'distribution', 'categories'],
    sourceVersions: Object.fromEntries(operands.map((operand) => [operand.datasetId, registry[operand.datasetId]?.sourceUpdatedAt])),
    createdAt: now,
    updatedAt: now,
  };
};
