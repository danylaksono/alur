import type { MapLayer } from '../store/useStore';
import type { GeometryKind } from '../types/visualisation';
import type { MvtTileSource } from '../services/duckdb';
import type { LayerBounds, LayerField } from '../types/layers';

export const isDuckDbBackedLayer = (layer: MapLayer | null | undefined) =>
  layer?.source.kind === 'duckdb-table' || layer?.source.kind === 'duckdb-query';

export const mvtSourceForLayer = (layer: MapLayer): MvtTileSource | undefined =>
  layer.source.kind === 'duckdb-table' || layer.source.kind === 'duckdb-query'
    ? layer.source.tileSource
    : layer.tileSource;

export const geometryKindForSource = (layer: MapLayer): GeometryKind =>
  layer.source.geometryKind;

export const boundsForLayer = (layer: MapLayer): LayerBounds | undefined =>
  layer.source.bounds;

export const fieldsForLayer = (layer: MapLayer): LayerField[] =>
  layer.source.fields;

export const tableNameForLayer = (layer: MapLayer) =>
  layer.source.kind === 'duckdb-table' || layer.source.kind === 'duckdb-query'
    ? layer.source.tableName
    : null;

