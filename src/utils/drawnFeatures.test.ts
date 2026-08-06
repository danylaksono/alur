import { describe, expect, it } from 'vitest';
import {
  addFeature,
  addField,
  canCommitDrawing,
  coerceFieldValue,
  createDrawnFeature,
  describeDrawnLayer,
  emptyDrawnLayer,
  fieldNameError,
  previewCollection,
  removeField,
  setFeatureProperty,
  toGeoJson,
  updateField,
  type DrawnLayer,
} from './drawnFeatures';

const layerWith = (): DrawnLayer => {
  let layer = emptyDrawnLayer('Sites');
  layer = addField(layer, { name: 'label', type: 'text' });
  layer = addField(layer, { name: 'capacity', type: 'number' });
  layer = addFeature(layer, createDrawnFeature('point', [[-0.1, 51.5]], layer.fields, 'f1'));
  return layer;
};

describe('drawing rules', () => {
  it('needs enough vertices to be a shape', () => {
    expect(canCommitDrawing('point', [[0, 0]])).toBe(true);
    expect(canCommitDrawing('line', [[0, 0]])).toBe(false);
    expect(canCommitDrawing('line', [[0, 0], [1, 1]])).toBe(true);
    expect(canCommitDrawing('polygon', [[0, 0], [1, 1]])).toBe(false);
    expect(canCommitDrawing('polygon', [[0, 0], [1, 1], [2, 0]])).toBe(true);
  });

  it('gives a new feature a value for every declared column', () => {
    const layer = layerWith();
    expect(layer.features[0].properties).toEqual({ label: '', capacity: null });
  });

  it('drops the altitude a map click may carry', () => {
    const feature = createDrawnFeature('point', [[1, 2, 30] as never], [], 'f1');
    expect(feature.positions[0]).toEqual([1, 2]);
  });
});

describe('column editing', () => {
  it('rejects blank, duplicate and reserved names', () => {
    const { fields } = layerWith();
    expect(fieldNameError('  ', fields)).toMatch(/needs a name/);
    expect(fieldNameError('label', fields)).toMatch(/already a column/);
    expect(fieldNameError('Geometry', fields)).toMatch(/reserved/);
    expect(fieldNameError('label', fields, 'label')).toBeNull();
    expect(fieldNameError('phase', fields)).toBeNull();
  });

  it('backfills a column added after features were drawn', () => {
    const layer = addField(layerWith(), { name: 'phase', type: 'number' });
    expect(layer.features[0].properties.phase).toBeNull();
  });

  it('carries values across a rename instead of discarding them', () => {
    let layer = setFeatureProperty(layerWith(), 'f1', 'label', 'Hub A');
    layer = updateField(layer, 'label', { name: 'site_name' });
    expect(layer.features[0].properties.site_name).toBe('Hub A');
    expect(layer.features[0].properties.label).toBeUndefined();
  });

  it('coerces existing values when a column is retyped', () => {
    let layer = setFeatureProperty(layerWith(), 'f1', 'label', '42');
    layer = updateField(layer, 'label', { type: 'number' });
    expect(layer.features[0].properties.label).toBe(42);
  });

  it('removes a column from the features as well as the schema', () => {
    const layer = removeField(layerWith(), 'capacity');
    expect(layer.fields.map((field) => field.name)).toEqual(['label']);
    expect(layer.features[0].properties).toEqual({ label: '' });
  });

  it('treats an unparseable number as missing rather than NaN', () => {
    expect(coerceFieldValue('abc', 'number')).toBeNull();
    expect(coerceFieldValue('', 'number')).toBeNull();
    expect(coerceFieldValue('7.5', 'number')).toBe(7.5);
    expect(coerceFieldValue('true', 'boolean')).toBe(true);
    expect(coerceFieldValue(null, 'text')).toBe('');
  });
});

describe('GeoJSON export', () => {
  it('writes each kind as its GeoJSON counterpart', () => {
    let layer = emptyDrawnLayer();
    layer = addFeature(layer, createDrawnFeature('point', [[0, 0]], [], 'p'));
    layer = addFeature(layer, createDrawnFeature('line', [[0, 0], [1, 1]], [], 'l'));
    layer = addFeature(layer, createDrawnFeature('polygon', [[0, 0], [1, 0], [1, 1]], [], 'a'));
    expect(toGeoJson(layer).features.map((feature) => feature.geometry.type)).toEqual(['Point', 'LineString', 'Polygon']);
  });

  it('closes the polygon ring, which the model keeps open for editing', () => {
    let layer = emptyDrawnLayer();
    layer = addFeature(layer, createDrawnFeature('polygon', [[0, 0], [1, 0], [1, 1]], [], 'a'));
    const ring = (toGeoJson(layer).features[0].geometry as GeoJSON.Polygon).coordinates[0];
    expect(ring).toHaveLength(4);
    expect(ring[0]).toEqual(ring[3]);
  });

  it('does not double-close a ring that already closes', () => {
    let layer = emptyDrawnLayer();
    layer = addFeature(layer, createDrawnFeature('polygon', [[0, 0], [1, 0], [1, 1], [0, 0]], [], 'a'));
    expect((toGeoJson(layer).features[0].geometry as GeoJSON.Polygon).coordinates[0]).toHaveLength(4);
  });

  it('emits every declared column on every feature, so the table is not ragged', () => {
    let layer = layerWith();
    layer = addFeature(layer, { id: 'f2', kind: 'point', positions: [[1, 1]], properties: {} });
    expect(toGeoJson(layer).features.map((feature) => feature.properties)).toEqual([
      { label: '', capacity: null },
      { label: '', capacity: null },
    ]);
  });
});

describe('drawing preview', () => {
  it('shows a single vertex as a point so the first click is visible', () => {
    const preview = previewCollection(emptyDrawnLayer(), { kind: 'polygon', positions: [[0, 0]] });
    expect(preview.features[0].geometry.type).toBe('Point');
  });

  it('shows an unfinished polygon as a line until it has three vertices', () => {
    const two = previewCollection(emptyDrawnLayer(), { kind: 'polygon', positions: [[0, 0], [1, 1]] });
    expect(two.features[0].geometry.type).toBe('LineString');
    const three = previewCollection(emptyDrawnLayer(), { kind: 'polygon', positions: [[0, 0], [1, 1], [2, 0]] });
    expect(three.features[0].geometry.type).toBe('Polygon');
  });

  it('keeps committed features alongside the one being drawn', () => {
    const preview = previewCollection(layerWith(), { kind: 'line', positions: [[5, 5], [6, 6]] });
    expect(preview.features).toHaveLength(2);
    expect(preview.features[1].properties?.__alur_drawing).toBe(true);
  });

  it('returns only committed features when nothing is being drawn', () => {
    expect(previewCollection(layerWith()).features).toHaveLength(1);
  });
});

describe('summary', () => {
  it('counts by kind', () => {
    let layer = emptyDrawnLayer();
    layer = addFeature(layer, createDrawnFeature('point', [[0, 0]], [], 'p1'));
    layer = addFeature(layer, createDrawnFeature('point', [[1, 1]], [], 'p2'));
    layer = addFeature(layer, createDrawnFeature('polygon', [[0, 0], [1, 0], [1, 1]], [], 'a'));
    expect(describeDrawnLayer(layer)).toEqual({ total: 3, point: 2, line: 0, polygon: 1 });
  });
});
