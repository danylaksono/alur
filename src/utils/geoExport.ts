import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';
import { rowsToCsv } from './download';

/**
 * Serialisers that turn a GeoJSON FeatureCollection into the file formats GIS
 * users actually ask for. Everything here is pure: the workflow export node
 * gets its features from DuckDB, and these functions only decide how the bytes
 * are shaped, so they can be tested without a database or a browser.
 *
 * KML, KMZ and GPX are all defined against WGS84 longitude/latitude. Nothing
 * here reprojects — `looksProjected` exists so callers can warn instead of
 * silently writing a file whose coordinates no earth viewer can place.
 */

export type GeoExportFormat =
  | 'geojson'
  | 'geojsonl'
  | 'kml'
  | 'kmz'
  | 'gpx'
  | 'wkt-csv'
  | 'csv'
  | 'json'
  | 'parquet';

export type GeoExportFormatSpec = {
  id: GeoExportFormat;
  label: string;
  extension: string;
  mimeType: string;
  group: 'Geospatial' | 'Tabular';
  /** Built from features, so the result must carry a geometry column. */
  needsGeometry: boolean;
  /** KML/KMZ/GPX only accept longitude/latitude. */
  requiresWgs84: boolean;
};

export const EXPORT_FORMATS: GeoExportFormatSpec[] = [
  { id: 'geojson', label: 'GeoJSON', extension: 'geojson', mimeType: 'application/geo+json', group: 'Geospatial', needsGeometry: true, requiresWgs84: false },
  { id: 'geojsonl', label: 'GeoJSON Lines (NDJSON)', extension: 'geojsonl', mimeType: 'application/geo+json-seq', group: 'Geospatial', needsGeometry: true, requiresWgs84: false },
  { id: 'kml', label: 'KML (Google Earth)', extension: 'kml', mimeType: 'application/vnd.google-earth.kml+xml', group: 'Geospatial', needsGeometry: true, requiresWgs84: true },
  { id: 'kmz', label: 'KMZ (zipped KML)', extension: 'kmz', mimeType: 'application/vnd.google-earth.kmz', group: 'Geospatial', needsGeometry: true, requiresWgs84: true },
  { id: 'gpx', label: 'GPX (waypoints & tracks)', extension: 'gpx', mimeType: 'application/gpx+xml', group: 'Geospatial', needsGeometry: true, requiresWgs84: true },
  { id: 'wkt-csv', label: 'CSV + WKT geometry', extension: 'csv', mimeType: 'text/csv', group: 'Geospatial', needsGeometry: true, requiresWgs84: false },
  { id: 'csv', label: 'CSV (attributes only)', extension: 'csv', mimeType: 'text/csv', group: 'Tabular', needsGeometry: false, requiresWgs84: false },
  { id: 'json', label: 'JSON', extension: 'json', mimeType: 'application/json', group: 'Tabular', needsGeometry: false, requiresWgs84: false },
  { id: 'parquet', label: 'Parquet', extension: 'parquet', mimeType: 'application/octet-stream', group: 'Tabular', needsGeometry: false, requiresWgs84: false },
];

const FORMATS_BY_ID = new Map(EXPORT_FORMATS.map((spec) => [spec.id, spec]));

/** Unknown ids fall back to GeoJSON so an old or hand-edited config still runs. */
export const exportFormatSpec = (id: string | undefined): GeoExportFormatSpec =>
  FORMATS_BY_ID.get(id as GeoExportFormat) ?? FORMATS_BY_ID.get('geojson')!;

export const exportFormatGroups = (): { group: GeoExportFormatSpec['group']; formats: GeoExportFormatSpec[] }[] =>
  (['Geospatial', 'Tabular'] as const).map((group) => ({
    group,
    formats: EXPORT_FORMATS.filter((spec) => spec.group === group),
  }));

// --- shared helpers -------------------------------------------------------

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

// XML 1.0 has no escape for most control characters, so they are dropped
// rather than written out as bytes that make the whole file unparseable.
// eslint-disable-next-line no-control-regex -- matching them is the point
const XML_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

