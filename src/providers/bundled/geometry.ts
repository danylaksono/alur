/**
 * Geometry the bundled calculations share.
 *
 * Kept here rather than reaching for ALUR's own utilities, because a bundled
 * plugin is a plugin: it may only use what an external one could. The moment one
 * of these imports the store, the map or a service, "bundled" stops meaning
 * "shipped alongside" and starts meaning "privileged", and the toolbox becomes
 * two kinds of thing wearing one label.
 */

export type Point = { lon: number; lat: number };

/**
 * One coordinate standing for a feature, so an area can be treated as a place.
 *
 * A vertex average. Real data is rarely points — an administrative unit arrives
 * as a boundary — and requiring conversion first would make these calculations
 * unusable against the data they exist for. It is not an area-weighted centroid
 * and is not meant to be.
 */
export const representativePoint = (geometry: GeoJSON.Geometry | null | undefined): Point | null => {
  if (!geometry) return null;
  if (geometry.type === 'Point') {
    const [lon, lat] = geometry.coordinates;
    return Number.isFinite(lon) && Number.isFinite(lat) ? { lon, lat } : null;
  }

  const positions: number[][] = [];
  const walk = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === 'number') {
      positions.push(value as number[]);
      return;
    }
    // A ring repeats its first position as its last. Counting it twice pulls the
    // average toward that one vertex — small, but wrong for no reason, and the
    // error grows as the ring gets simpler.
    const ring = value as unknown[];
    const first = ring[0] as number[] | undefined;
    const last = ring[ring.length - 1] as number[] | undefined;
    const closed =
      ring.length > 2 &&
      Array.isArray(first) && typeof first[0] === 'number' &&
      Array.isArray(last) && last[0] === first[0] && last[1] === first[1];
    for (const entry of closed ? ring.slice(0, -1) : ring) walk(entry);
  };
  walk((geometry as { coordinates?: unknown }).coordinates);
  if (!positions.length) return null;

  const total = positions.reduce((sum, [lon, lat]) => [sum[0] + lon, sum[1] + lat], [0, 0]);
  const lon = total[0] / positions.length;
  const lat = total[1] / positions.length;
  return Number.isFinite(lon) && Number.isFinite(lat) ? { lon, lat } : null;
};

const EARTH_RADIUS_KM = 6371;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle distance in kilometres. */
export const distanceKm = (a: Point, b: Point): number => {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

/**
 * A coarse bucketing of points, so a proximity question is not a scan of
 * everything.
 *
 * Cells are one radius wide, so anything within the radius is in the same cell
 * or one of the eight around it. Longitude degrees narrow with latitude —
 * without that correction the cells are far too wide in the north and the index
 * quietly stops narrowing anything.
 */
export class GridIndex<T> {
  private readonly cells = new Map<string, Array<{ point: Point; value: T }>>();

  constructor(private readonly radiusKm: number) {}

  private cellOf({ lon, lat }: Point): [number, number] {
    const latDegrees = this.radiusKm / 111.32;
    const lonDegrees = latDegrees / Math.max(0.01, Math.cos(toRadians(lat)));
    return [Math.floor(lon / lonDegrees), Math.floor(lat / latDegrees)];
  }

  add(point: Point, value: T) {
    const [x, y] = this.cellOf(point);
    const key = `${x}:${y}`;
    const bucket = this.cells.get(key);
    if (bucket) bucket.push({ point, value });
    else this.cells.set(key, [{ point, value }]);
  }

  /** Everything that could be within one radius of this point. */
  near(point: Point): Array<{ point: Point; value: T }> {
    const [cx, cy] = this.cellOf(point);
    const found: Array<{ point: Point; value: T }> = [];
    for (let x = cx - 1; x <= cx + 1; x += 1) {
      for (let y = cy - 1; y <= cy + 1; y += 1) {
        const bucket = this.cells.get(`${x}:${y}`);
        if (bucket) found.push(...bucket);
      }
    }
    return found;
  }
}

/** A number, or `fallback` when the value is absent or unparseable. */
export const asNumber = (value: unknown, fallback: number | null = null): number | null => {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** Parse the GeoJSON an input arrived as, with a message naming what was wrong. */
export const parseInput = (geojson: string | undefined, label: string): GeoJSON.FeatureCollection => {
  if (!geojson) throw new Error(`${label} was not supplied as geometry.`);
  const collection = JSON.parse(geojson) as GeoJSON.FeatureCollection;
  if (!collection?.features) throw new Error(`${label} is not a feature collection.`);
  return collection;
};
