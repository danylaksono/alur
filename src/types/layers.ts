import type { GeometryKind } from './visualisation';
import type { MvtTileSource } from '../services/duckdb';

export type LayerBounds = [[number, number], [number, number]];

export type LayerField = {
  name: string;
  type: string;
};

export type DuckDbLayerSource = {
  kind: 'duckdb-table' | 'duckdb-query';
  tableName: string;
  originalTableName?: string;
  geometryColumn: string;
  crs: string;
  crsName?: string;
  crsConfidence?: 'high' | 'medium' | 'low';
  crsReason?: string;
  geometryKind: GeometryKind;
  featureIdColumn: string;
  bounds?: LayerBounds;
  fields: LayerField[];
  tileSource: MvtTileSource;
  renderVersion: number;
};

export type LegacyGeoJsonLayerSource = {
  kind: 'legacy-geojson';
  geometryKind: GeometryKind;
  bounds?: LayerBounds;
  fields: LayerField[];
};

export type LayerSource = DuckDbLayerSource | LegacyGeoJsonLayerSource;