export const escapeXml = (value: unknown) =>
  String(value ?? '')
    .replace(XML_CONTROL_CHARS, '')
    .replace(/[&<>"']/g, (char) => XML_ESCAPES[char]);

/** Nine decimals is well under a millimetre and avoids float printing noise. */
const num = (value: number) => String(Number(value.toFixed(9)));

const isFinitePosition = (position: Position | undefined): position is Position =>
  Array.isArray(position) && Number.isFinite(Number(position[0])) && Number.isFinite(Number(position[1]));

const eachPosition = (geometry: Geometry | null | undefined, visit: (position: Position) => void) => {
  if (!geometry) return;
  if (geometry.type === 'GeometryCollection') {
    geometry.geometries.forEach((child) => eachPosition(child, visit));
    return;
  }
  const walk = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === 'number') {
      visit(value as Position);
      return;
    }
    value.forEach(walk);
  };
  walk((geometry as Exclude<Geometry, GeoJSON.GeometryCollection>).coordinates);
};

/**
 * True when any coordinate falls outside longitude/latitude bounds — the
 * signature of a projected dataset (British National Grid, Web Mercator, …).
 */
export const looksProjected = (collection: FeatureCollection) => {
  let projected = false;
  for (const feature of collection.features) {
    eachPosition(feature.geometry, (position) => {
      if (Math.abs(Number(position[0])) > 180 || Math.abs(Number(position[1])) > 90) projected = true;
    });
    if (projected) return true;
  }
  return false;
};

const NAME_KEYS = ['name', 'label', 'title', 'placename'];

