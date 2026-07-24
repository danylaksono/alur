import { describe, expect, it } from 'vitest';
import { branchAnalysisVariant, validateScoreModel } from './variantService';

describe('analysis variants', () => {
  it('branches without mutating its parent', () => {
    const parent = { id: 'baseline', name: 'Baseline', baselineDatasetId: 'places', workflowOutputDatasetId: 'workflow:score', parameters: {}, assumptions: ['Fixed budget'], operations: [{ id: 'score', type: 'weighted-score' as const, parameters: {} }], createdAt: 1, provenance: { workflowNodeIds: ['score'] } };
    const branch = branchAnalysisVariant(parent, 'branch', 2);
    branch.operations[0].parameters.changed = true;
    expect(parent.operations[0].parameters).toEqual({});
    expect(branch).toMatchObject({ id: 'branch', parentVariantId: 'baseline', workflowOutputDatasetId: undefined, createdAt: 2 });
  });

  it('validates empty and zero-weight scoring models', () => {
    expect(validateScoreModel({ criteria: [], missingValueTreatment: 'exclude' })).toContain('Add at least one scoring criterion.');
    expect(validateScoreModel({ criteria: [{ field: 'score', weight: 0, direction: 'higher', normalisation: 'rank' }], missingValueTreatment: 'zero' })).toContain('At least one criterion weight must be non-zero.');
  });
});
