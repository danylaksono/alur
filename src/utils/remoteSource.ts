/**
 * Pure helpers for reading a remote Parquet file in place, over HTTP range
 * requests, instead of downloading it first.
 *
 * The distinction matters for every decision in here. `ingestUrl` in
 * `dataIngestion.ts` fetches a whole file into memory and is capped at 50 MB;
 * the datasets this path exists for — Overture divisions at 576 MB, a country
 * of Google Open Buildings at 87 MB — are far past that and are meant to be
 * read a row group at a time. So the job of this module is to build a scan
 * that fetches as little as possible: prune columns, and push a bounding box
 * down to something the Parquet reader can use for row-group skipping.
 */

export type RemoteBbox = { minX: number; minY: number; maxX: number; maxY: number };
export type RemoteField = { name: string; type: string };

/**
 * Below this, a remote read is no worse than the existing whole-file URL
 * import, so it runs without a bounding box or a row limit. Above it, one of
 * the two is required — otherwise a single click materialises half a gigabyte
 * into a browser tab.
 */
export const REMOTE_UNGUARDED_MAX_BYTES = 100 * 1024 * 1024;

const qi = (name: string) => `"${name.replace(/"/g, '""')}"`;
const escapeSqlString = (value: string) => value.replace(/'/g, "''");

const sqlNumber = (value: number, label: string) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
  return String(value);
};

