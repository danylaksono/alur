import { describe, expect, it } from 'vitest';
import { requiredMapTileProperties } from './mapTileProperties';

describe('requiredMapTileProperties', () => {
  it('keeps an unstyled and unfiltered layer property-free', () => {
    expect(requiredMapTileProperties(['name', 'height'], undefined, [])).toEqual([]);
  });

  it('includes only available style and filter fields without duplicates', () => {
    expect(requiredMapTileProperties(
      ['height', 'category', 'unused'],
      {
        kind: 'choropleth',
        field: 'height',
        method: 'equal_interval',
        classCount: 3,
        breaks: [0, 10, 20, 30],
        palette: ['#111', '#222', '#333'],
        nullColor: '#ccc',
        opacity: 0.8,
        outlineColor: '#fff',
        outlineWidth: 1,
      },
      [{ kind: 'range', field: 'height', min: 5 }, { kind: 'category', field: 'category', values: ['A'] }],
    )).toEqual(['category', 'height']);
  });

  it('includes both bivariate fields and ignores unavailable fields', () => {
    expect(requiredMapTileProperties(
      ['x', 'y'],
      {
        kind: 'bivariate',
        fieldX: 'x',
        fieldY: 'missing',
        breaksX: [1, 2],
        breaksY: [3, 4],
        palette: Array(9).fill('#000'),
        nullColor: '#ccc',
        opacity: 0.8,
        outlineColor: '#fff',
        outlineWidth: 1,
      },
      [],
    )).toEqual(['x']);
  });
});
