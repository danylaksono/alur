import { describe, expect, it } from 'vitest';
import type { FeatureCollection } from 'geojson';
import {
  escapeXml,
  exportFormatSpec,
  featureCollectionToGeoJsonSeq,
  featureCollectionToGpx,
  featureCollectionToKml,
  featureCollectionToWktCsv,
  geometryToWkt,
  looksProjected,
} from './geoExport';

const collection = (features: FeatureCollection['features']): FeatureCollection => ({
  type: 'FeatureCollection',
  features,
});

const point = (coordinates: [number, number], properties: Record<string, unknown> = {}) => ({
  type: 'Feature' as const,
  geometry: { type: 'Point' as const, coordinates },
  properties,
});

/** DuckDB can return rows whose geometry failed to parse; the types cannot say so. */
const noGeometry = (properties: Record<string, unknown> = {}) =>
  ({ type: 'Feature', geometry: null, properties }) as unknown as FeatureCollection['features'][number];

describe('exportFormatSpec', () => {
  it('keeps the formats saved in existing projects working', () => {
    expect(exportFormatSpec('parquet').extension).toBe('parquet');
    expect(exportFormatSpec('geojson').needsGeometry).toBe(true);
  });

  it('falls back to GeoJSON for an unknown id', () => {
    expect(exportFormatSpec('shapefile').id).toBe('geojson');
    expect(exportFormatSpec(undefined).id).toBe('geojson');
  });
});

describe('escapeXml', () => {
  it('escapes markup and strips characters XML cannot carry', () => {
    expect(escapeXml('Ward & "A" <b>')).toBe('Ward &amp; &quot;A&quot; &lt;b&gt;');
    expect(escapeXml('a\u0000b\u001Fc')).toBe('abc');
    expect(escapeXml('keeps\ttabs\nand newlines')).toBe('keeps\ttabs\nand newlines');
  });
});

describe('featureCollectionToKml', () => {
  it('writes a placemark per feature with properties as ExtendedData', () => {
    const kml = featureCollectionToKml(
      collection([point([-1.5, 53.8], { name: 'Site A', need: 42, empty: null })]),
      { documentName: 'Sites' },
    );

    expect(kml).toContain('<kml xmlns="http://www.opengis.net/kml/2.2">');
    expect(kml).toContain('<name>Sites</name>');
    expect(kml).toContain('<name>Site A</name>');
    expect(kml).toContain('<Point><coordinates>-1.5,53.8</coordinates></Point>');
    expect(kml).toContain('<Data name="need"><value>42</value></Data>');
    expect(kml).not.toContain('name="empty"');
  });

  it('closes polygon rings and keeps holes as inner boundaries', () => {
    const kml = featureCollectionToKml(
      collection([
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            // Deliberately unclosed outer ring: KML requires the repeat.
            coordinates: [
              [[0, 0], [1, 0], [1, 1], [0, 1]],
              [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4], [0.2, 0.2]],
            ],
          },
          properties: {},
        },
      ]),
    );

    expect(kml).toContain('<outerBoundaryIs><LinearRing><coordinates>0,0 1,0 1,1 0,1 0,0</coordinates>');
    expect(kml).toContain('<innerBoundaryIs>');
  });

  it('wraps multi-part geometry in a MultiGeometry and names unnamed features', () => {
    const kml = featureCollectionToKml(
      collection([
        {
          type: 'Feature',
          geometry: { type: 'MultiPoint', coordinates: [[0, 0], [1, 1]] },
          properties: {},
        },
      ]),
    );

    expect(kml).toContain('<MultiGeometry><Point>');
    expect(kml).toContain('<name>Feature 1</name>');
  });

  it('skips features with no usable geometry', () => {
    const kml = featureCollectionToKml(
      collection([noGeometry({ name: 'Nowhere' }), point([2, 3], { name: 'Somewhere' })]),
    );

    expect(kml).not.toContain('Nowhere');
    expect(kml.match(/<Placemark>/g)).toHaveLength(1);
  });
});

describe('featureCollectionToGpx', () => {
  it('writes points as waypoints and lines as tracks, waypoints first', () => {
    const { gpx, skipped } = featureCollectionToGpx(
      collection([
        {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
          properties: { name: 'Route' },
        },
        point([-1.5, 53.8], { name: 'Stop' }),
      ]),
    );

    expect(skipped).toBe(0);
    expect(gpx).toContain('<wpt lat="53.8" lon="-1.5">');
    expect(gpx).toContain('<trkpt lat="1" lon="1" />');
    expect(gpx.indexOf('<wpt')).toBeLessThan(gpx.indexOf('<trk>'));
  });

  it('turns polygon rings into closed tracks', () => {
    const { gpx } = featureCollectionToGpx(
      collection([
        {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1]]] },
          properties: {},
        },
      ]),
    );

    expect(gpx.match(/<trkpt/g)).toHaveLength(4);
  });

  it('reports features it could not represent', () => {
    const { skipped } = featureCollectionToGpx(
      collection([noGeometry(), point([1, 2])]),
    );

    expect(skipped).toBe(1);
  });
});

describe('geometryToWkt', () => {
  it('writes each geometry type in the form DuckDB and PostGIS read back', () => {
    expect(geometryToWkt({ type: 'Point', coordinates: [1, 2] })).toBe('POINT (1 2)');
    expect(geometryToWkt({ type: 'Point', coordinates: [1, 2, 3] })).toBe('POINT Z (1 2 3)');
    expect(geometryToWkt({ type: 'LineString', coordinates: [[0, 0], [1, 1]] })).toBe('LINESTRING (0 0, 1 1)');
    expect(geometryToWkt({ type: 'MultiPoint', coordinates: [[0, 0], [1, 1]] })).toBe('MULTIPOINT ((0 0), (1 1))');
    expect(geometryToWkt({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }))
      .toBe('POLYGON ((0 0, 1 0, 1 1, 0 0))');
    expect(geometryToWkt({ type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]] }))
      .toBe('MULTIPOLYGON (((0 0, 1 0, 1 1, 0 0)))');
    expect(geometryToWkt({ type: 'Polygon', coordinates: [] })).toBe('POLYGON EMPTY');
    expect(geometryToWkt(null)).toBe('');
  });
});

describe('featureCollectionToWktCsv', () => {
  it('unions property columns and puts the geometry last', () => {
    const csv = featureCollectionToWktCsv(
      collection([point([1, 2], { name: 'A', need: 3 }), point([4, 5], { name: 'B', extra: 'x, quoted' })]),
    );
    const [header, first, second] = csv.trim().split('\r\n');

    expect(header).toBe('name,need,extra,geometry_wkt');
    expect(first).toBe('A,3,,POINT (1 2)');
    expect(second).toBe('B,,"x, quoted",POINT (4 5)');
  });
});

describe('featureCollectionToGeoJsonSeq', () => {
  it('writes one newline-terminated feature per line', () => {
    const text = featureCollectionToGeoJsonSeq(collection([point([1, 2]), point([3, 4])]));

    expect(text.split('\n').filter(Boolean)).toHaveLength(2);
    expect(JSON.parse(text.split('\n')[0]).geometry.coordinates).toEqual([1, 2]);
    expect(featureCollectionToGeoJsonSeq(collection([]))).toBe('');
  });
});

describe('looksProjected', () => {
  it('spots coordinates that cannot be longitude/latitude', () => {
    expect(looksProjected(collection([point([-1.5, 53.8])]))).toBe(false);
    // British National Grid easting/northing.
    expect(looksProjected(collection([point([429157, 434123])]))).toBe(true);
  });
});
