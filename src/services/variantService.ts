import type { AnalysisVariant, ScoreModelSpec, VariantOperation } from '../types/visualAnalytics';

/**
 * The operation kinds ALUR provides itself, lowered to ordinary workflow nodes.
 *
 * These stay separate from the provider registry in `operationRegistry.ts`, and
 * the split is a real one rather than a migration left half-done: a built-in
 * lowers to SQL the engine already runs, so it needs no lifecycle, no inputs to
 * bind and no host to run in. A provider is code that ALUR cannot express. Both
 * write the same `VariantOperation` record, which is what lets the history, the
 * account and the export treat them alike.
 */
export type OperationDefinition = {
  type: VariantOperation['type'];
  label: string;
  description: string;
  requiredParameters: string[];
  validate: (parameters: Record<string, unknown>) => string[];
  workflowNodes: (operation: VariantOperation) => Array<{ type: 'attribute' | 'filter' | 'analysis'; config: Record<string, unknown> }>;
};

const requireParameters = (required: string[]) => (parameters: Record<string, unknown>) =>
  required.filter((key) => parameters[key] === undefined || parameters[key] === '').map((key) => `${key} is required.`);

export const OPERATION_DEFINITIONS: OperationDefinition[] = [
  { type: 'weighted-score', label: 'Calculate weighted score', description: 'Normalise criteria and combine them into a reviewable score.', requiredParameters: ['scoreModel'], validate: requireParameters(['scoreModel']), workflowNodes: (operation) => [{ type: 'attribute', config: { operation: 'weighted-score', ...operation.parameters } }] },
  { type: 'ranked-selection', label: 'Select ranked candidates', description: 'Select the top candidates from a score or measure.', requiredParameters: ['field', 'limit'], validate: requireParameters(['field', 'limit']), workflowNodes: (operation) => [{ type: 'filter', config: { operation: 'ranked-selection', ...operation.parameters } }] },
  { type: 'value-change', label: 'Apply value or category change', description: 'Model a hypothetical attribute change.', requiredParameters: ['field', 'value'], validate: requireParameters(['field', 'value']), workflowNodes: (operation) => [{ type: 'attribute', config: { operation: 'value-change', ...operation.parameters } }] },
  { type: 'allocation', label: 'Allocate under a limit', description: 'Allocate a numeric budget or capacity across ranked candidates.', requiredParameters: ['field', 'limit'], validate: requireParameters(['field', 'limit']), workflowNodes: (operation) => [{ type: 'analysis', config: { operation: 'allocation', ...operation.parameters } }] },
  { type: 'phase-assignment', label: 'Assign a phase', description: 'Assign candidates to an implementation phase.', requiredParameters: ['field'], validate: requireParameters(['field']), workflowNodes: (operation) => [{ type: 'attribute', config: { operation: 'phase-assignment', ...operation.parameters } }] },
  { type: 'remove-operation', label: 'Remove or reverse operation', description: 'Represent an explicit reversal without mutating the parent variant.', requiredParameters: ['operationId'], validate: requireParameters(['operationId']), workflowNodes: (operation) => [{ type: 'attribute', config: { operation: 'remove-operation', ...operation.parameters } }] },
];

export const validateScoreModel = (spec: ScoreModelSpec) => {
  const errors: string[] = [];
  if (!spec.criteria.length) errors.push('Add at least one scoring criterion.');
  if (spec.criteria.some((criterion) => !Number.isFinite(criterion.weight))) errors.push('Every criterion needs a finite weight.');
  if (spec.criteria.length && spec.criteria.every((criterion) => criterion.weight === 0)) errors.push('At least one criterion weight must be non-zero.');
  return errors;
};

export const branchAnalysisVariant = (parent: AnalysisVariant, id: string, now = Date.now()): AnalysisVariant => ({
  ...structuredClone(parent),
  id,
  name: `${parent.name} branch`,
  parentVariantId: parent.id,
  workflowOutputDatasetId: undefined,
  createdAt: now,
  provenance: { ...parent.provenance, workflowNodeIds: [] },
});
