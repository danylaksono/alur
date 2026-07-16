import { duckdbService } from './duckdb';
import { analyticsTableForLayer } from './visualAnalyticsService';
import { FEATURE_ID_PROPERTY } from '../types/visualAnalytics';
import { quoteIdentifier } from '../utils/visualFilterSql';
import type { MapLayer } from '../store/useStore';
import type { HexbinAggregate } from '../types/visualisation';

export type HexbinConfig = {
  /** Hexagon radius (center→vertex) in meters. */
  cellSize: number;
  aggregate: HexbinAggregate;
  field?: string;
};

const EARTH_RADIUS = 6378137;
const toMercatorInverse = (x: number, y: number): [number, number] => [
  (x / EARTH_RADIUS) * (180 / Math.PI),
  (2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) * (180 / Math.PI),
];
const toMercator = (lon: number, lat: number): [number, number] => [
  EARTH_RADIUS * ((lon * Math.PI) / 180),
  EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)),
];

const normalizeRows = (rows: any[]) =>
  rows.map((row) => (typeof row?.toJSON === 'function' ? row.toJSON() : row));

const detectGeometryColumn = async (tableName: string): Promise<string | null> => {
  const result = await duckdbService.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = '${tableName}'
      AND data_type = 'GEOMETRY'
    LIMIT 1;
  `);
  const rows = normalizeRows(result.toArray());
  return rows[0]?.column_name || null;
};

/** Exact pointy-top hex assignment (d3-hexbin algorithm) in mercator meters. */
const hexCellFor = (x: number, y: number, dx: number, dy: number): [number, number] => {
  let py = y / dy;
  let pj = Math.round(py);
  let px = x / dx - (pj & 1) / 2;
  let pi = Math.round(px);
  const py1 = py - pj;

  if (Math.abs(py1) * 3 > 1) {
    const px1 = px - pi;
    const pi2 = pi + (px < pi ? -1 : 1) / 2;
    const pj2 = pj + (py < pj ? -1 : 1);
    const px2 = px - pi2;
    const py2 = py - pj2;
    if (px1 * px1 + py1 * py1 > px2 * px2 + py2 * py2) {
      pi = pi2 + ((pj & 1) ? 1 : -1) / 2;
      pj = pj2;
    }
  }
  return [pi, pj];
};

const hexagonCoordinates = (centerX: number, centerY: number, radius: number): number[][] => {
  const ring = Array.from({ length: 6 }, (_, index) => {
    const angle = (Math.PI / 180) * (60 * index + 30);
    return toMercatorInverse(centerX + radius * Math.cos(angle), centerY + radius * Math.sin(angle));
  });
  return [...ring, ring[0]].map(([lon, lat]) => [lon, lat]);
};

/**
 * Aggregates a point layer into hexagon polygons with a `value` property
 * (count, or sum/avg of a numeric field). DuckDB extracts Web-Mercator
 * centroids; binning runs in JS with exact d3-hexbin math — no H3 extension
 * required (loading the community h3 extension breaks duckdb-wasm file
 * registration, see duckdb.ts).
 */
const resolveTableAndGeometry = async (layer: MapLayer) => {
  // For DuckDB-backed layers, the source metadata already knows the table,
  // geometry column, and CRS. Never use the MVT tile table — its geometry is
  // in tile coordinates.
  if (layer.source.kind === 'duckdb-table' || layer.source.kind === 'duckdb-query') {
    return {
      tableName: layer.source.tableName,
      geomColName: layer.source.geometryColumn,
      crs: layer.source.crs || 'EPSG:4326',
    };
  }
  const tableName = await analyticsTableForLayer(layer);
  const geomColName = await detectGeometryColumn(tableName);
  return { tableName, geomColName, crs: 'EPSG:4326' };
};

export const generateHexbinGeoJSON = async (
  layer: MapLayer,
  config: HexbinConfig,
): Promise<GeoJSON.FeatureCollection> => {
  const { tableName, geomColName, crs } = await resolveTableAndGeometry(layer);
  if (!geomColName) throw new Error('No geometry column found in layer');
  const geomCol = quoteIdentifier(geomColName);

  const radius = Math.max(10, config.cellSize);
  const wantsValue = config.aggregate !== 'count' && config.field;
  const valueSelect = wantsValue ? `, TRY_CAST(${quoteIdentifier(config.field!)} AS DOUBLE) AS v` : '';
  // Extract lon/lat and project to mercator in JS — ST_Transform to 3857 is a
  // trap here (EPSG:4326's official axis order is lat/lon, so a lon/lat
  // geometry gets scrambled unless always_xy is set on every hop).
  const centroidExpr = crs === 'EPSG:4326'
    ? `ST_Centroid(${geomCol})`
    : `ST_Transform(ST_Centroid(${geomCol}), '${crs.replace(/'/g, "''")}', 'EPSG:4326', true)`;

  const result = await duckdbService.query(`
    SELECT ST_X(c) AS lon, ST_Y(c) AS lat${valueSelect}
    FROM (
      SELECT ${centroidExpr} AS c${wantsValue ? `, ${quoteIdentifier(config.field!)}` : ''}
      FROM "${tableName}"
      WHERE ${geomCol} IS NOT NULL
    )
  `);
  const rows = normalizeRows(result.toArray());

  const dx = radius * Math.sqrt(3);
  const dy = radius * 1.5;
  const bins = new Map<string, { pi: number; pj: number; count: number; sum: number; valueCount: number }>();

  for (const row of rows) {
    const lon = Number(row.lon);
    const lat = Number(row.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 85) continue;
    const [x, y] = toMercator(lon, lat);
    const [pi, pj] = hexCellFor(x, y, dx, dy);
    const key = `${pi}|${pj}`;
    const bin = bins.get(key) || { pi, pj, count: 0, sum: 0, valueCount: 0 };
    bin.count += 1;
    if (wantsValue) {
      const value = Number(row.v);
      if (Number.isFinite(value)) {
        bin.sum += value;
        bin.valueCount += 1;
      }
    }
    bins.set(key, bin);
  }

  const features: GeoJSON.Feature[] = [];
  for (const bin of bins.values()) {
    const centerX = (bin.pi + (bin.pj & 1) / 2) * dx;
    const centerY = bin.pj * dy;
    const value = config.aggregate === 'count'
      ? bin.count
      : config.aggregate === 'sum'
        ? bin.sum
        : bin.valueCount > 0 ? bin.sum / bin.valueCount : null;
    if (value === null) continue;
    const featureId = `hex-${layer.id}-${bin.pi}_${bin.pj}`;
    features.push({
      type: 'Feature',
      id: featureId,
      geometry: { type: 'Polygon', coordinates: [hexagonCoordinates(centerX, centerY, radius)] },
      properties: {
        [FEATURE_ID_PROPERTY]: featureId,
        value,
        point_count: bin.count,
        source_layer: layer.id,
      },
    });
  }

  return { type: 'FeatureCollection', features };
};
