import { describe, it, expect } from 'vitest';
import type { AnalysisVariant } from '../types/visualAnalytics';
import {
  assumptionsBehindDatasets,
  buildVariantTree,
  flattenVariantParameters,
  flattenVariantTree,
  formatVariantValue,
  variantDifferences,
  variantsBehindDatasets,
} from './variantLineage';

const variant = (over: Partial<AnalysisVariant> = {}): AnalysisVariant => ({
  id: 'v1',
  name: 'Baseline',
  baselineDatasetId: 'ds',
  parameters: {},
  assumptions: [],
  operations: [],
  createdAt: 1,
  provenance: { workflowNodeIds: [] },
  ...over,
});

const scored = (weights: Record<string, number>, over: Partial<AnalysisVariant> = {}) => variant({
  operations: [{
    id: `op-${Math.random()}`,
    type: 'weighted-score',
    parameters: {
      resultField: 'alur_priority_score',
      scoreModel: {
        criteria: Object.entries(weights).map(([field, weight]) => ({ field, weight, direction: 'higher', normalisation: 'min-max' })),
        missingValueTreatment: 'zero',
      },
    },
  }],
  ...over,
});

describe('flattenVariantParameters', () => {
  it('names array elements by their own identity, not their position', () => {
    const flat = flattenVariantParameters(scored({ Gcons2023: 1, IMD: 2 }));
    expect(flat.get('weighted-score.scoreModel.criteria.Gcons2023.weight')).toBe(1);
    expect(flat.get('weighted-score.scoreModel.criteria.IMD.weight')).toBe(2);
  });

  it('keeps two operations of the same type apart', () => {
    const flat = flattenVariantParameters(variant({
      operations: [
        { id: 'a', type: 'value-change', parameters: { amount: 1 } },
        { id: 'b', type: 'value-change', parameters: { amount: 2 } },
      ],
    }));
    expect(flat.get('value-change.amount')).toBe(1);
    expect(flat.get('value-change 2.amount')).toBe(2);
  });

  it('includes the variant\'s own parameters', () => {
    expect(flattenVariantParameters(variant({ parameters: { budget: 500 } })).get('parameters.budget')).toBe(500);
  });
});

describe('variantDifferences', () => {
  it('reports only what actually changed', () => {
    const parent = scored({ Gcons2023: 1, IMD: 1 });
    const child = scored({ Gcons2023: 3, IMD: 1 }, { id: 'v2', parentVariantId: 'v1' });
    const differences = variantDifferences(child, parent);
    expect(differences).toHaveLength(1);
    expect(differences[0]).toMatchObject({ path: 'weighted-score.scoreModel.criteria.Gcons2023.weight', before: 1, after: 3 });
  });

  it('survives a branch getting fresh operation ids', () => {
    // Operations are keyed by type, so an id change alone is not a difference.
    const parent = scored({ a: 1 });
    const child = scored({ a: 1 }, { id: 'v2', parentVariantId: 'v1' });
    expect(variantDifferences(child, parent)).toEqual([]);
  });

  it('reports a criterion added or removed', () => {
    const parent = scored({ a: 1 });
    const child = scored({ a: 1, b: 2 }, { id: 'v2' });
    const paths = variantDifferences(child, parent).map((item) => item.path);
    expect(paths).toContain('weighted-score.scoreModel.criteria.b.weight');
    expect(variantDifferences(child, parent).find((item) => item.path.includes('.b.weight'))?.before).toBeUndefined();
  });

  it('has nothing to say about a root', () => {
    expect(variantDifferences(scored({ a: 1 }), undefined)).toEqual([]);
  });
});

describe('buildVariantTree', () => {
  it('nests branches under their parents, oldest first', () => {
    const tree = buildVariantTree([
      variant({ id: 'child-b', parentVariantId: 'root', createdAt: 3 }),
      variant({ id: 'root', createdAt: 1 }),
      variant({ id: 'child-a', parentVariantId: 'root', createdAt: 2 }),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].variant.id).toBe('root');
    expect(tree[0].children.map((node) => node.variant.id)).toEqual(['child-a', 'child-b']);
    expect(tree[0].children[0].depth).toBe(1);
  });

  it('nests a grandchild', () => {
    const tree = buildVariantTree([
      variant({ id: 'a', createdAt: 1 }),
      variant({ id: 'b', parentVariantId: 'a', createdAt: 2 }),
      variant({ id: 'c', parentVariantId: 'b', createdAt: 3 }),
    ]);
    expect(flattenVariantTree(tree).map((node) => `${node.depth}:${node.variant.id}`)).toEqual(['0:a', '1:b', '2:c']);
  });

  it('keeps an orphan rather than dropping it', () => {
    // Losing a scenario from the account because its ancestor was deleted is
    // worse than showing it without its origin.
    const tree = buildVariantTree([variant({ id: 'orphan', parentVariantId: 'deleted' })]);
    expect(tree.map((node) => node.variant.id)).toEqual(['orphan']);
    expect(tree[0].depth).toBe(0);
  });

  it('does not hang on a parent cycle', () => {
    const tree = buildVariantTree([
      variant({ id: 'a', parentVariantId: 'b', createdAt: 1 }),
      variant({ id: 'b', parentVariantId: 'a', createdAt: 2 }),
    ]);
    expect(flattenVariantTree(tree).length).toBeLessThanOrEqual(2);
  });

  it('carries each branch\'s difference from its parent', () => {
    const tree = buildVariantTree([
      scored({ a: 1 }, { id: 'root', createdAt: 1 }),
      scored({ a: 5 }, { id: 'branch', parentVariantId: 'root', createdAt: 2 }),
    ]);
    expect(tree[0].differencesFromParent).toEqual([]);
    expect(tree[0].children[0].differencesFromParent).toHaveLength(1);
  });
});

describe('variantsBehindDatasets', () => {
  const variants = [
    variant({ id: 'v1', workflowOutputDatasetId: 'out-1', assumptions: ['Weights are equal.', 'Missing values count as zero.'] }),
    variant({ id: 'v2', workflowOutputDatasetId: 'out-2', assumptions: ['Missing values count as zero.'] }),
    variant({ id: 'v3', assumptions: ['Never run.'] }),
  ];

  it('finds the variant that produced a card\'s dataset', () => {
    expect(variantsBehindDatasets(variants, ['out-2']).map((item) => item.id)).toEqual(['v2']);
  });

  it('ignores a variant that has not produced anything yet', () => {
    expect(variantsBehindDatasets(variants, ['out-1', 'out-2']).map((item) => item.id)).toEqual(['v1', 'v2']);
  });

  it('returns nothing for a card built from no dataset', () => {
    expect(variantsBehindDatasets(variants, [])).toEqual([]);
  });

  it('collects assumptions without repeating a shared one', () => {
    expect(assumptionsBehindDatasets(variants, ['out-1', 'out-2']))
      .toEqual(['Weights are equal.', 'Missing values count as zero.']);
  });
});

describe('formatVariantValue', () => {
  it('renders absence and presence distinctly', () => {
    expect(formatVariantValue(undefined)).toBe('—');
    expect(formatVariantValue(null)).toBe('none');
  });

  it('trims trailing zeros from a weight without mangling integers', () => {
    expect(formatVariantValue(3)).toBe('3');
    expect(formatVariantValue(0.25)).toBe('0.25');
    expect(formatVariantValue(0.3333333)).toBe('0.333');
  });

  it('renders booleans as words', () => {
    expect(formatVariantValue(true)).toBe('yes');
    expect(formatVariantValue(false)).toBe('no');
  });
});
