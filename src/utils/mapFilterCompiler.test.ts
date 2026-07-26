import { describe, expect, it } from 'vitest';
import { compileMapFilter } from './mapFilterCompiler';

describe('compileMapFilter', () => {
  it('combines typed filters into one MapLibre expression', () => {
    expect(compileMapFilter([
      { kind: 'range', field: 'score', min: 10, max: 20 },
      { kind: 'boolean', field: 'active', value: true },
    ])).toEqual([
      'all',
      ['all', ['>=', ['to-number', ['get', 'score']], 10], ['<=', ['to-number', ['get', 'score']], 20]],
      ['all', ['has', 'active'], ['==', ['to-boolean', ['get', 'active']], true]],
    ]);
  });

  it('supports case-insensitive text filters and exclusion', () => {
    expect(compileMapFilter([
      { kind: 'text', field: 'name', operator: 'contains', value: 'KING', mode: 'exclude' },
    ])).toEqual([
      '!',
      ['all', ['has', 'name'], ['>=', ['index-of', 'king', ['downcase', ['to-string', ['get', 'name']]]], 0]],
    ]);
  });

  it('represents missing and explicit null values consistently', () => {
    expect(compileMapFilter([
      { kind: 'null', field: 'score', isNull: true },
    ])).toEqual(['any', ['!', ['has', 'score']], ['==', ['get', 'score'], null]]);
  });

  it('returns null when no effective filter exists', () => {
    expect(compileMapFilter([])).toBeNull();
    expect(compileMapFilter([{ kind: 'range', field: 'score' }])).toBeNull();
  });
});
