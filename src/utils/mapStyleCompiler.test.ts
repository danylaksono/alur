import { describe, expect, it } from 'vitest';
import type { MapLayer } from '../store/useStore';
import { compileCategoricalColorExpression, compileChoroplethColorExpression, compileLayerStyle } from './mapStyleCompiler';

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
});
