import { describe, expect, it } from 'vitest';
import type { OperationInputBinding, OperationManifest, OperationOutputSpec } from '../types/operations';
import { referenceProvider } from '../providers/reference/referenceProvider';
import { joinColumnFor, mergeJoinOutput } from './operationRunner';

const manifest: OperationManifest = referenceProvider.manifest;

const bindings: OperationInputBinding[] = [
  { inputId: 'units', datasetId: 'dataset-1', fields: { key: 'code' } },
];

const joinOutput = manifest.outputs.find((output) => output.id === 'values')!;

const collection = (keys: string[]): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: keys.map((code) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: { code, name: `unit ${code}` },
  })),
});

describe('resolving the join column', () => {
  it('uses the bound column for the declared role', () => {
    const declared: OperationOutputSpec = { ...joinOutput, joinFieldRole: 'key' };
    expect(joinColumnFor(manifest, declared, bindings)).toBe('code');
  });

  it('falls back to the first required identifier role', () => {
    expect(joinColumnFor(manifest, joinOutput, bindings)).toBe('code');
  });

  it('refuses when the role is not bound, rather than joining on nothing', () => {
    const unbound: OperationInputBinding[] = [{ inputId: 'units', datasetId: 'dataset-1', fields: {} }];
    expect(() => joinColumnFor(manifest, joinOutput, unbound)).toThrow(/needs Identifier bound/);
  });

  it('refuses when the input declares no identifier at all', () => {
    const anonymous: OperationManifest = {
      ...manifest,
      inputs: [{ ...manifest.inputs[0], fields: [] }],
    };
    expect(() => joinColumnFor(anonymous, joinOutput, bindings)).toThrow(/declares no identifier/);
  });
});

describe('merging per-unit values onto geometry', () => {
  it('attaches values to the features they key to', () => {
    const merged = mergeJoinOutput(
      collection(['a', 'b']),
      [{ key: 'a', reference_value: 3 }, { key: 'b', reference_value: 7 }],
      'code',
      joinOutput.fields,
    );

    expect(merged.matched).toBe(2);
    expect(merged.collection.features.map((feature) => feature.properties?.reference_value)).toEqual([3, 7]);
  });

  it('keeps existing properties alongside the new ones', () => {
    const merged = mergeJoinOutput(collection(['a']), [{ key: 'a', reference_value: 1 }], 'code', joinOutput.fields);
    expect(merged.collection.features[0].properties).toEqual({ code: 'a', name: 'unit a', reference_value: 1 });
  });

  it('writes null, never zero, where the provider returned no row', () => {
    // A missing value is a real answer — an unreachable place is not a place
    // with a travel time of zero — so this is the assertion that matters most.
    const merged = mergeJoinOutput(collection(['a', 'b']), [{ key: 'a', reference_value: 5 }], 'code', joinOutput.fields);
    expect(merged.matched).toBe(1);
    expect(merged.collection.features[1].properties?.reference_value).toBeNull();
  });

  it('preserves a null the provider returned deliberately', () => {
    const merged = mergeJoinOutput(collection(['a']), [{ key: 'a', reference_value: null }], 'code', joinOutput.fields);
    expect(merged.matched).toBe(1);
    expect(merged.collection.features[0].properties?.reference_value).toBeNull();
  });

  it('matches nothing when the wrong column is joined on, and says so by count', () => {
    const merged = mergeJoinOutput(collection(['a']), [{ key: 'a', reference_value: 1 }], 'name', joinOutput.fields);
    expect(merged.matched).toBe(0);
  });

  it('coerces keys to strings so numeric ids still match', () => {
    const numeric: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { code: 42 } }],
    };
    const merged = mergeJoinOutput(numeric, [{ key: '42', reference_value: 9 }], 'code', joinOutput.fields);
    expect(merged.matched).toBe(1);
    expect(merged.collection.features[0].properties?.reference_value).toBe(9);
  });

  it('does not mutate the collection it was given', () => {
    const source = collection(['a']);
    mergeJoinOutput(source, [{ key: 'a', reference_value: 1 }], 'code', joinOutput.fields);
    expect(source.features[0].properties).toEqual({ code: 'a', name: 'unit a' });
  });
});
