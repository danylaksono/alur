import type { AnalysisVariant, ScoreModelSpec } from '../types/visualAnalytics';

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
