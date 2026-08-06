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
  const py = y / dy;
  let pj = Math.round(py);
  const px = x / dx - (pj & 1) / 2;
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
 * Cell edge length in metres for each H3 resolution, read from the engine once.
 *
 * Asking rather than hardcoding the table means the numbers cannot drift from
 * whatever build of the extension is actually loaded.
 */
let edgeLengths: Promise<number[]> | null = null;
const h3EdgeLengths = () => {
  if (!edgeLengths) {
    edgeLengths = duckdbService
      .query(`SELECT r, h3_get_hexagon_edge_length_avg(CAST(r AS INTEGER), 'm') AS edge FROM range(0, 16) t(r) ORDER BY r;`)
      .then((result) => normalizeRows(result.toArray()).map((row) => Number(row.edge)))
      .catch(() => {
        edgeLengths = null;
        return [];
      });
  }
  return edgeLengths;
};

/**
 * The H3 resolution whose cells are closest to the requested radius.
 *
 * Compared in log space because resolutions step by roughly a factor of 2.6:
 * on a linear scale the coarse end would swamp the comparison and every small
 * cell size would collapse onto the same answer.
 */
export const resolutionForCellSize = (cellSize: number, edges: number[]): number => {
  // Resolution 8 is roughly a 500m cell — a sane city-scale default when there
  // is nothing to choose from, or nothing sensible to choose by.
  if (!edges.length || !Number.isFinite(cellSize) || cellSize <= 0) return 8;
  const target = Math.log(cellSize);
  let best = 0;
  let bestGap = Infinity;
  edges.forEach((edge, resolution) => {
    if (!Number.isFinite(edge) || edge <= 0) return;
    const gap = Math.abs(Math.log(edge) - target);
    if (gap < bestGap) {
      bestGap = gap;
      best = resolution;
    }
  });
  return best;
};

export type HexbinMethod = 'h3' | 'mercator';

/** How the last generated hexbin grid was actually built. */
export type HexbinResult = {
  featureCollection: GeoJSON.FeatureCollection;
  method: HexbinMethod;
  /** Only set for the H3 path. */
  resolution?: number;
  /**
   * The cell size actually used, which is not always the one requested.
   *
   * H3 resolutions step by a factor of about 2.6, so neighbouring entries in a
   * metre-denominated menu can land on the same resolution — asking for 2km
   * and 1km both give resolution 7. Reporting what was used makes that visible
   * instead of leaving two controls that quietly do the same thing.
   */
  cellEdgeMetres?: number;
};

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

/**
 * Bins points into true H3 cells, aggregating inside the engine.
 *
 * Two things this does that the Mercator fallback cannot. H3 cells are very
 * nearly equal-area, so counts are comparable between north and south — a
 * Mercator hexagon at latitude 60 covers about a quarter of the ground a
 * hexagon of the same drawn size covers at the equator, which makes a national
 * or global density map quietly misleading. And the grouping happens in SQL,
 * so what crosses into JS is one row per occupied cell rather than one row per
 * point.
 *
 * Cell ids are returned as their canonical string form on purpose: an H3 index
 * is a 64-bit integer, and several are already past 2^53, so reading one as a
 * JS number silently rounds it and distinct cells collide.
 */
const generateH3Hexbins = async (
  layer: MapLayer,
  config: HexbinConfig,
  table: string,
  geomCol: string,
  centroidExpr: string,
): Promise<HexbinResult> => {
  const edges = await h3EdgeLengths();
  const resolution = resolutionForCellSize(Math.max(10, config.cellSize), edges);
  const wantsValue = config.aggregate !== 'count' && config.field;
  const value = wantsValue ? `TRY_CAST(${quoteIdentifier(config.field!)} AS DOUBLE)` : 'NULL';

  const result = await duckdbService.query(`
    SELECT h3_h3_to_string(cell) AS cell,
           ST_AsGeoJSON(ST_GeomFromText(h3_cell_to_boundary_wkt(cell))) AS boundary,
           point_count, value_sum, value_count
    FROM (
      SELECT h3_latlng_to_cell(ST_Y(c), ST_X(c), ${resolution}) AS cell,
             COUNT(*) AS point_count,
             SUM(v) AS value_sum,
             COUNT(v) AS value_count
      FROM (
        SELECT ${centroidExpr} AS c, ${value} AS v
        FROM ${table}
        WHERE ${geomCol} IS NOT NULL
      )
      WHERE c IS NOT NULL AND ST_Y(c) BETWEEN -90 AND 90 AND ST_X(c) BETWEEN -180 AND 180
      GROUP BY 1
    )
    WHERE cell IS NOT NULL;
  `);

  const features: GeoJSON.Feature[] = [];
  for (const row of normalizeRows(result.toArray())) {
    const count = Number(row.point_count) || 0;
    const sum = Number(row.value_sum);
    const valueCount = Number(row.value_count) || 0;
    const aggregated = config.aggregate === 'count'
      ? count
      : config.aggregate === 'sum'
        ? (Number.isFinite(sum) ? sum : null)
        : valueCount > 0 && Number.isFinite(sum) ? sum / valueCount : null;
    if (aggregated === null) continue;

    let geometry: GeoJSON.Geometry;
    try {
      geometry = JSON.parse(String(row.boundary));
    } catch {
      continue;
    }
    const featureId = `hex-${layer.id}-${row.cell}`;
    features.push({
      type: 'Feature',
      id: featureId,
      geometry,
      properties: {
        [FEATURE_ID_PROPERTY]: featureId,
        value: aggregated,
        point_count: count,
        h3_cell: String(row.cell),
        source_layer: layer.id,
      },
    });
  }

  return {
    featureCollection: { type: 'FeatureCollection', features },
    method: 'h3',
    resolution,
    cellEdgeMetres: edges[resolution],
  };
};

export const generateHexbins = async (
  layer: MapLayer,
  config: HexbinConfig,
): Promise<HexbinResult> => {
  const { tableName, geomColName, crs } = await resolveTableAndGeometry(layer);
  if (!geomColName) throw new Error('No geometry column found in layer');
  const geomCol = quoteIdentifier(geomColName);
  const table = `"${tableName.replace(/"/g, '""')}"`;

  const radius = Math.max(10, config.cellSize);
  const wantsValue = config.aggregate !== 'count' && config.field;
  const valueSelect = wantsValue ? `, TRY_CAST(${quoteIdentifier(config.field!)} AS DOUBLE) AS v` : '';
  // Extract lon/lat and project to mercator in JS — ST_Transform to 3857 is a
  // trap here (EPSG:4326's official axis order is lat/lon, so a lon/lat
  // geometry gets scrambled unless always_xy is set on every hop).
  const centroidExpr = crs === 'EPSG:4326'
    ? `ST_Centroid(${geomCol})`
    : `ST_Transform(ST_Centroid(${geomCol}), '${crs.replace(/'/g, "''")}', 'EPSG:4326', true)`;

  // Equal-area cells are worth a one-off extension fetch; the Mercator path
  // below stays as the answer when that fetch cannot happen.
  if (await duckdbService.ensureH3()) {
    try {
      return await generateH3Hexbins(layer, config, table, geomCol, centroidExpr);
    } catch {
      // Fall through: a working grid on the old geometry beats no grid.
    }
  }

  const result = await duckdbService.query(`
    SELECT ST_X(c) AS lon, ST_Y(c) AS lat${valueSelect}
    FROM (
      SELECT ${centroidExpr} AS c${wantsValue ? `, ${quoteIdentifier(config.field!)}` : ''}
      FROM ${table}
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

  return { featureCollection: { type: 'FeatureCollection', features }, method: 'mercator' };
};
