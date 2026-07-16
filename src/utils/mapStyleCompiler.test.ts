import { describe, expect, it } from 'vitest';
import type { MapLayer } from '../store/useStore';
import { compileBivariateColorExpression, compileCategoricalColorExpression, compileChoroplethColorExpression, compileLayerStyle } from './mapStyleCompiler';

const layer = (geometryType: GeoJSON.Geometry['type'], patch: Partial<MapLayer> = {}): MapLayer => ({
  id: 'layer-a',
  name: 'Layer A',
  geojson: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: geometryType === 'Point'
          ? { type: 'Point', coordinates: [0, 0] }
          : geometryType === 'LineString'
            ? { type: 'LineString', coordinates: [[0, 0], [1, 1]] }
            : { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
        properties: { need: 10, borough: 'Camden' },
      },
    ],
  },
  source: {
    kind: 'legacy-geojson',
    geometryKind: geometryType === 'LineString' ? 'line' : geometryType === 'Polygon' ? 'polygon' : 'point',
    fields: [{ name: 'need', type: 'DOUBLE' }, { name: 'borough', type: 'VARCHAR' }],
  },
  visible: true,
  opacity: 0.8,
  createdAt: 1,
  featureCount: 1,
  styleVersion: 1,
  ...patch,
});

describe('map style compiler', () => {
  it('compiles simple styles for geometry-specific MapLibre layer types', () => {
    expect(compileLayerStyle(layer('Point')).type).toBe('circle');
    expect(compileLayerStyle(layer('LineString')).type).toBe('line');
    expect(compileLayerStyle(layer('Polygon')).type).toBe('fill');
  });

  it('builds step expressions for choropleths', () => {
    const expression = compileChoroplethColorExpression({
      kind: 'choropleth',
      field: 'need',
      method: 'quantile',
      classCount: 3,
      breaks: [10, 20],
      palette: ['#fee2e2', '#ef4444', '#7f1d1d'],
      nullColor: '#e2e8f0',
      opacity: 0.7,
      outlineColor: '#334155',
      outlineWidth: 1,
    });

    expect(expression).toContain('#e2e8f0');
    expect(JSON.stringify(expression)).toContain('"step"');
    expect(JSON.stringify(expression)).toContain('"need"');
  });

  it('builds match expressions for categorical styles', () => {
    const expression = compileCategoricalColorExpression({
      kind: 'categorical',
      field: 'borough',
      method: 'categorical_top_n',
      categories: [{ value: 'Camden', color: '#2563eb' }],
      otherColor: '#94a3b8',
      nullColor: '#e2e8f0',
      opacity: 0.8,
    });

    expect(JSON.stringify(expression)).toContain('"match"');
    expect(JSON.stringify(expression)).toContain('"Camden"');
  });

  it('applies choropleth expressions to polygon fill paint', () => {
    const compiled = compileLayerStyle(layer('Polygon', {
      visualisation: {
        kind: 'choropleth',
        field: 'need',
        method: 'quantile',
        classCount: 3,
        breaks: [10, 20],
        palette: ['#fee2e2', '#ef4444', '#7f1d1d'],
        nullColor: '#e2e8f0',
        opacity: 0.7,
        outlineColor: '#334155',
        outlineWidth: 1,
      },
    }));

    expect(compiled.type).toBe('fill');
    expect(JSON.stringify(compiled.paint['fill-color'])).toContain('"step"');
  });

  it('compiles polygon extrusion with data-driven height and classed color', () => {
    const compiled = compileLayerStyle(layer('Polygon', {
      visualisation: {
        kind: 'extrusion',
        field: 'need',
        method: 'quantile',
        classCount: 3,
        breaks: [10, 20],
        palette: ['#fee2e2', '#ef4444', '#7f1d1d'],
        nullColor: '#e2e8f0',
        heightMultiplier: 5,
        opacity: 0.85,
      },
    }));

    expect(compiled.type).toBe('fill-extrusion');
    expect(JSON.stringify(compiled.paint['fill-extrusion-height'])).toContain('"need"');
    expect(JSON.stringify(compiled.paint['fill-extrusion-height'])).toContain('5');
    expect(JSON.stringify(compiled.paint['fill-extrusion-color'])).toContain('"step"');
  });

  it('compiles graduated line width as an interpolate expression on line layers', () => {
    const compiled = compileLayerStyle(layer('LineString', {
      visualisation: {
        kind: 'graduated_line',
        field: 'need',
        minValue: 0,
        maxValue: 100,
        minWidth: 1,
        maxWidth: 8,
        color: '#2563eb',
        opacity: 0.85,
      },
    }));

    expect(compiled.type).toBe('line');
    const width = JSON.stringify(compiled.paint['line-width']);
    expect(width).toContain('"interpolate"');
    expect(width).toContain('"need"');
  });

  it('compiles bivariate color as nested steps over both fields', () => {
    const expression = compileBivariateColorExpression({
      kind: 'bivariate',
      fieldX: 'need',
      fieldY: 'income',
      breaksX: [10, 20],
      breaksY: [1, 2],
      palette: ['#e8e8e8', '#ace4e4', '#5ac8c8', '#dfb0d6', '#a5add3', '#5698b9', '#be64ac', '#8c62aa', '#3b4994'],
      nullColor: '#e2e8f0',
      opacity: 0.78,
      outlineColor: '#334155',
      outlineWidth: 0.5,
    });

    const json = JSON.stringify(expression);
    expect(json).toContain('"need"');
    expect(json).toContain('"income"');
    // corner colors of the 3x3 matrix must both be reachable
    expect(json).toContain('#e8e8e8');
    expect(json).toContain('#3b4994');
    expect(json).toContain('#e2e8f0');
  });
});
