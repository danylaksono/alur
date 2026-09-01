import { describe, expect, it } from 'vitest';
import type { AnalysisVariant } from '../types/visualAnalytics';
import {
  resolveScenarioDataset,
  scenarioLayerVisibility,
  scenarioOutputs,
  scenarioOwning,
} from './scenarioResolution';

const variant = (id: string, output?: string, baseline = 'baseline'): AnalysisVariant => ({
  id,
  name: id,
  baselineDatasetId: baseline,
  workflowOutputDatasetId: output,
  parameters: {},
  assumptions: [],
  operations: [],
  createdAt: 1,
  provenance: { workflowNodeIds: [] },
});

describe('scenarioOutputs', () => {
  it('indexes results by the scenario that produced them', () => {
    const map = scenarioOutputs([variant('v1', 'ds-1'), variant('v2', 'ds-2')]);
    expect(map.get('ds-1')).toBe('v1');
    expect(map.get('ds-2')).toBe('v2');
  });

  it('ignores scenarios that have not run', () => {
    expect(scenarioOutputs([variant('v1')]).size).toBe(0);
  });
});

describe('scenarioOwning', () => {
  it('names the scenario a layer belongs to', () => {
    expect(scenarioOwning([variant('v1', 'ds-1')], 'ds-1')).toBe('v1');
  });

  it('returns nothing for a layer no scenario produced', () => {
    expect(scenarioOwning([variant('v1', 'ds-1')], 'baseline')).toBeUndefined();
  });
});

describe('scenarioLayerVisibility', () => {
  const variants = [variant('v1', 'ds-1'), variant('v2', 'ds-2')];

  it('shows the active scenario and hides the others', () => {
    const changes = scenarioLayerVisibility(
      [{ id: 'ds-1', visible: false }, { id: 'ds-2', visible: true }],
      variants,
      'v1',
    );
    expect(changes).toEqual([
      { id: 'ds-1', visible: true },
      { id: 'ds-2', visible: false },
    ]);
  });

  it('hides every scenario result when standing on the baseline', () => {
    const changes = scenarioLayerVisibility(
      [{ id: 'ds-1', visible: true }, { id: 'ds-2', visible: true }],
      variants,
      undefined,
    );
    expect(changes).toEqual([
      { id: 'ds-1', visible: false },
      { id: 'ds-2', visible: false },
    ]);
  });

  it('leaves layers no scenario owns exactly as the analyst set them', () => {
    const changes = scenarioLayerVisibility(
      [{ id: 'baseline', visible: false }, { id: 'reference', visible: true }],
      variants,
      'v1',
    );
    expect(changes).toEqual([]);
  });

  it('reports nothing when visibility already matches', () => {
    const changes = scenarioLayerVisibility(
      [{ id: 'ds-1', visible: true }, { id: 'ds-2', visible: false }],
      variants,
      'v1',
    );
    expect(changes).toEqual([]);
  });
});

describe('resolveScenarioDataset', () => {
  const registry = { 'ds-1': {}, baseline: {}, other: {} };

  it('substitutes the scenario result for its own baseline', () => {
    expect(resolveScenarioDataset('baseline', variant('v1', 'ds-1'), registry)).toBe('ds-1');
  });

  it('leaves an unrelated dataset alone', () => {
    // A scenario is a claim about one line of analysis, not a lens over the
    // whole project.
    expect(resolveScenarioDataset('other', variant('v1', 'ds-1'), registry)).toBe('other');
  });

  it('falls through when the scenario has not run', () => {
    expect(resolveScenarioDataset('baseline', variant('v1'), registry)).toBe('baseline');
  });

  it('falls through when the result is no longer registered', () => {
    expect(resolveScenarioDataset('baseline', variant('v1', 'deleted'), registry)).toBe('baseline');
  });

  it('falls through with no scenario at all', () => {
    expect(resolveScenarioDataset('baseline', undefined, registry)).toBe('baseline');
  });
});
