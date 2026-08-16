import { describe, expect, it } from 'vitest';
import {
  bboxColumn,
  bboxIsPushedDown,
  detectRemoteFormat,
  geometryColumn,
  guardFailure,
  isGlobUrl,
  normaliseRemoteUrl,
  remoteNameFromUrl,
  remoteTableSql,
  REMOTE_CATALOG,
  REMOTE_UNGUARDED_MAX_BYTES,
  spatialPredicate,
  type RemoteField,
} from './remoteSource';

const bbox = { minX: -1.5, minY: 52, maxX: -1, maxY: 52.5 };

const geoparquetFields: RemoteField[] = [
  { name: 'id', type: 'VARCHAR' },
  { name: 'names', type: 'STRUCT(primary VARCHAR)' },
  { name: 'bbox', type: 'STRUCT(xmin FLOAT, xmax FLOAT, ymin FLOAT, ymax FLOAT)' },
  { name: 'geometry', type: 'BLOB' },
];

const plainFields: RemoteField[] = [
  { name: 'id', type: 'VARCHAR' },
  { name: 'geometry', type: 'BLOB' },
];

describe('remote URL validation', () => {
  it('rejects what a browser cannot range-read, with a reason', () => {
    expect(() => normaliseRemoteUrl('')).toThrow(/Enter the URL/);
    expect(() => normaliseRemoteUrl('data/local.parquet')).toThrow(/full URL/);
    expect(() => normaliseRemoteUrl('s3://bucket/a.parquet')).toThrow(/HTTPS URL instead/);
    expect(() => normaliseRemoteUrl('ftp://host/a.parquet')).toThrow(/HTTP and HTTPS/);
  });

  it('detects globs, which have no listing API over plain HTTPS', () => {
    expect(isGlobUrl('https://host/theme=*/part.parquet')).toBe(true);
    expect(isGlobUrl('https://host/a.parquet?v=1')).toBe(false);
  });

  it('accepts only Parquet, including the compressed suffix Overture uses', () => {
    expect(detectRemoteFormat(new URL('https://h/a.parquet'))).toBe('parquet');
    expect(detectRemoteFormat(new URL('https://h/a-c000.zstd.parquet'))).toBe('parquet');
    expect(detectRemoteFormat(new URL('https://h/a.geojson'))).toBeNull();
    expect(remoteNameFromUrl(new URL('https://h/x/Ondo%20State.parquet'))).toBe('Ondo State.parquet');
  });
});

describe('column detection', () => {
  it('finds the GeoParquet bbox struct regardless of field order or float width', () => {
    expect(bboxColumn(geoparquetFields)).toBe('bbox');
    expect(bboxIsPushedDown(geoparquetFields)).toBe(true);
    expect(bboxColumn(plainFields)).toBeNull();
    expect(bboxIsPushedDown(plainFields)).toBe(false);
  });

  it('does not mistake an unrelated struct for bounds', () => {
    expect(bboxColumn([{ name: 'names', type: 'STRUCT(primary VARCHAR, common MAP(VARCHAR, VARCHAR))' }])).toBeNull();
  });

  it('prefers a typed geometry column over a WKB blob', () => {
    expect(geometryColumn([{ name: 'geom', type: 'GEOMETRY' }])).toBe('geom');
    expect(geometryColumn(plainFields)).toBe('geometry');
    expect(geometryColumn([{ name: 'population', type: 'BIGINT' }])).toBeNull();
  });
});

describe('spatial predicate', () => {
  it('uses the bbox struct so Parquet can skip row groups', () => {
    expect(spatialPredicate(bbox, geoparquetFields))
      .toBe('"bbox".xmin <= -1 AND "bbox".xmax >= -1.5 AND "bbox".ymin <= 52.5 AND "bbox".ymax >= 52');
  });

  it('falls back to decoding geometry when there is no bbox column', () => {
    expect(spatialPredicate(bbox, plainFields))
      .toBe('ST_Intersects(ST_GeomFromWKB("geometry"), ST_MakeEnvelope(-1.5, 52, -1, 52.5))');
  });

  it('reports no predicate when the file is not spatial at all', () => {
    expect(spatialPredicate(bbox, [{ name: 'population', type: 'BIGINT' }])).toBeNull();
  });

  it('refuses a non-finite bound rather than emitting it into SQL', () => {
    expect(() => spatialPredicate({ ...bbox, minX: Number.NaN }, geoparquetFields)).toThrow(/finite number/);
  });
});

