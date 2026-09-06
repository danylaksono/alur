import { describe, expect, it } from 'vitest';
import { activeLensLayer, lensBinningFor, type LensPoints } from './lensService';
import type { MapLayer } from '../store/useStore';

const data: LensPoints = {
  points: [{ position: [0, 0], values: [10, 20] }],
  fields: ['alpha', 'beta'],
};

describe('lensBinningFor', () => {
  it('counts when no field is chosen', () => {
    expect(lensBinningFor(data, null).value).toBeUndefined();
  });

  it('reads the chosen field off each point', () => {
    expect(lensBinningFor(data, 'beta').value?.(data.points[0])).toBe(20);
  });

  // The adapter's `update` merges nested options rather than replacing them, so
  // returning to counts has to overwrite `value`, not simply omit it — omitting
  // it leaves the previous field in place and the lens never counts again.
  it('always carries the key, so switching back to counts clears the field', () => {
    expect('value' in lensBinningFor(data, null)).toBe(true);
  });

  it('falls back to counting for a field this layer does not have', () => {
    expect(lensBinningFor(data, 'gamma').value).toBeUndefined();
  });
});

describe('activeLensLayer', () => {
  const layer = (id: string, visible: boolean) => ({ id, visible }) as MapLayer;

  it('prefers the selected layer, visible or not', () => {
    const layers = [layer('a', true), layer('b', false)];
    expect(activeLensLayer(layers, 'b')?.id).toBe('b');
  });

  it('falls back to the first visible layer', () => {
    const layers = [layer('a', false), layer('b', true)];
    expect(activeLensLayer(layers, null)?.id).toBe('b');
  });

  it('has nothing to read with no visible layers', () => {
    expect(activeLensLayer([layer('a', false)], null)).toBeUndefined();
  });
});
