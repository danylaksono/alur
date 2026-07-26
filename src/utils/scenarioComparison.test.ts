import { describe, expect, it } from 'vitest';
import { comparableVariants, comparisonFromVariants } from './scenarioComparison';
import type { DatasetDescriptor } from '../types/datasets';
import type { AnalysisVariant } from '../types/visualAnalytics';

const variant = (id: string, name: string, outputId?: string): AnalysisVariant => ({
  id, name, baselineDatasetId: 'base', parameters: {}, assumptions: [], operations: [],
  createdAt: 1, provenance: { workflowNodeIds: [] }, workflowOutputDatasetId: outputId,
});

const dataset = (id: string, sourceUpdatedAt?: number) => ({ id, name: id, sourceUpdatedAt } as unknown as DatasetDescriptor);

describe('scenario comparison', () => {
  const registry = {
    'workflow:a': dataset('workflow:a', 11),
    'workflow:b': dataset('workflow:b', 12),
    'workflow:c': dataset('workflow:c'),
  };

  it('only counts scenarios whose workflow has actually produced a result', () => {
    const variants = [
      variant('v1', 'Baseline', 'workflow:a'),
      variant('v2', 'Higher uptake', 'workflow:b'),
      variant('v3', 'Never run'),
      variant('v4', 'Output missing from the registry', 'workflow:zzz'),
    ];
    expect(comparableVariants(variants, registry).map((item) => item.id)).toEqual(['v1', 'v2']);
  });

  it('builds a comparison whose groups are the scenario outputs', () => {
    const spec = comparisonFromVariants(
      [variant('v1', 'Baseline', 'workflow:a'), variant('v2', 'Higher uptake', 'workflow:b')],
      registry,
      1000,
    )!;

    expect(spec.name).toBe('Scenarios: Baseline vs Higher uptake');
    expect(spec.operands.map((operand) => [operand.label, operand.datasetId, operand.scope.kind])).toEqual([
      ['Baseline', 'workflow:a', 'whole-dataset'],
      ['Higher uptake', 'workflow:b', 'whole-dataset'],
    ]);
    // Versions are pinned so the comparison can later report drift.
    expect(spec.sourceVersions).toEqual({ 'workflow:a': 11, 'workflow:b': 12 });
    expect(spec.operands[0].colour).not.toBe(spec.operands[1].colour);
  });

  it('needs two runnable scenarios and never exceeds the four-group limit', () => {
    expect(comparisonFromVariants([], registry)).toBeNull();
    expect(comparisonFromVariants([variant('v1', 'Only one', 'workflow:a')], registry)).toBeNull();
    expect(comparisonFromVariants([variant('v1', 'A', 'workflow:a'), variant('v2', 'Never run')], registry)).toBeNull();

    const many = Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`workflow:${index}`, dataset(`workflow:${index}`)]));
    const spec = comparisonFromVariants(
      Array.from({ length: 6 }, (_, index) => variant(`v${index}`, `Scenario ${index}`, `workflow:${index}`)),
      many,
    )!;
    expect(spec.operands).toHaveLength(4);
  });
});
