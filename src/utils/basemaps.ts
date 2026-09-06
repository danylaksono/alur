import type { StyleSpecification } from 'maplibre-gl';

/**
 * Built-in ids stay a union so the defaults keep their spelling checked. The
 * id of a stored basemap is a plain string, because a user-added source
 * contributes one this file cannot know.
 */
export type BuiltInBasemapId = 'positron' | 'voyager' | 'dark' | 'osm';
export type BasemapId = string;

export type BasemapDefinition = {
  id: BasemapId;
  name: string;
  description: string;
  /** A style URL, or a whole style built here for a bare tile endpoint. */
  style: string | StyleSpecification;
  /** Present only on sources the user added, which are the removable ones. */
  custom?: { url: string; kind: TileSourceKind };
};

export const BASEMAPS: BasemapDefinition[] = [
  {
    id: 'positron',
    name: 'Light',
    description: 'Quiet CARTO basemap for analysis overlays',
    style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  },
  {
    id: 'voyager',
    name: 'Street',
    description: 'Detailed streets, labels, and urban context',
    style: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
  },
  {
    id: 'dark',
    name: 'Dark',
    description: 'High contrast backdrop for dense results',
    style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  },
  {
    id: 'osm',
    name: 'OSM',
    description: 'OpenStreetMap raster tiles',
    style: 'https://demotiles.maplibre.org/style.json',
  },
];

export const DEFAULT_BASEMAP_ID: BuiltInBasemapId = 'positron';

/** What kind of thing a pasted URL turns out to be. */
export type TileSourceKind = 'style' | 'xyz' | 'wms' | 'pmtiles';

/**
 * Reads the kind off the URL rather than asking.
 *
 * These four shapes are unambiguous in practice: an XYZ endpoint carries {z},
 * a WMS one carries the request parameters in its query string, PMTiles is a
 * file extension or an explicit protocol, and anything else is a style document.
 */
export const detectTileSourceKind = (url: string): TileSourceKind => {
  const value = url.trim();
  const lower = value.toLowerCase();
  if (lower.startsWith('pmtiles://') || lower.includes('.pmtiles')) return 'pmtiles';
  if (/[?&]service=wms/i.test(value) || /[?&]request=getmap/i.test(value)) return 'wms';
  if (value.includes('{z}') || value.includes('{x}')) return 'xyz';
  return 'style';
};

/** A minimal single-raster-layer style, which is all a tile endpoint needs. */
const rasterStyle = (tiles: string[], attribution: string): StyleSpecification => ({
  version: 8,
  sources: {
    'custom-raster': { type: 'raster', tiles, tileSize: 256, attribution },
  },
  layers: [{ id: 'custom-raster-layer', type: 'raster', source: 'custom-raster' }],
});

/**
 * A WMS endpoint answers for a bounding box rather than a tile index, so the
 * request parameters are filled in and MapLibre is left to substitute the box.
 * Anything the caller already set — layers, styles, a CRS — is preserved.
 */
const wmsStyle = (url: string, attribution: string): StyleSpecification => {
  const [base, query = ''] = url.split('?');
  const params = new URLSearchParams(query);
  const setDefault = (key: string, value: string) => {
    const existing = [...params.keys()].find((k) => k.toLowerCase() === key.toLowerCase());
    if (!existing) params.set(key, value);
  };
  setDefault('service', 'WMS');
  setDefault('request', 'GetMap');
  setDefault('version', '1.3.0');
  setDefault('format', 'image/png');
  setDefault('transparent', 'true');
  setDefault('width', '256');
  setDefault('height', '256');
  // 1.3.0 calls it CRS, 1.1.1 calls it SRS; setting both is harmless and saves
  // the user knowing which version their server speaks.
  setDefault('crs', 'EPSG:3857');
  setDefault('srs', 'EPSG:3857');

  // MapLibre substitutes this token itself, and URLSearchParams would escape
  // the braces, so it is appended after serialising.
  return rasterStyle([`${base}?${params.toString()}&bbox={bbox-epsg-3857}`], attribution);
};

/**
 * Turns a pasted URL into something `map.setStyle` accepts.
 *
 * A style document and a PMTiles basemap style are passed through as URLs —
 * MapLibre fetches them, and the pmtiles:// sources inside resolve through the
 * registered protocol. A bare tile endpoint has no style, so one is built.
 */
export const basemapStyleFromUrl = (
  url: string,
  kind: TileSourceKind = detectTileSourceKind(url),
  attribution = '',
): string | StyleSpecification => {
  const value = url.trim();
  switch (kind) {
    case 'wms':
      return wmsStyle(value, attribution);
    case 'xyz':
      return rasterStyle([value], attribution);
    case 'pmtiles':
      // A .json is a style that happens to reference PMTiles; a bare archive is
      // raster tiles that need one built around them.
      return value.toLowerCase().endsWith('.json')
        ? value
        : rasterStyle([`pmtiles://${value.replace(/^pmtiles:\/\//i, '')}/{z}/{x}/{y}`], attribution);
    default:
      return value;
  }
};

/** A readable name from the URL, so naming one is optional rather than a chore. */
export const defaultTileSourceName = (
  url: string,
  kind: TileSourceKind = detectTileSourceKind(url),
): string => {
  try {
    const { hostname, pathname } = new URL(url.replace(/^pmtiles:\/\//i, ''));
    const file = pathname.split('/').filter(Boolean).pop();
    const stem = file && /\.(pmtiles|json)$/i.test(file) ? file.replace(/\.[^.]+$/, '') : '';
    return stem || `${hostname.replace(/^www\./, '')} ${kind.toUpperCase()}`;
  } catch {
    return `Custom ${kind.toUpperCase()}`;
  }
};

/**
 * Tiles a user brings are tiles someone else hosts, and the terms almost always
 * require crediting them. The real notice is not knowable from a URL, so this
 * says where it came from and leaves the wording to whoever added it.
 */
export const attributionFor = (kind: TileSourceKind) =>
  kind === 'style' ? '' : 'Custom tile source';

export function getBasemap(id: BasemapId, custom: BasemapDefinition[] = []) {
  return (
    [...BASEMAPS, ...custom].find((basemap) => basemap.id === id) || BASEMAPS[0]
  );
}
