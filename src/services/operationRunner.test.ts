import { describe, expect, it } from 'vitest';
import type { OperationInputBinding, OperationManifest, OperationOutputSpec } from '../types/operations';
import { referenceProvider } from '../providers/reference/referenceProvider';
import { canonicalRoleProperty, joinColumnFor, mergeJoinOutput, projectFeature, resolveRowTargets } from './operationRunner';

const manifest: OperationManifest = referenceProvider.manifest;

const bindings: OperationInputBinding[] = [
  { inputId: 'units', sources: [{ datasetId: 'dataset-1', fields: { key: 'code' } }] },
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
  // The canonical property rather than the analyst's column, because the
  // collection a join merges onto is the projected one. With several datasets
  // bound to an input there is no single original column name to use, and
  // picking one of them would join the others onto nothing.
  it('uses the canonical property for the declared role', () => {
    const declared: OperationOutputSpec = { ...joinOutput, joinFieldRole: 'key' };
    expect(joinColumnFor(manifest, declared, bindings)).toBe(canonicalRoleProperty('key'));
  });

  it('falls back to the first required identifier role', () => {
    expect(joinColumnFor(manifest, joinOutput, bindings)).toBe(canonicalRoleProperty('key'));
  });

  it('refuses when the role is not bound, rather than joining on nothing', () => {
    const unbound: OperationInputBinding[] = [{ inputId: 'units', sources: [{ datasetId: 'dataset-1', fields: {} }] }];
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

/**
 * Several datasets feeding one input.
 *
 * This is what makes "draw some more candidates and run it again" a binding
 * change rather than a pipeline change: role binding already lets two datasets
 * name the same roles under different columns, so unioning them needs no schema
 * surgery — only a projection onto agreed property names.
 */
describe('projecting a source onto canonical role properties', () => {
  const feature = (properties: Record<string, unknown>): GeoJSON.Feature => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties,
  });

  it('copies the bound column onto the role property', () => {
    const projected = projectFeature(feature({ code: 'A1', pop: 10 }), { key: 'code' }, 'Loaded');
    expect(projected.properties?.[canonicalRoleProperty('key')]).toBe('A1');
  });

  it('keeps the original properties, so an unbound column is still readable', () => {
    const projected = projectFeature(feature({ code: 'A1', pop: 10 }), { key: 'code' }, 'Loaded');
    expect(projected.properties?.code).toBe('A1');
    expect(projected.properties?.pop).toBe(10);
  });

  it('names the dataset each feature came from', () => {
    const projected = projectFeature(feature({ code: 'A1' }), { key: 'code' }, 'Drawn parks');
    expect(projected.properties?.__alur_source).toBe('Drawn parks');
  });

  it('gives two datasets with different column names the same role property', () => {
    // The property the union rests on. A drawn three-column layer and a loaded
    // sixty-column table have nothing in common but the roles.
    const loaded = projectFeature(feature({ lsoa_code: 'E01', imd: 3 }), { key: 'lsoa_code' }, 'LSOAs');
    const drawn = projectFeature(feature({ name: 'Park 1' }), { key: 'name' }, 'Drawn parks');
    expect(loaded.properties?.[canonicalRoleProperty('key')]).toBe('E01');
    expect(drawn.properties?.[canonicalRoleProperty('key')]).toBe('Park 1');
  });

  it('records a missing column as null rather than dropping the role', () => {
    const projected = projectFeature(feature({ other: 1 }), { key: 'absent' }, 'Loaded');
    expect(projected.properties?.[canonicalRoleProperty('key')]).toBeNull();
  });
});

/**
 * Translating row targets into the values a provider keys on.
 *
 * The gap this closes: a selection arrives as the dataset's own row-id column,
 * which is rarely the column bound to the role a provider matches against. The
 * shell holds both the collection and the descriptor, so it can translate
 * without guessing — which is what stops every adapter from having to.
 */
describe('resolving row targets', () => {
  const rowsManifest: OperationManifest = {
    ...manifest,
    accepts: [{ id: 'adjust', label: 'Adjust', inputId: 'units', referent: 'rows', targetFieldRole: 'key', parameters: [] }],
  };

  const projected = (rows: Array<{ ogc_fid: string; code: string }>, source: string): GeoJSON.FeatureCollection => ({
    type: 'FeatureCollection',
    features: rows.map((row) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { ...row, [canonicalRoleProperty('key')]: row.code, __alur_source: source },
    })),
  });

  // Only the three fields the translation reads; the rest of a descriptor is
  // irrelevant here and inventing it would obscure what the test depends on.
  const descriptor = (id: string, name: string) =>
    ({ id, name, rowIdColumn: 'ogc_fid' }) as never;

  const change = (rowIds: string[], datasetId = 'dataset-1') => ({
    id: 'op-1',
    changeId: 'adjust',
    sequence: 0,
    target: { kind: 'rows' as const, datasetId, rowIds },
    values: {},
  });

  it('rewrites row ids into the values of the targeted role', () => {
    const collections = { units: projected([{ ogc_fid: '7', code: 'E01' }], 'LSOAs') };
    const datasets = { 'dataset-1': descriptor('dataset-1', 'LSOAs') };
    const { changes } = resolveRowTargets(rowsManifest, [change(['7'])], collections, datasets);
    expect((changes[0].target as { rowIds: string[] }).rowIds).toEqual(['E01']);
  });

  it('drops ids that match nothing and says so', () => {
    // Passing them through would leave the provider matching against a column
    // it was never told about — the failure this whole translation replaces.
    const collections = { units: projected([{ ogc_fid: '7', code: 'E01' }], 'LSOAs') };
    const datasets = { 'dataset-1': descriptor('dataset-1', 'LSOAs') };
    const { changes, warnings } = resolveRowTargets(rowsManifest, [change(['7', '99'])], collections, datasets);
    expect((changes[0].target as { rowIds: string[] }).rowIds).toEqual(['E01']);
    expect(warnings[0]).toContain('1 of 2 selected rows');
  });

  it('reads row ids from the dataset the change names, not from every bound one', () => {
    // Two datasets can legitimately use the same row-id values, so an unscoped
    // lookup would resolve a selection against the wrong one.
    const collections = {
      units: {
        type: 'FeatureCollection' as const,
        features: [
          ...projected([{ ogc_fid: '1', code: 'E01' }], 'LSOAs').features,
          ...projected([{ ogc_fid: '1', code: 'Park A' }], 'Drawn parks').features,
        ],
      },
    };
    const datasets = {
      'dataset-1': descriptor('dataset-1', 'LSOAs'),
      'dataset-2': descriptor('dataset-2', 'Drawn parks'),
    };
    const { changes } = resolveRowTargets(rowsManifest, [change(['1'], 'dataset-2')], collections, datasets);
    expect((changes[0].target as { rowIds: string[] }).rowIds).toEqual(['Park A']);
  });

  it('leaves a geometry target alone', () => {
    const placement = {
      id: 'op-2', changeId: 'place', sequence: 1,
      target: { kind: 'geometry' as const, geometry: { type: 'Point' as const, coordinates: [0, 0] } },
      values: {},
    };
    const { changes } = resolveRowTargets(rowsManifest, [placement], {}, {});
    expect(changes[0]).toBe(placement);
  });
});