const sqlInteger = (value: number, label: string) => {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a whole number above zero.`);
  return String(value);
};

/** Accepts only what DuckDB can range-read over the public web. */
export const normaliseRemoteUrl = (input: string): URL => {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Enter the URL of a Parquet file.');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('Enter a full URL, including https://.');
  }
  if (url.protocol === 's3:') {
    throw new Error('S3 URIs cannot be read from a browser. Use the bucket\'s HTTPS URL instead.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Only HTTP and HTTPS URLs can be read remotely.');
  }
  return url;
};

/** A `*` or `**` in the path: no listing API over plain HTTPS, so it cannot be resolved. */
export const isGlobUrl = (input: string) => /[*?]/.test(input.split(/[?#]/)[0]);

export const remoteNameFromUrl = (url: URL) =>
  decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) || 'remote-data.parquet');

export const detectRemoteFormat = (url: URL): 'parquet' | null => {
  const path = url.pathname.toLowerCase();
  return path.endsWith('.parquet') || path.endsWith('.pq') || path.endsWith('.zstd.parquet') ? 'parquet' : null;
};

const isStructWithBounds = (type: string) => {
  const normalized = type.toLowerCase();
  if (!normalized.startsWith('struct')) return false;
  return ['xmin', 'ymin', 'xmax', 'ymax'].every((key) => new RegExp(`\\b${key}\\b`).test(normalized));
};

/**
 * The GeoParquet 1.1 / Overture `bbox` struct column.
 *
 * This is the column that makes a remote read cheap: it holds plain doubles,
 * so Parquet's per-row-group statistics let the reader skip whole row groups
 * without decoding a single geometry. Finding it is the difference between
 * fetching a few megabytes and fetching the file.
 */
export const bboxColumn = (fields: RemoteField[]) =>
  fields.find((field) => isStructWithBounds(field.type))?.name ?? null;

export const geometryColumn = (fields: RemoteField[]) => {
  const typed = fields.find((field) => field.type.trim().toLowerCase() === 'geometry');
  if (typed) return typed.name;
  const wkb = fields.find((field) => ['geometry', 'geom', 'wkb_geometry'].includes(field.name.toLowerCase()));
  return wkb?.name ?? null;
};

const geometryExpression = (fields: RemoteField[]) => {
  const name = geometryColumn(fields);
  if (!name) return null;
  const field = fields.find((item) => item.name === name)!;
  return field.type.trim().toLowerCase() === 'geometry' ? qi(name) : `ST_GeomFromWKB(${qi(name)})`;
};

/**
 * Prefers the bbox struct and only falls back to decoding geometry, because
 * the fallback prunes nothing — it still reads every row, it just returns
 * fewer. Returns null when the file has neither, which is what makes a row
 * limit the only remaining guard.
 */
export const spatialPredicate = (bbox: RemoteBbox, fields: RemoteField[]): string | null => {
  const minX = sqlNumber(bbox.minX, 'West');
  const minY = sqlNumber(bbox.minY, 'South');
  const maxX = sqlNumber(bbox.maxX, 'East');
  const maxY = sqlNumber(bbox.maxY, 'North');

  const boundsColumn = bboxColumn(fields);
  if (boundsColumn) {
    const column = qi(boundsColumn);
    return `${column}.xmin <= ${maxX} AND ${column}.xmax >= ${minX} AND ${column}.ymin <= ${maxY} AND ${column}.ymax >= ${minY}`;
  }

  const geometry = geometryExpression(fields);
  if (!geometry) return null;
  return `ST_Intersects(${geometry}, ST_MakeEnvelope(${minX}, ${minY}, ${maxX}, ${maxY}))`;
};

/** Whether a bbox would actually skip row groups rather than merely filter output. */
export const bboxIsPushedDown = (fields: RemoteField[]) => bboxColumn(fields) !== null;

const selectList = (fields: RemoteField[], columns?: string[]) => {
  if (!columns || !columns.length) return '*';
  const geometry = geometryColumn(fields);
  const available = new Set(fields.map((field) => field.name));
  const chosen = columns.filter((name) => available.has(name));
  if (!chosen.length) throw new Error('Select at least one column that exists in the file.');
  // Dropping geometry would silently turn a map layer into a bare table.
  if (geometry && !chosen.includes(geometry)) chosen.push(geometry);
  return chosen.map(qi).join(', ');
};

export type RemoteScanOptions = {
  path: string;
  fields: RemoteField[];
  bbox?: RemoteBbox | null;
  limit?: number | null;
  columns?: string[];
};

/**
 * Materialises as a TABLE, not a VIEW, on purpose. A view over a remote file
 * re-issues range requests for every downstream node in the workflow, so a
 * three-step graph would pay the network cost three times. One bounded fetch,
 * then everything after it is local.
 */
export const remoteTableSql = (tableName: string, options: RemoteScanOptions) => {
  const predicate = options.bbox ? spatialPredicate(options.bbox, options.fields) : null;
  if (options.bbox && !predicate) {
    throw new Error('This file has no bbox or geometry column, so it cannot be filtered by area. Use a row limit instead.');
  }
  const clauses = [
    `SELECT ${selectList(options.fields, options.columns)}`,
    `FROM read_parquet('${escapeSqlString(options.path)}')`,
    predicate ? `WHERE ${predicate}` : '',
    options.limit ? `LIMIT ${sqlInteger(options.limit, 'Row limit')}` : '',
  ].filter(Boolean);
  return `CREATE OR REPLACE TABLE ${qi(tableName)} AS ${clauses.join(' ')};`;
};

/**
 * Returns why the read is refused, or null to proceed. Phrased as the reason
 * rather than a boolean so the caller can show it verbatim.
 */
export const guardFailure = ({
  byteSize,
  bbox,
  limit,
}: { byteSize?: number | null; bbox?: RemoteBbox | null; limit?: number | null }): string | null => {
  if (bbox || limit) return null;
  if (byteSize === undefined || byteSize === null) {
    return 'The server did not report a file size, so set a map area or a row limit before reading it.';
  }
  if (byteSize > REMOTE_UNGUARDED_MAX_BYTES) {
    const megabytes = Math.round(byteSize / 1024 / 1024);
    return `This file is ${megabytes.toLocaleString()} MB. Set a map area or a row limit before reading it.`;
  }
  return null;
};

export type RemoteCatalogEntry = {
  id: string;
  name: string;
  publisher: string;
  description: string;
  url: string;
  /** Bytes, as reported by the host when this entry was verified. */
  byteSize: number;
};

/**
 * A short list of single-file datasets, all verified to answer a HEAD request
 * with `Accept-Ranges: bytes` and open CORS.
 *
 * Single-file is the binding constraint, not curation taste. Overture's
 * buildings theme is 512 part files and places is 16, and there is no listing
 * API over plain HTTPS for a browser to expand a glob against — so only
 * datasets that are one object can be offered as one click. Everything else
 * has to come in as a pasted URL to a specific file.
 */
export const REMOTE_CATALOG: RemoteCatalogEntry[] = [
  {
    id: 'overture-divisions',
    name: 'Overture divisions',
    publisher: 'Overture Maps (2026-07-22.0)',
    description: 'Global administrative divisions. Large, so draw an area first.',
    url: 'https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/release/2026-07-22.0/theme=divisions/type=division/part-00000-3d9695ce-2282-56c2-9d25-622b1ec4727f-c000.zstd.parquet',
    byteSize: 576185044,
  },
  {
    id: 'google-open-buildings-ondo',
    name: 'Google Open Buildings — Ondo, Nigeria',
    publisher: 'source.coop / cholmes',
    description: 'One admin-1 partition of Google Open Buildings.',
    url: 'https://data.source.coop/cholmes/google-open-buildings/v2/geoparquet-admin1/country=NGA/Ondo.parquet',
    byteSize: 87607438,
  },
  {
    id: 'overture-buildings-fm',
    name: 'Overture buildings — Micronesia',
    publisher: 'source.coop / cholmes',
    description: 'Small country extract, useful for trying the node out.',
    url: 'https://data.source.coop/cholmes/overture/geoparquet-country-quad-2/FM.parquet',
    byteSize: 2744156,
  },
];

/**
 * Lets a catalog pick carry its own name. Overture's part files are named
 * `part-00000-3d9695ce-…-c000.zstd.parquet`, which would otherwise become the
 * node title, the layer name and the SQL table name.
 */
export const catalogEntryForUrl = (url: string) => REMOTE_CATALOG.find((entry) => entry.url === url) ?? null;
