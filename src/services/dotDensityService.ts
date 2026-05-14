import { duckdbService } from './duckdb';
import { registerLayerForAnalytics } from './visualAnalyticsService';
import { FEATURE_ID_PROPERTY } from '../types/visualAnalytics';
import { quoteIdentifier } from '../utils/visualFilterSql';

export type DotDensityConfig = {
  field: string;
  dotValue: number;
  color: string;
  radius?: number;
  opacity?: number;
};

const normalizeRows = (rows: any[]) =>
  rows.map((row) => (typeof row?.toJSON === 'function' ? row.toJSON() : row));

export const generateDotDensityGeoJSON = async (
  layer: { id: string; geojson: GeoJSON.FeatureCollection },
  config: DotDensityConfig,
): Promise<GeoJSON.FeatureCollection> => {
  const tableName = await registerLayerForAnalytics(layer);
  const field = quoteIdentifier(config.field);
  const dotValue = Math.max(1, config.dotValue);
  const fidCol = quoteIdentifier(FEATURE_ID_PROPERTY);

  const geomCol = await detectGeometryColumn(tableName);
  if (!geomCol) throw new Error('No geometry column found in layer');

  const nPointsExpr = `GREATEST(1, CAST(TRY_CAST(${field} AS DOUBLE) / ${dotValue} AS INTEGER))`;

  const result = await duckdbService.query(`
    WITH dots AS (
      SELECT
        ${fidCol} AS source_fid,
        UNNEST(ST_Dump(ST_GeneratePoints(${geomCol}, CAST(${nPointsExpr} AS INTEGER)))).geom AS geom
      FROM "${tableName}"
      WHERE TRY_CAST(${field} AS DOUBLE) > 0
    )
    SELECT source_fid, ST_AsGeoJSON(geom) AS geojson_geom FROM dots
  `);

  const rows = normalizeRows(result.toArray());

  return {
    type: 'FeatureCollection',
    features: rows.map((row: any, index: number) => {
      let geometry: GeoJSON.Geometry;
      try {
        geometry = JSON.parse(String(row.geojson_geom));
      } catch {
        geometry = { type: 'Point', coordinates: [0, 0] };
      }
      return {
        type: 'Feature',
        id: `dot-${layer.id}-${index}`,
        geometry,
        properties: {
          [FEATURE_ID_PROPERTY]: `dot-${layer.id}-${index}`,
          source_layer: layer.id,
          source_fid: row.source_fid,
        },
      };
    }),
  };
};

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
