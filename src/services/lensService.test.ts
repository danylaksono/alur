import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LENS_CONFIG,
  activeLensLayer,
  lensBinningFor,
  lensPlacementFor,
  type LensConfig,
  type LensPoints,
} from './lensService';
import type { MapLayer } from '../store/useStore';

const config = (patch: Partial<LensConfig> = {}): LensConfig => ({ ...DEFAULT_LENS_CONFIG, ...patch });

const data: LensPoints = {
  points: [
    { position: [0, 0], values: [10, 20], category: 'shop' },
    { position: [1, 1], values: [30, 40], category: 'food' },
  ],
  fields: ['alpha', 'beta'],
  categories: ['shop', 'food'],
};

const ungrouped: LensPoints = { ...data, categories: [] };

describe('lensBinningFor', () => {
  it('counts compass sectors by default', () => {
    const binning = lensBinningFor(ungrouped, config());
    expect(binning.mode).toBe('angular');
    expect(binning.value).toBeUndefined();
    expect(binning.measure).toBeUndefined();
  });

  it('totals a field with a plain value getter', () => {
    const binning = lensBinningFor(ungrouped, config({ field: 'beta' }));
    expect(binning.value?.(data.points[0])).toBe(20);
    expect(binning.measure).toBeUndefined();
  });

  it('averages a field with an intensive measure', () => {
    const binning = lensBinningFor(ungrouped, config({ field: 'beta', statistic: 'mean' }));
    expect(binning.value).toBeUndefined();
    expect(binning.measure?.kind).toBe('intensive');
    expect(binning.measure?.value(data.points[1])).toBe(40);
  });

  it('bins by category once a grouping field has categories', () => {
    const binning = lensBinningFor(data, config({ groupField: 'kind' }));
    expect(binning.mode).toBe('categorical');
    expect(binning.categories).toEqual(['shop', 'food']);
    expect(binning.category?.(data.points[0])).toBe('shop');
  });

  // A grouping field the extraction found nothing for would otherwise produce a
  // categorical binning with no categories, which draws an empty ring.
  it('stays angular when the grouping field yielded no categories', () => {
    expect(lensBinningFor(ungrouped, config({ groupField: 'kind' })).mode).toBe('angular');
  });

  // The adapter's `update` merges nested options rather than replacing them, so
  // every key has to be present — omitting one leaves the previous value in
  // place and the lens can never go back.
  it('always carries every key, so a setting can be turned off again', () => {
    for (const binning of [lensBinningFor(ungrouped, config()), lensBinningFor(data, config({ groupField: 'kind', field: 'alpha' }))]) {
      for (const key of ['categories', 'category', 'value', 'measure']) {
        expect(binning).toHaveProperty(key);
      }
    }
  });

  it('falls back to counting for a field this layer does not have', () => {
    expect(lensBinningFor(ungrouped, config({ field: 'gamma' })).value).toBeUndefined();
  });
});

describe('lensPlacementFor', () => {
  it('is a plain necklace with no grouping to morph between', () => {
    expect(lensPlacementFor(ungrouped, config({ morph: 1 })).mode).toBe('necklace');
  });

  // Including at 0. A categorical bin's preferred position is already its mean
  // bearing, so falling back to `necklace` at zero puts the "grouped" end of
  // the slider at the same place as the "by bearing" end.
  it('morphs across the whole range once grouped', () => {
    expect(lensPlacementFor(data, config({ groupField: 'kind' }))).toEqual({ mode: 'morph', morph: 0 });
    expect(lensPlacementFor(data, config({ groupField: 'kind', morph: 0.5 }))).toEqual({
      mode: 'morph',
      morph: 0.5,
    });
  });
});

describe('activeLensLayer', () => {
  const layer = (id: string, visible: boolean) => ({ id, visible }) as MapLayer;

  it('prefers the selected layer, visible or not', () => {
    expect(activeLensLayer([layer('a', true), layer('b', false)], 'b')?.id).toBe('b');
  });

  it('falls back to the first visible layer', () => {
    expect(activeLensLayer([layer('a', false), layer('b', true)], null)?.id).toBe('b');
  });

  it('has nothing to read with no visible layers', () => {
    expect(activeLensLayer([layer('a', false)], null)).toBeUndefined();
  });
});