const featureName = (feature: Feature, fallback: string) => {
  const properties = feature.properties ?? {};
  for (const key of Object.keys(properties)) {
    if (!NAME_KEYS.includes(key.toLowerCase())) continue;
    const value = properties[key];
    if (value === null || value === undefined || typeof value === 'object') continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return fallback;
};

const propertyText = (value: unknown) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

/** Column order follows first appearance, so exports stay stable across runs. */
const propertyKeys = (collection: FeatureCollection) => {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const feature of collection.features) {
    for (const key of Object.keys(feature.properties ?? {})) {
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
};

/** KML linear rings must close; GeoJSON rings usually do, but not always. */
const closedRing = (ring: Position[]) => {
  const positions = ring.filter(isFinitePosition);
  if (positions.length < 3) return positions;
  const first = positions[0];
  const last = positions[positions.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return positions;
  return [...positions, first];
};

// --- KML ------------------------------------------------------------------

const kmlCoordinates = (positions: Position[]) =>
  positions
    .filter(isFinitePosition)
    .map((position) => {
      const altitude = Number.isFinite(Number(position[2])) ? `,${num(Number(position[2]))}` : '';
      return `${num(Number(position[0]))},${num(Number(position[1]))}${altitude}`;
    })
    .join(' ');

const kmlPolygon = (rings: Position[][]) => {
  const [outer, ...inner] = rings;
  if (!outer) return '';
  const boundaries = [
    `<outerBoundaryIs><LinearRing><coordinates>${kmlCoordinates(closedRing(outer))}</coordinates></LinearRing></outerBoundaryIs>`,
    ...inner.map(
      (ring) =>
        `<innerBoundaryIs><LinearRing><coordinates>${kmlCoordinates(closedRing(ring))}</coordinates></LinearRing></innerBoundaryIs>`,
    ),
  ];
  return `<Polygon>${boundaries.join('')}</Polygon>`;
};

const geometryToKml = (geometry: Geometry | null | undefined): string => {
  if (!geometry) return '';
  switch (geometry.type) {
    case 'Point':
      return isFinitePosition(geometry.coordinates)
        ? `<Point><coordinates>${kmlCoordinates([geometry.coordinates])}</coordinates></Point>`
        : '';
    case 'LineString':
      return geometry.coordinates.length
        ? `<LineString><coordinates>${kmlCoordinates(geometry.coordinates)}</coordinates></LineString>`
        : '';
    case 'Polygon':
      return kmlPolygon(geometry.coordinates);
    case 'MultiPoint':
    case 'MultiLineString':
    case 'MultiPolygon': {
      const memberType = geometry.type.replace('Multi', '') as 'Point' | 'LineString' | 'Polygon';
      const parts = (geometry.coordinates as any[])
        .map((coordinates) => geometryToKml({ type: memberType, coordinates } as Geometry))
        .filter(Boolean);
      return parts.length ? `<MultiGeometry>${parts.join('')}</MultiGeometry>` : '';
    }
    case 'GeometryCollection': {
      const parts = geometry.geometries.map(geometryToKml).filter(Boolean);
      return parts.length ? `<MultiGeometry>${parts.join('')}</MultiGeometry>` : '';
    }
    default:
      return '';
  }
};

const kmlExtendedData = (feature: Feature) => {
  const entries = Object.entries(feature.properties ?? {}).filter(([, value]) => propertyText(value) !== '');
  if (!entries.length) return '';
  const fields = entries
    .map(([key, value]) => `<Data name="${escapeXml(key)}"><value>${escapeXml(propertyText(value))}</value></Data>`)
    .join('');
  return `<ExtendedData>${fields}</ExtendedData>`;
};

export const featureCollectionToKml = (collection: FeatureCollection, options: { documentName?: string } = {}) => {
  const placemarks: string[] = [];
  collection.features.forEach((feature, index) => {
    const geometry = geometryToKml(feature.geometry);
    if (!geometry) return;
    const extendedData = kmlExtendedData(feature);
    placemarks.push(
      '    <Placemark>',
      `      <name>${escapeXml(featureName(feature, `Feature ${index + 1}`))}</name>`,
      ...(extendedData ? [`      ${extendedData}`] : []),
      `      ${geometry}`,
      '    </Placemark>',
    );
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    '  <Document>',
    `    <name>${escapeXml(options.documentName || 'ALUR export')}</name>`,
    ...placemarks,
    '  </Document>',
    '</kml>',
    '',
  ].join('\n');
};

// --- GPX ------------------------------------------------------------------

type GpxParts = { waypoints: Position[]; tracks: Position[][] };

const collectGpx = (geometry: Geometry | null | undefined, parts: GpxParts): boolean => {
  if (!geometry) return false;
  const track = (positions: Position[]) => {
    const points = positions.filter(isFinitePosition);
    if (points.length < 2) return false;
    parts.tracks.push(points);
    return true;
  };

  switch (geometry.type) {
    case 'Point':
      if (!isFinitePosition(geometry.coordinates)) return false;
      parts.waypoints.push(geometry.coordinates);
      return true;
    case 'MultiPoint':
      return geometry.coordinates.map((coordinates) => collectGpx({ type: 'Point', coordinates }, parts)).some(Boolean);
    case 'LineString':
      return track(geometry.coordinates);
    case 'MultiLineString':
      return geometry.coordinates.map((line) => track(line)).some(Boolean);
    // GPX has no polygon. Rings become closed tracks, which is what earth
    // viewers and GPS units can show — the area semantics are lost.
    case 'Polygon':
      return geometry.coordinates.map((ring) => track(closedRing(ring))).some(Boolean);
    case 'MultiPolygon':
      return geometry.coordinates.flat().map((ring) => track(closedRing(ring))).some(Boolean);
    case 'GeometryCollection':
      return geometry.geometries.map((child) => collectGpx(child, parts)).some(Boolean);
    default:
      return false;
  }
};

/**
 * Returns the document plus the number of features that contributed nothing
 * (empty or degenerate geometry), so the caller can say so rather than hand
 * back a silently short file.
 */
export const featureCollectionToGpx = (
  collection: FeatureCollection,
  options: { documentName?: string } = {},
): { gpx: string; skipped: number } => {
  // Waypoints must precede tracks in the GPX schema, so they are gathered into
  // separate buckets rather than emitted feature by feature.
  const waypointLines: string[] = [];
  const trackLines: string[] = [];
  let skipped = 0;

  collection.features.forEach((feature, index) => {
    const parts: GpxParts = { waypoints: [], tracks: [] };
    if (!collectGpx(feature.geometry, parts)) {
      skipped += 1;
      return;
    }
    const name = escapeXml(featureName(feature, `Feature ${index + 1}`));
    for (const position of parts.waypoints) {
      waypointLines.push(
        `  <wpt lat="${num(Number(position[1]))}" lon="${num(Number(position[0]))}">`,
        `    <name>${name}</name>`,
        '  </wpt>',
      );
    }
    for (const positions of parts.tracks) {
      trackLines.push(
        '  <trk>',
        `    <name>${name}</name>`,
        '    <trkseg>',
        ...positions.map(
          (position) => `      <trkpt lat="${num(Number(position[1]))}" lon="${num(Number(position[0]))}" />`,
        ),
        '    </trkseg>',
        '  </trk>',
      );
    }
  });

  const gpx = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="ALUR" xmlns="http://www.topografix.com/GPX/1/1">',
    '  <metadata>',
    `    <name>${escapeXml(options.documentName || 'ALUR export')}</name>`,
    '  </metadata>',
    ...waypointLines,
    ...trackLines,
    '</gpx>',
    '',
  ].join('\n');

  return { gpx, skipped };
};

// --- WKT ------------------------------------------------------------------

const hasZ = (geometry: Geometry) => {
  let z = false;
  eachPosition(geometry, (position) => {
    if (Number.isFinite(Number(position[2]))) z = true;
  });
  return z;
};

const wktPosition = (position: Position, withZ: boolean) => {
  const parts = [num(Number(position[0])), num(Number(position[1]))];
  if (withZ) parts.push(num(Number.isFinite(Number(position[2])) ? Number(position[2]) : 0));
  return parts.join(' ');
};

const wktRing = (positions: Position[], withZ: boolean) =>
  `(${positions.filter(isFinitePosition).map((position) => wktPosition(position, withZ)).join(', ')})`;

const WKT_TYPES: Record<string, string> = {
  Point: 'POINT',
  MultiPoint: 'MULTIPOINT',
  LineString: 'LINESTRING',
  MultiLineString: 'MULTILINESTRING',
  Polygon: 'POLYGON',
  MultiPolygon: 'MULTIPOLYGON',
  GeometryCollection: 'GEOMETRYCOLLECTION',
};

const wktBody = (geometry: Geometry, withZ: boolean): string => {
  switch (geometry.type) {
    case 'Point':
      return isFinitePosition(geometry.coordinates) ? `(${wktPosition(geometry.coordinates, withZ)})` : 'EMPTY';
    case 'LineString':
      return geometry.coordinates.length ? wktRing(geometry.coordinates, withZ) : 'EMPTY';
    case 'MultiPoint':
      return geometry.coordinates.length
        ? `(${geometry.coordinates
            .filter(isFinitePosition)
            .map((position) => `(${wktPosition(position, withZ)})`)
            .join(', ')})`
        : 'EMPTY';
    case 'Polygon':
    case 'MultiLineString':
      return geometry.coordinates.length
        ? `(${geometry.coordinates.map((ring) => wktRing(ring, withZ)).join(', ')})`
        : 'EMPTY';
    case 'MultiPolygon':
      return geometry.coordinates.length
        ? `(${geometry.coordinates
            .map((polygon) => `(${polygon.map((ring) => wktRing(ring, withZ)).join(', ')})`)
            .join(', ')})`
        : 'EMPTY';
    case 'GeometryCollection':
      return geometry.geometries.length
        ? `(${geometry.geometries.map((child) => geometryToWkt(child)).join(', ')})`
        : 'EMPTY';
    default:
      return 'EMPTY';
  }
};

export const geometryToWkt = (geometry: Geometry | null | undefined): string => {
  if (!geometry || !WKT_TYPES[geometry.type]) return '';
  const withZ = hasZ(geometry);
  const body = wktBody(geometry, withZ);
  const tag = `${WKT_TYPES[geometry.type]}${withZ ? ' Z' : ''}`;
  return body === 'EMPTY' ? `${tag} EMPTY` : `${tag} ${body}`;
};

/** CSV that QGIS, DuckDB and PostGIS can all read straight back as geometry. */
export const featureCollectionToWktCsv = (collection: FeatureCollection, geometryColumn = 'geometry_wkt') => {
  const keys = propertyKeys(collection).filter((key) => key !== geometryColumn);
  const rows = collection.features.map((feature) => [
    ...keys.map((key) => propertyText(feature.properties?.[key])),
    geometryToWkt(feature.geometry),
  ]);
  return `${rowsToCsv([...keys, geometryColumn], rows)}\r\n`;
};

// --- GeoJSON variants -----------------------------------------------------

export const featureCollectionToGeoJson = (collection: FeatureCollection) => `${JSON.stringify(collection, null, 2)}\n`;

/** One feature per line: streamable, and what BigQuery and ogr2ogr expect. */
export const featureCollectionToGeoJsonSeq = (collection: FeatureCollection) =>
  collection.features.map((feature) => `${JSON.stringify(feature)}\n`).join('');
