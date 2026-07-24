import { describe, expect, it } from 'vitest';
import { combineFeatureSelection, featureIdsFromRenderedFeatures, screenSelectionBox } from './mapSelection';

describe('map selection helpers', () => {
  it('combines replace, add and subtract operations deterministically', () => {
    expect(combineFeatureSelection(['a'], ['b', 'b'], 'replace')).toEqual(['b']);
    expect(combineFeatureSelection(['a'], ['b', 'a'], 'add')).toEqual(['a', 'b']);
    expect(combineFeatureSelection(['a', 'b'], ['a'], 'subtract')).toEqual(['b']);
  });

  it('deduplicates stable rendered feature ids', () => {
    expect(featureIdsFromRenderedFeatures([
      { properties: { _alur_feature_id: 'a' } },
      { properties: { _alur_feature_id: 'a' } },
      { id: 2, properties: {} },
    ])).toEqual(['a', '2']);
  });

  it('normalises drag direction into a query box', () => {
    expect(screenSelectionBox({ x: 20, y: 5 }, { x: 3, y: 12 })).toEqual([[3, 5], [20, 12]]);
  });
});

