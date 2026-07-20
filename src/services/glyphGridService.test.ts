import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MapLayer } from '../store/useStore';
import type { GlyphGridVisualisation } from '../types/visualisation';
import { duckdbService } from './duckdb';
import { glyphPointDataKey, queryLayerGlyphPoints } from './glyphGridService';

const source = {
  kind: 'duckdb-table' as const,
  tableName: 'points',
  geometryColumn: 'geometry',
  crs: 'EPSG:4326',
  geometryKind: 'point' as const,
  featureIdColumn: '__ymn_mvt_id',
  fields: [{ name: 'value', type: 'DOUBLE' }],
  tileSource: {
    tableName: '__ymn_mvt_points',
    layerName: 'features',
    geometryKind: 'point' as const,
    propertyColumns: ['value'],
  },
  renderVersion: 1,
};

const layer: MapLayer = {
  id: 'points',
  name: 'Points',
  source,
  visible: true,
  opacity: 1,
  createdAt: 1,
  featureCount: 100_000,
  styleVersion: 1,
};

const visualisation: GlyphGridVisualisation = {
  kind: 'glyph_grid',
  mode: 'grid',
  cellSize: 48,
  glyph: 'density',
  fields: [],
  aggregate: 'count',
  palette: ['#0f766e'],
  opacity: 0.85,
};

describe('glyph grid DuckDB preparation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the point-data key stable across presentation-only changes', () => {
    const key = glyphPointDataKey({ layer, filters: [], vis: visualisation });
    const presentationOnlyChange: GlyphGridVisualisation = {
      ...visualisation,
      mode: 'hex',
      cellSize: 96,
      glyph: 'circle',
      palette: ['#ef4444'],
      opacity: 0.4,
    };

    expect(glyphPointDataKey({ layer, filters: [], vis: presentationOnlyChange })).toBe(key);
    expect(glyphPointDataKey({
      layer,
      filters: [],
      vis: { ...visualisation, fields: ['value'], aggregate: 'sum' },
    })).not.toBe(key);
    expect(glyphPointDataKey({
      layer,
      filters: [{ kind: 'range', field: 'value', min: 10 }],
      vis: visualisation,
    })).not.toBe(key);
    expect(glyphPointDataKey({
      layer: { ...layer, source: { ...source, renderVersion: 2 } },
      filters: [],
      vis: visualisation,
    })).not.toBe(key);
  });

  it('filters large DuckDB layers before applying the reservoir sample', async () => {
    const query = vi.spyOn(duckdbService, 'query')
      .mockResolvedValueOnce({ toArray: () => [{ n: 100_000 }] } as any)
      .mockResolvedValueOnce({
        toArray: () => [{ lon: -0.1, lat: 51.5, id: 'feature-1', weight: 1 }],
      } as any);

    const points = await queryLayerGlyphPoints({
      layer,
      filters: [{ kind: 'range', field: 'value', min: 10 }],
      vis: visualisation,
    });

    const sql = String(query.mock.calls[1][0]);
    const whereIndex = sql.indexOf('WHERE');
    const sampleIndex = sql.indexOf('USING SAMPLE reservoir(60000 ROWS) REPEATABLE (11)');

    expect(whereIndex).toBeGreaterThan(-1);
    expect(sampleIndex).toBeGreaterThan(whereIndex);
    expect(sql.slice(sampleIndex)).not.toContain('WHERE');
    expect(sql).toContain('(SELECT * FROM "__ymn_mvt_points"');
    expect(sql).toContain('CAST("value" AS DOUBLE) >= 10');
    expect(points).toEqual([{
      position: [-0.1, 51.5],
      id: 'feature-1',
      weight: 1,
      values: [],
    }]);
  });
});