describe('remote table SQL', () => {
  it('materialises a table rather than a view, so downstream nodes stay local', () => {
    const sql = remoteTableSql('places', { path: 'https://h/a.parquet', fields: geoparquetFields, bbox });
    expect(sql).toMatch(/^CREATE OR REPLACE TABLE "places" AS SELECT \* FROM read_parquet\('https:\/\/h\/a\.parquet'\) WHERE /);
  });

  it('prunes columns but never drops geometry', () => {
    const sql = remoteTableSql('places', { path: 'p', fields: geoparquetFields, columns: ['id'] });
    expect(sql).toContain('SELECT "id", "geometry"');
  });

  it('ignores columns the file does not have, and refuses an empty selection', () => {
    expect(remoteTableSql('t', { path: 'p', fields: geoparquetFields, columns: ['id', 'nope'] })).toContain('SELECT "id", "geometry"');
    expect(() => remoteTableSql('t', { path: 'p', fields: geoparquetFields, columns: ['nope'] })).toThrow(/at least one column/);
  });

  it('applies a row limit and validates it', () => {
    expect(remoteTableSql('t', { path: 'p', fields: plainFields, limit: 500 })).toMatch(/LIMIT 500;$/);
    expect(() => remoteTableSql('t', { path: 'p', fields: plainFields, limit: 2.5 })).toThrow(/whole number/);
    expect(() => remoteTableSql('t', { path: 'p', fields: plainFields, limit: -1 })).toThrow(/whole number/);
  });

  it('escapes quotes in identifiers and paths instead of trusting them', () => {
    const sql = remoteTableSql('odd"name', { path: "a'b.parquet", fields: plainFields });
    expect(sql).toContain('"odd""name"');
    expect(sql).toContain("read_parquet('a''b.parquet')");
  });

  it('says why an area filter is impossible rather than silently reading everything', () => {
    expect(() => remoteTableSql('t', { path: 'p', fields: [{ name: 'population', type: 'BIGINT' }], bbox }))
      .toThrow(/cannot be filtered by area/);
  });
});

describe('guard rails', () => {
  it('lets a small file through unbounded', () => {
    expect(guardFailure({ byteSize: 2_744_156 })).toBeNull();
  });

  it('refuses a large file with neither an area nor a limit', () => {
    expect(guardFailure({ byteSize: 576_185_044 })).toMatch(/549 MB/);
  });

  it('accepts a large file once either guard is set', () => {
    expect(guardFailure({ byteSize: 576_185_044, bbox })).toBeNull();
    expect(guardFailure({ byteSize: 576_185_044, limit: 1000 })).toBeNull();
  });

  it('treats an unreported size as large, not as small', () => {
    expect(guardFailure({ byteSize: null })).toMatch(/did not report a file size/);
    expect(guardFailure({ byteSize: REMOTE_UNGUARDED_MAX_BYTES })).toBeNull();
    expect(guardFailure({ byteSize: REMOTE_UNGUARDED_MAX_BYTES + 1 })).not.toBeNull();
  });
});

describe('catalog', () => {
  it('offers only single files, because a glob cannot be expanded from a browser', () => {
    for (const entry of REMOTE_CATALOG) {
      expect(isGlobUrl(entry.url)).toBe(false);
      expect(detectRemoteFormat(normaliseRemoteUrl(entry.url))).toBe('parquet');
      expect(entry.byteSize).toBeGreaterThan(0);
    }
    expect(new Set(REMOTE_CATALOG.map((entry) => entry.id)).size).toBe(REMOTE_CATALOG.length);
  });
});
