import { duckdbService } from './duckdb';
import { analyticsTableForLayer } from './visualAnalyticsService';
import { FEATURE_ID_PROPERTY } from '../types/visualAnalytics';
import type { MapLayer } from '../store/useStore';

/**
 * Grid cartograms: the same areas, laid out as equal cells.
 *
 * Two of the author's libraries compose here. gridmapper decides which cell
 * each area belongs in — a mixed-integer program that keeps neighbours next to
 * neighbours — and geo-morpher turns those row/col assignments into squares and
 * interpolates between the real geography and the grid.
 *
 * Both are loaded on demand: gridmapper carries a WASM LP solver that has no
 * business in the initial bundle of a map that may never draw a cartogram.
 */

/**
 * A cartogram is for area units — wards, LSOAs, districts — where every place
 * gets equal visual weight. Past a few thousand cells it stops being readable
 * long before it stops being computable, and the MIP is superlinear.
 * ponytail: fixed cap, make it an option if someone has a real 5k-area case.
 */
export const CARTOGRAM_MAX_FEATURES = 2000;

export type CartogramPair = {
  regularGeoJSON: GeoJSON.FeatureCollection;
  cartogramGeoJSON: GeoJSON.FeatureCollection;
  /** The property both collections are keyed on, for the morph's own join. */
  joinProperty: string;
  featureCount: number;
};

/**
 * The property a layer's features are actually keyed on.
 *
 * DuckDB-backed layers carry their own id column and never see
 * `_alur_feature_id`, so assuming that name joins the grid to nothing and
 * morphs an empty collection.
 */
const joinPropertyForLayer = (layer: MapLayer): string =>
  layer.source?.kind === 'duckdb-table' || layer.source?.kind === 'duckdb-query'
    ? layer.source.featureIdColumn
    : FEATURE_ID_PROPERTY;

/** Centroid of any geometry, good enough to place a cell. */
const centroidOf = (geometry: GeoJSON.Geometry | null): [number, number] | null => {
  if (!geometry) return null;
  if (geometry.type === 'Point') return geometry.coordinates as [number, number];

  let sumX = 0;
  let sumY = 0;
  let count = 0;
  const walk = (coords: any) => {
    if (typeof coords[0] === 'number') {
      sumX += coords[0];
      sumY += coords[1];
      count += 1;
      return;
    }
    coords.forEach(walk);
  };
  walk((geometry as any).coordinates ?? []);
  return count ? [sumX / count, sumY / count] : null;
};

/** The layer's own geometry, whether it lives in DuckDB or as attached GeoJSON. */
const regularGeoJSONForLayer = async (layer: MapLayer): Promise<GeoJSON.FeatureCollection> => {
  if (!layer.source || layer.source.kind === 'legacy-geojson') {
    return layer.geojson || { type: 'FeatureCollection', features: [] };
  }
  const tableName = await analyticsTableForLayer(layer as any);
  if (!tableName) return { type: 'FeatureCollection', features: [] };
  // A layer table stores __alur_tile_geom in Web Mercator, the same convention
  // the glyph grid and the extent query already transform out of. Without the
  // source CRS the cells come back in metres and land off the planet.
  const geojson = await duckdbService.getGeoJSONFromTable(
    tableName,
    CARTOGRAM_MAX_FEATURES + 1,
    'EPSG:3857',
  );
  return geojson || { type: 'FeatureCollection', features: [] };
};

/**
 * Builds the pair of aligned collections a morph needs: the real geography and
 * the grid it collapses to. Features are joined on the feature id ALUR already
 * assigns, so the two collections stay in step feature for feature.
 */
export const buildCartogramPair = async (
  layer: MapLayer,
  options: { compactness?: number; gridType?: 'rect' | 'hex' } = {},
): Promise<CartogramPair> => {
  const regularGeoJSON = await regularGeoJSONForLayer(layer);
  const features = regularGeoJSON.features || [];

  if (!features.length) {
    throw new Error(`"${layer.name}" has no geometry to lay out as a cartogram.`);
  }
  if (features.length > CARTOGRAM_MAX_FEATURES) {
    throw new Error(
      `A cartogram reads as ${CARTOGRAM_MAX_FEATURES} cells at most; "${layer.name}" has ${features.length.toLocaleString()}. Summarise it to an area level first.`,
    );
  }

  const joinProperty = joinPropertyForLayer(layer);
  const points = features
    .map((feature, index) => {
      const centre = centroidOf(feature.geometry);
      if (!centre) return null;
      return {
        id: String(feature.properties?.[joinProperty] ?? feature.id ?? index),
        lon: centre[0],
        lat: centre[1],
      };
    })
    .filter((point): point is { id: string; lon: number; lat: number } => point !== null);

  if (!points.length) {
    throw new Error(`Could not place "${layer.name}" on a grid — no usable centroids.`);
  }

  const [{ GridMapper, GLPKSolver }, { createGridCartogramFeatureCollection }, glpkModule] =
    await Promise.all([import('gridmapper'), import('geo-morpher'), import('glpk.js')]);

  // gridmapper takes the solver by injection rather than depending on one, so
  // the LP backend has to be built here. glpk.js ships as a factory returning a
  // promise; the module shape differs between its ESM and CJS builds.
  const glpkFactory: any = (glpkModule as any).default ?? glpkModule;
  const glpk = typeof glpkFactory === 'function' ? await glpkFactory() : glpkFactory;

  const mapper = new GridMapper();
  const allocation = await mapper.allocate(points, {
    xAccessor: (d: { lon: number }) => d.lon,
    yAccessor: (d: { lat: number }) => d.lat,
    compactness: options.compactness ?? 0.6,
    gridType: options.gridType ?? 'rect',
    rotateByPCA: true,
    mip: () => new GLPKSolver(glpk),
  });

  // gridmapper writes gridX/gridY back onto each record; geo-morpher reads
  // row/col, so the assignment is renamed rather than recomputed.
  const records = (allocation.assignments ?? []).map((entry: any, index: number) => ({
    [joinProperty]: entry.id ?? points[index]?.id,
    row: entry.gridY ?? entry.row,
    col: entry.gridX ?? entry.col,
  }));

  const cartogramGeoJSON = createGridCartogramFeatureCollection({
    records,
    regularGeoJSON,
    joinProperty,
  });

  return { regularGeoJSON, cartogramGeoJSON, joinProperty, featureCount: features.length };
};
