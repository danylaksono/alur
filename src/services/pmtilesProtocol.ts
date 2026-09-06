import * as maplibregl from 'maplibre-gl';

/**
 * Teaches MapLibre to read `pmtiles://` URLs.
 *
 * PMTiles is a single archive served over plain HTTP; the protocol handler
 * fetches only the byte ranges a tile needs, so a whole basemap or dataset can
 * sit on static hosting with no tile server in front of it. Registered lazily
 * and once, the same way the DuckDB MVT protocol is — the library is 370KB and
 * most sessions never open a PMTiles source.
 */
let registration: Promise<void> | null = null;

export const ensurePmtilesProtocol = () => {
  if (!registration) {
    registration = import('pmtiles').then(({ Protocol }) => {
      const protocol = new Protocol();
      maplibregl.addProtocol('pmtiles', protocol.tile);
    });
  }
  return registration;
};

/**
 * Whether an archive holds images or vector tiles.
 *
 * A raster archive can be drawn as-is. A vector one carries named source layers
 * that only a style document knows what to do with, so pointing a raster source
 * at it produces a blank map and no error — worth catching when the source is
 * added rather than leaving someone to wonder why nothing appeared.
 */
export const inspectPmtilesArchive = async (url: string) => {
  const { PMTiles, TileType } = await import('pmtiles');
  const archive = new PMTiles(url.replace(/^pmtiles:\/\//i, ''));
  const header = await archive.getHeader();
  return {
    isRaster: header.tileType !== TileType.Mvt,
    isVector: header.tileType === TileType.Mvt,
    minZoom: header.minZoom,
    maxZoom: header.maxZoom,
  };
};
