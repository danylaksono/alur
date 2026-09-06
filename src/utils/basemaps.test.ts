import { describe, expect, it } from 'vitest';
import {
  basemapStyleFromUrl,
  defaultTileSourceName,
  detectTileSourceKind,
  getBasemap,
  type BasemapDefinition,
} from './basemaps';

describe('detectTileSourceKind', () => {
  it('reads an XYZ template from its placeholders', () => {
    expect(detectTileSourceKind('https://tile.example.com/{z}/{x}/{y}.png')).toBe('xyz');
  });

  it('reads WMS from the request parameters, in any case', () => {
    expect(detectTileSourceKind('https://gis.gov/wms?SERVICE=WMS&LAYERS=roads')).toBe('wms');
    expect(detectTileSourceKind('https://gis.gov/ows?request=GetMap&layers=a')).toBe('wms');
  });

  it('reads PMTiles from the extension or the protocol', () => {
    expect(detectTileSourceKind('https://data.example.com/basemap.pmtiles')).toBe('pmtiles');
    expect(detectTileSourceKind('pmtiles://https://data.example.com/x.pmtiles')).toBe('pmtiles');
  });

  it('treats anything else as a style document', () => {
    expect(detectTileSourceKind('https://basemaps.cartocdn.com/gl/positron-gl-style/style.json')).toBe('style');
  });

  it('prefers PMTiles over WMS when a pmtiles URL also carries query parameters', () => {
    expect(detectTileSourceKind('https://x.com/a.pmtiles?service=wms')).toBe('pmtiles');
  });
});

describe('basemapStyleFromUrl', () => {
  it('passes a style document straight through', () => {
    const url = 'https://example.com/style.json';
    expect(basemapStyleFromUrl(url)).toBe(url);
  });

  it('wraps an XYZ template in a single raster layer', () => {
    const style = basemapStyleFromUrl('https://tile.example.com/{z}/{x}/{y}.png') as any;
    expect(style.version).toBe(8);
    expect(style.sources['custom-raster'].tiles).toEqual(['https://tile.example.com/{z}/{x}/{y}.png']);
    expect(style.layers[0].type).toBe('raster');
  });

  it('fills in the WMS request and leaves MapLibre the bounding box', () => {
    const style = basemapStyleFromUrl('https://gis.gov/wms?service=WMS&layers=roads') as any;
    const url: string = style.sources['custom-raster'].tiles[0];
    expect(url).toContain('bbox={bbox-epsg-3857}');
    expect(url).toContain('request=GetMap');
    expect(url).toContain('layers=roads');
    // Both spellings, so the caller need not know which WMS version applies.
    expect(url).toContain('crs=EPSG%3A3857');
    expect(url).toContain('srs=EPSG%3A3857');
  });

  it('does not overwrite parameters the caller already set', () => {
    const style = basemapStyleFromUrl(
      'https://gis.gov/wms?service=WMS&version=1.1.1&format=image/jpeg',
    ) as any;
    const url: string = style.sources['custom-raster'].tiles[0];
    expect(url).toContain('version=1.1.1');
    expect(url).toContain('format=image%2Fjpeg');
  });

  it('gives a bare PMTiles archive a tile template through the protocol', () => {
    const style = basemapStyleFromUrl('https://data.example.com/base.pmtiles') as any;
    expect(style.sources['custom-raster'].tiles[0]).toBe(
      'pmtiles://https://data.example.com/base.pmtiles/{z}/{x}/{y}',
    );
  });

  it('does not double the protocol prefix when the URL already has one', () => {
    const style = basemapStyleFromUrl('pmtiles://https://data.example.com/base.pmtiles') as any;
    expect(style.sources['custom-raster'].tiles[0]).toBe(
      'pmtiles://https://data.example.com/base.pmtiles/{z}/{x}/{y}',
    );
  });

  it('passes a PMTiles-backed style document through as a URL', () => {
    const url = 'https://example.com/protomaps.json';
    expect(basemapStyleFromUrl(url, 'pmtiles')).toBe(url);
  });
});

describe('defaultTileSourceName', () => {
  it('names a PMTiles archive after the file', () => {
    expect(defaultTileSourceName('https://data.example.com/tiles/london.pmtiles')).toBe('london');
  });

  it('falls back to the host and kind for a bare endpoint', () => {
    expect(defaultTileSourceName('https://www.tiles.gov/{z}/{x}/{y}.png')).toBe('tiles.gov XYZ');
  });

  it('survives a URL it cannot parse', () => {
    expect(defaultTileSourceName('not a url')).toMatch(/^Custom /);
  });
});

describe('getBasemap', () => {
  const custom: BasemapDefinition = {
    id: 'custom-1',
    name: 'Council WMS',
    description: '',
    style: 'https://example.com/style.json',
    custom: { url: 'https://example.com/style.json', kind: 'style' },
  };

  it('finds a user-added source alongside the built-ins', () => {
    expect(getBasemap('custom-1', [custom]).name).toBe('Council WMS');
  });

  it('falls back to the first built-in when an id is gone', () => {
    expect(getBasemap('custom-removed', []).id).toBe('positron');
  });
});
