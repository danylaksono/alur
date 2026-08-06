import { duckdbService } from './duckdb';
import {
  FEATURE_ID_PROPERTY,
  type KpiResult,
  type KpiSpec,
  type CohortComparisonResult,
  type CohortSpec,
  type LayerAnalyticsSummary,
  type SelectionDivergence,
  type SelectionExplanation,
  type VisualChartResult,
  type VisualChartSpec,
  type VisualFilter,
  type VisualScatterResult,
  type VisualTemporalResult,
} from '../types/visualAnalytics';
import { compileVisualFilterPredicate, compileVisualFiltersWhereClause, quoteIdentifier } from '../utils/visualFilterSql';
import { visualFilterKey } from '../utils/visualFilters';
import { CATEGORICAL_PALETTE, CATEGORICAL_PALETTE_META, getPalette } from '../utils/palettes';
import type { MapLayer } from '../store/useStore';
import type { FieldProfile } from '../utils/classification';
import { buildComputedRelation, type ComputedField } from '../utils/fieldCalculator';
import { chooseTimeGrain, enumerateTimeBuckets, temporalBucketKey } from '../utils/temporalChart';
import type { DatasetFieldProfile, DatasetGeometryProfile, DatasetProfile, DatasetProfileIssue } from '../types/datasets';
import { metadataForLayer } from '../utils/datasetMetadata';
import { boundsForLayer } from '../utils/layerSource';
import { coordinateExtent } from '../utils/extent';
import { analyticalQueryClient, analyticalQueryKey } from './analyticalQueryClient';

type AnalyticsLayer = { id: string; source?: MapLayer['source']; geojson?: GeoJSON.FeatureCollection };

const tableNameForLayer = (layerId: string) => `visual_layer_${layerId.replace(/[^a-zA-Z0-9_]/g, '_')}`;

const registeredLayerTables = new Map<string, string>();
const registrationLocks = new Map<string, Promise<void>>();
const kpiQueryCache = new Map<string, Promise<KpiResult>>();
const datasetProfileCache = new Map<string, Promise<DatasetProfile>>();

const toRows = (layer: { id: string; geojson: GeoJSON.FeatureCollection }) =>
  layer.geojson.features.map((feature, index) => ({
    _feature: index + 1,
    ...(feature.properties || {}),
  }));

const normalizeRows = (rows: any[]) =>
  rows.map((row) => (typeof row?.toJSON === 'function' ? row.toJSON() : row));

export const analyticsTableForLayer = async (layer: AnalyticsLayer) => {
  if (layer.source?.kind === 'duckdb-table' || layer.source?.kind === 'duckdb-query') {
    // The map renders from this table and promotes __alur_mvt_id as its feature ID.
    // Querying it here keeps table row identity exactly aligned with MapLibre.
    return layer.source.tileSource?.tableName || layer.source.tableName;
  }
  return registerLayerForAnalytics({ id: layer.id, geojson: layer.geojson || { type: 'FeatureCollection', features: [] } });
};

export const queryLayerFeatureDetails = async (layer: AnalyticsLayer, featureId: string) => {
  if (!layer.source || layer.source.kind === 'legacy-geojson') {
    const feature = layer.geojson?.features.find((item) => (
      String(item.properties?.[FEATURE_ID_PROPERTY] ?? item.id ?? '') === featureId
    ));
    return feature?.properties ? { ...feature.properties } : null;
  }

  const tableName = layer.source.tileSource.tableName;
  const idColumn = layer.source.featureIdColumn;
  const escapedId = featureId.replace(/'/g, "''");
  const result = await duckdbService.query(
    `SELECT * EXCLUDE (__alur_tile_geom)
     FROM "${tableName.replace(/"/g, '""')}"
     WHERE CAST(${quoteIdentifier(idColumn)} AS VARCHAR) = '${escapedId}'
     LIMIT 1;`,
  );
  const row = normalizeRows(result.toArray())[0];
  if (!row) return null;
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => !key.startsWith('__alur_')),
  );
};

const geometryCoordinates = (geometry: GeoJSON.Geometry | null): number[][] => {
  if (!geometry) return [];
  if (geometry.type === 'GeometryCollection') return geometry.geometries.flatMap(geometryCoordinates);
  const flatten = (value: unknown): number[][] => {
    if (!Array.isArray(value)) return [];
    if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
      return [[Number(value[0]), Number(value[1])]];
    }
    return value.flatMap(flatten);
  };
  return flatten(geometry.coordinates);
};

export const queryLayerSelectionBounds = async (
  layer: AnalyticsLayer,
  featureIds: string[],
): Promise<[[number, number], [number, number]] | null> => {
  const selected = new Set(featureIds.map(String));
  if (!selected.size) return null;

  if (!layer.source || layer.source.kind === 'legacy-geojson') {
    const coordinates = (layer.geojson?.features || [])
      .filter((feature) => selected.has(String(feature.properties?.[FEATURE_ID_PROPERTY] ?? feature.id ?? '')))
      .flatMap((feature) => geometryCoordinates(feature.geometry));
    if (!coordinates.length) return null;
    return coordinateExtent(coordinates);
  }

  const values = [...selected].slice(0, 5000).map((id) => `'${id.replace(/'/g, "''")}'`).join(', ');
  const tableName = layer.source.tileSource.tableName;
  const result = await duckdbService.query(`
    WITH extent AS (
      SELECT ST_Extent_Agg(ST_Transform(__alur_tile_geom, 'EPSG:3857', 'EPSG:4326', true)) AS bbox
      FROM "${tableName.replace(/"/g, '""')}"
      WHERE CAST(__alur_mvt_id AS VARCHAR) IN (${values})
    )
    SELECT ST_XMin(bbox) AS min_x, ST_YMin(bbox) AS min_y,
           ST_XMax(bbox) AS max_x, ST_YMax(bbox) AS max_y
    FROM extent WHERE bbox IS NOT NULL;
  `);
  const raw = result.toArray()[0];
  const row = typeof raw?.toJSON === 'function' ? raw.toJSON() : raw;
  const bounds = [Number(row?.min_x), Number(row?.min_y), Number(row?.max_x), Number(row?.max_y)];
  if (!bounds.every(Number.isFinite)) return null;
  return [[bounds[0], bounds[1]], [bounds[2], bounds[3]]];
};

const analyticsFieldsForLayer = (layer: Pick<AnalyticsLayer, 'source' | 'geojson'>) => {
  if (layer.source?.kind === 'duckdb-table' || layer.source?.kind === 'duckdb-query') {
    return layer.source.fields.map((field) => field.name);
  }
  return Object.keys(layer.geojson?.features[0]?.properties || {})
    .filter((key) => key !== FEATURE_ID_PROPERTY);
};

const layerSignature = (layer: { id: string; geojson: GeoJSON.FeatureCollection }) => {
  const features = layer.geojson.features;
  const firstId = features[0]?.properties?.[FEATURE_ID_PROPERTY] ?? features[0]?.id ?? '';
  const lastId = features.at(-1)?.properties?.[FEATURE_ID_PROPERTY] ?? features.at(-1)?.id ?? '';
  return `${features.length}:${String(firstId)}:${String(lastId)}`;
};

export const registerLayerForAnalytics = async (layer: { id: string; geojson: GeoJSON.FeatureCollection }) => {
  const tableName = tableNameForLayer(layer.id);
  const signature = layerSignature(layer);
  if (registeredLayerTables.get(tableName) === signature) {
    return tableName;
  }

  const existingLock = registrationLocks.get(tableName);
  if (existingLock) {
    await existingLock;
    if (registeredLayerTables.get(tableName) === signature) return tableName;
  }

  const lock = (async () => {
    try {
      await duckdbService.registerJsonRows(tableName, toRows(layer));
      registeredLayerTables.set(tableName, signature);
    } catch (err) {
      registeredLayerTables.delete(tableName);
      throw err;
    } finally {
      registrationLocks.delete(tableName);
    }
  })();

  registrationLocks.set(tableName, lock);
  await lock;

  if (registeredLayerTables.get(tableName) !== signature) {
    throw new Error(`Failed to register layer table ${tableName}`);
  }

  return tableName;
};

export const clearLayerAnalyticsCache = (layerId?: string) => {
  if (!layerId) {
    registeredLayerTables.clear();
    kpiQueryCache.clear();
    datasetProfileCache.clear();
    analyticalQueryClient.clear();
    return;
  }
  registeredLayerTables.delete(tableNameForLayer(layerId));
  [...kpiQueryCache.keys()].filter((key) => key.startsWith(`${layerId}:`)).forEach((key) => kpiQueryCache.delete(key));
  [...datasetProfileCache.keys()].filter((key) => key.startsWith(`${layerId}:`)).forEach((key) => datasetProfileCache.delete(key));
  analyticalQueryClient.invalidateDataset(layerId);
};

export const queryLayerRows = async ({
  layer,
  filters,
  search,
  sortBy,
  sortDirection,
  pageIndex,
  pageSize,
  computedFields = [],
}: {
  layer: AnalyticsLayer;
  filters: VisualFilter[];
  search: string;
  sortBy: string | null;
  sortDirection: 'asc' | 'desc';
  pageIndex: number;
  pageSize: number;
  computedFields?: ComputedField[];
}) => {
  const tableName = await analyticsTableForLayer(layer);
  const relation = buildComputedRelation(`"${tableName}"`, computedFields);
  const searchableColumns = [
    ...analyticsFieldsForLayer(layer).filter((key) => key !== FEATURE_ID_PROPERTY),
    ...computedFields.map((field) => field.name),
  ];
  const filterClause = compileVisualFiltersWhereClause(filters);
  const normalizedSearch = search.trim();
  const searchPredicate = normalizedSearch && searchableColumns.length
    ? `(${searchableColumns.map((column) => `CAST(${quoteIdentifier(column)} AS VARCHAR) ILIKE '%${normalizedSearch.replace(/'/g, "''")}%'`).join(' OR ')})`
    : '';
  const predicates = [filterClause.replace(/^WHERE\s+/, ''), searchPredicate].filter(Boolean);
  const whereClause = predicates.length ? `WHERE ${predicates.join(' AND ')}` : '';
  const sortClause = sortBy ? `ORDER BY ${quoteIdentifier(sortBy)} ${sortDirection.toUpperCase()} NULLS LAST` : '';
  const offset = pageIndex * pageSize;

  const [countResult, rowsResult] = await Promise.all([
    duckdbService.query(`SELECT COUNT(*) AS row_count FROM ${relation} ${whereClause};`),
    duckdbService.query(`SELECT * FROM ${relation} ${whereClause} ${sortClause} LIMIT ${pageSize} OFFSET ${offset};`),
  ]);
  const countRaw = normalizeRows(countResult.toArray())[0] || {};

  return {
    rows: normalizeRows(rowsResult.toArray()),
    total: Number(countRaw.row_count ?? countRaw.count_star ?? 0),
  };
};

export const queryLayerColumnProfile = async ({
  layer,
  filters,
  column,
  computedFields = [],
}: {
  layer: AnalyticsLayer;
  filters: VisualFilter[];
  column: string;
  computedFields?: ComputedField[];
}) => {
  const tableName = await analyticsTableForLayer(layer);
  const relation = buildComputedRelation(`"${tableName}"`, computedFields);
  const whereClause = compileVisualFiltersWhereClause(filters);
  const field = quoteIdentifier(column);
  const totalResult = await duckdbService.query(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN ${field} IS NULL THEN 1 ELSE 0 END) AS null_count FROM ${relation} ${whereClause};`
  );
  const totalRaw = normalizeRows(totalResult.toArray())[0] || {};
  const total = Number(totalRaw.total ?? 0);
  const nullCount = Number(totalRaw.null_count ?? 0);

  const statsResult = await duckdbService.query(
    `SELECT MIN(TRY_CAST(${field} AS DOUBLE)) AS min_value, MAX(TRY_CAST(${field} AS DOUBLE)) AS max_value, COUNT(TRY_CAST(${field} AS DOUBLE)) AS numeric_count, COUNT(${field}) AS non_null_count FROM ${relation} ${whereClause};`
  );
  const stats = normalizeRows(statsResult.toArray())[0] || {};
  const min = Number(stats.min_value);
  const max = Number(stats.max_value);
  const numericCount = Number(stats.numeric_count ?? 0);
  const nonNullCount = Number(stats.non_null_count ?? 0);

  if (numericCount > 0 && numericCount >= nonNullCount * 0.8 && Number.isFinite(min) && Number.isFinite(max)) {
    const binCount = 12;
    const width = max === min ? 1 : (max - min) / binCount;
    const bucketExpr = max === min
      ? '0'
      : `LEAST(${binCount - 1}, CAST(FLOOR((TRY_CAST(${field} AS DOUBLE) - ${min}) / ${width || 1}) AS INTEGER))`;
    const andOrWhere = whereClause ? `${whereClause} AND` : 'WHERE';
    const binsResult = await duckdbService.query(
      `SELECT ${bucketExpr} AS bucket, COUNT(*) AS count FROM ${relation} ${andOrWhere} ${field} IS NOT NULL GROUP BY bucket ORDER BY bucket;`
    );
    const binMap = new Map<number, number>();
    normalizeRows(binsResult.toArray()).forEach((row) => {
      binMap.set(Number(row.bucket), Number(row.count));
    });
    return {
      column,
      kind: 'numeric' as const,
      total,
      nullCount,
      min,
      max,
      bins: Array.from({ length: binCount }, (_, index) => ({
        label: `${(min + width * index).toPrecision(3)}-${(min + width * (index + 1)).toPrecision(3)}`,
        min: min + width * index,
        max: min + width * (index + 1),
        count: binMap.get(index) || 0,
      })),
    };
  }

  const andOrWhere = whereClause ? `${whereClause} AND` : 'WHERE';
  const binsResult = await duckdbService.query(
    `SELECT CAST(${field} AS VARCHAR) AS label, COUNT(*) AS count FROM ${relation} ${andOrWhere} ${field} IS NOT NULL GROUP BY label ORDER BY count DESC LIMIT 12;`
  );
  return {
    column,
    kind: 'categorical' as const,
    total,
    nullCount,
    bins: normalizeRows(binsResult.toArray()).map((row) => ({
      label: String(row.label),
      value: String(row.label),
      count: Number(row.count),
    })),
  };
};

const layerSearchWhereClause = (
  layer: AnalyticsLayer,
  filters: VisualFilter[],
  search: string,
  computedFields: ComputedField[],
) => {
  const searchableColumns = [
    ...analyticsFieldsForLayer(layer).filter((key) => key !== FEATURE_ID_PROPERTY),
    ...computedFields.map((field) => field.name),
  ];
  const normalizedSearch = search.trim();
  const searchPredicate = normalizedSearch && searchableColumns.length
    ? `(${searchableColumns.map((column) => `CAST(${quoteIdentifier(column)} AS VARCHAR) ILIKE '%${normalizedSearch.replace(/'/g, "''")}%'`).join(' OR ')})`
    : '';
  const predicates = [compileVisualFiltersWhereClause(filters).replace(/^WHERE\s+/, ''), searchPredicate].filter(Boolean);
  return predicates.length ? `WHERE ${predicates.join(' AND ')}` : '';
};

export const queryLayerFeatureIds = async ({
  layer,
  filters,
  search,
  computedFields = [],
}: {
  layer: AnalyticsLayer;
  filters: VisualFilter[];
  search: string;
  computedFields?: ComputedField[];
}) => {
  const tableName = await analyticsTableForLayer(layer);
  const relation = buildComputedRelation(`"${tableName}"`, computedFields);
  const whereClause = layerSearchWhereClause(layer, filters, search, computedFields);
  const idColumn = layer.source?.kind === 'duckdb-table' || layer.source?.kind === 'duckdb-query'
    ? layer.source.featureIdColumn
    : FEATURE_ID_PROPERTY;
  const result = await duckdbService.query(
    `SELECT CAST(${quoteIdentifier(idColumn)} AS VARCHAR) AS feature_id FROM ${relation} ${whereClause};`,
  );
  return normalizeRows(result.toArray()).map((row) => String(row.feature_id)).filter(Boolean);
};

export const buildLayerExportSql = async ({
  layer,
  filters,
  search,
  sortBy,
  sortDirection,
  computedFields = [],
}: {
  layer: AnalyticsLayer;
  filters: VisualFilter[];
  search: string;
  sortBy: string | null;
  sortDirection: 'asc' | 'desc';
  computedFields?: ComputedField[];
}) => {
  const tableName = await analyticsTableForLayer(layer);
  const relation = buildComputedRelation(`"${tableName}"`, computedFields);
  const whereClause = layerSearchWhereClause(layer, filters, search, computedFields);
  const sortClause = sortBy ? `ORDER BY ${quoteIdentifier(sortBy)} ${sortDirection.toUpperCase()} NULLS LAST` : '';
  const excludeGeometry = layer.source?.kind === 'duckdb-table' || layer.source?.kind === 'duckdb-query'
    ? 'EXCLUDE (__alur_tile_geom)'
    : '';
  return `SELECT * ${excludeGeometry} FROM ${relation} ${whereClause} ${sortClause}`;
};

export const materializeLayerSelection = async ({
  layer,
  featureIds,
  computedFields = [],
  outputTableName,
}: {
  layer: AnalyticsLayer;
  featureIds: string[];
  computedFields?: ComputedField[];
  outputTableName: string;
}) => {
  if (!layer.source || layer.source.kind === 'legacy-geojson') return null;
  const tableName = await analyticsTableForLayer(layer);
  const relation = buildComputedRelation(`"${tableName}"`, computedFields);
  if (!featureIds.length) return null;
  const safeTableName = outputTableName.replace(/[^a-zA-Z0-9_]/g, '_');
  const idTableName = `__alur_ids_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  await duckdbService.registerJsonRows(idTableName, [...new Set(featureIds)].map((featureId) => ({ feature_id: String(featureId) })));
  try {
    await duckdbService.materializeQueryAsTable(
      `SELECT source_rows.* FROM ${relation} AS source_rows INNER JOIN "${idTableName}" AS selected_ids ON CAST(source_rows.${quoteIdentifier(layer.source.featureIdColumn)} AS VARCHAR) = selected_ids.feature_id`,
      safeTableName,
    );
  } finally {
    await duckdbService.query(`DROP TABLE IF EXISTS "${idTableName}";`).catch(() => undefined);
  }
  const source = await duckdbService.prepareLayerSource(safeTableName, { kind: 'duckdb-query', originalTableName: safeTableName });
  if (!source) return null;
  return { source, featureCount: await duckdbService.getTableFeatureCount(safeTableName) };
};

const kpiAggregateExpression = (spec: KpiSpec, predicate?: string) => {
  const filter = predicate ? ` FILTER (WHERE ${predicate})` : '';
  if (spec.aggregation === 'count' || !spec.field) return `COUNT(*)${filter}`;
  const field = `TRY_CAST(${quoteIdentifier(spec.field)} AS DOUBLE)`;
  const fn = spec.aggregation.toUpperCase();
  return `${fn}(${field})${filter}`;
};

const kpiSourceVersion = (layer: AnalyticsLayer) => {
  if (layer.source?.kind === 'duckdb-table' || layer.source?.kind === 'duckdb-query') {
    return `${layer.source.tableName}:${layer.source.renderVersion}`;
  }
  if (layer.geojson) return layerSignature({ id: layer.id, geojson: layer.geojson });
  return 'unknown';
};

export const queryLayerKpi = async ({
  layer,
  filters,
  spec,
  selectedFeatureIds = [],
}: {
  layer: AnalyticsLayer;
  filters: VisualFilter[];
  spec: KpiSpec;
  selectedFeatureIds?: string[];
}): Promise<KpiResult> => {
  const key = `${layer.id}:${kpiSourceVersion(layer)}:${JSON.stringify(filters)}:${selectedFeatureIds.join('|')}:${JSON.stringify(spec)}`;
  const cached = kpiQueryCache.get(key);
  if (cached) return cached;
  if (kpiQueryCache.size >= 100) kpiQueryCache.clear();

  const promise = analyticalQueryClient.run({
    key: analyticalQueryKey('kpi', { datasetId: layer.id, sourceVersion: kpiSourceVersion(layer), filters, selectedFeatureIds, spec }),
    datasetId: layer.id,
  }, async () => {
    const tableName = await analyticsTableForLayer(layer);
    const table = `"${tableName.replace(/"/g, '""')}"`;
    const predicate = filters.map(compileVisualFilterPredicate).filter((item): item is string => Boolean(item)).join(' AND ');
    let comparisonPredicate: string | undefined;
    let comparisonNote: string | undefined;
    if (spec.comparison === 'previous-period') {
      const window = filters.find((filter): filter is Extract<VisualFilter, { kind: 'temporal' }> => filter.kind === 'temporal' && Boolean(filter.start && filter.end));
      const start = window?.start ? new Date(window.start).getTime() : Number.NaN;
      const end = window?.end ? new Date(window.end).getTime() : Number.NaN;
      if (window && Number.isFinite(start) && Number.isFinite(end) && end >= start) {
        const duration = end - start + 1;
        const previousEnd = start - 1;
        const previousStart = previousEnd - duration + 1;
        const otherFilters = filters.filter((filter) => filter !== window).map(compileVisualFilterPredicate).filter((item): item is string => Boolean(item));
        const field = `TRY_CAST(${quoteIdentifier(window.field)} AS TIMESTAMP)`;
        comparisonPredicate = [...otherFilters, `${field} >= TRY_CAST(${sqlString(new Date(previousStart).toISOString())} AS TIMESTAMP)`, `${field} <= TRY_CAST(${sqlString(new Date(previousEnd).toISOString())} AS TIMESTAMP)`].join(' AND ');
      } else {
        comparisonNote = 'Apply a bounded temporal filter to compare with the preceding period.';
      }
    } else if (spec.comparison === 'cohort') {
      if (selectedFeatureIds.length) {
        comparisonPredicate = selectedWhereClause(selectedFeatureIds.slice(0, 25_000), featureIdColumnForLayer(layer)).replace(/^WHERE\s+/, '');
      } else {
        comparisonNote = 'Select records to use the current selection as a comparison cohort.';
      }
    }
    const comparisonExpression = spec.comparison === 'total'
      ? kpiAggregateExpression(spec)
      : comparisonPredicate
        ? kpiAggregateExpression(spec, comparisonPredicate)
        : 'NULL';
    const result = await duckdbService.query(
      `SELECT ${kpiAggregateExpression(spec, predicate)} AS active_value,
              ${kpiAggregateExpression(spec)} AS total_value,
              ${comparisonExpression} AS comparison_value,
              ${predicate ? `COUNT(*) FILTER (WHERE ${predicate})` : 'COUNT(*)'} AS active_rows,
              COUNT(*) AS total_rows
       FROM ${table};`,
    );
    const row = normalizeRows(result.toArray())[0] || {};
    const finiteOrNull = (value: unknown) => {
      if (value === null || value === undefined) return null;
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    };
    const value = finiteOrNull(row.active_value);
    const comparisonValue = spec.comparison === 'none' ? null : finiteOrNull(row.comparison_value);
    const comparisonAvailable = spec.comparison !== 'none' && comparisonValue !== null;
    const delta = comparisonAvailable && value !== null && comparisonValue !== null && comparisonValue !== 0
      ? (value - comparisonValue) / Math.abs(comparisonValue)
      : null;
    if (comparisonAvailable && comparisonValue === 0) comparisonNote = 'Delta is unavailable because the comparison value is zero.';
    return {
      specId: spec.id,
      value,
      comparisonValue,
      delta,
      activeRows: Number(row.active_rows ?? 0),
      totalRows: Number(row.total_rows ?? 0),
      comparisonAvailable,
      comparisonNote,
    };
  }).catch((error) => {
    kpiQueryCache.delete(key);
    throw error;
  });
  kpiQueryCache.set(key, promise);
  return promise;
};

export const queryTableKpi = async ({
  tableName,
  rowIdColumn,
  filters,
  spec,
  selectedFeatureIds = [],
}: {
  tableName: string;
  rowIdColumn: string;
  filters: VisualFilter[];
  spec: KpiSpec;
  selectedFeatureIds?: string[];
}): Promise<KpiResult> => {
  const key = `table:${tableName}:${rowIdColumn}:${JSON.stringify(filters)}:${selectedFeatureIds.join('|')}:${JSON.stringify(spec)}`;
  const cached = kpiQueryCache.get(key);
  if (cached) return cached;
  if (kpiQueryCache.size >= 100) kpiQueryCache.clear();
  const promise = analyticalQueryClient.run({
    key: analyticalQueryKey('kpi', { tableName, rowIdColumn, filters, selectedFeatureIds, spec }),
    datasetId: spec.datasetId || `table:${tableName}`,
  }, async () => {
    const table = `"${tableName.replace(/"/g, '""')}"`;
    const predicate = filters.map(compileVisualFilterPredicate).filter((item): item is string => Boolean(item)).join(' AND ');
    let comparisonPredicate: string | undefined;
    let comparisonNote: string | undefined;
    if (spec.comparison === 'previous-period') {
      const window = filters.find((filter): filter is Extract<VisualFilter, { kind: 'temporal' }> => filter.kind === 'temporal' && Boolean(filter.start && filter.end));
      const start = window?.start ? new Date(window.start).getTime() : Number.NaN;
      const end = window?.end ? new Date(window.end).getTime() : Number.NaN;
      if (window && Number.isFinite(start) && Number.isFinite(end) && end >= start) {
        const duration = end - start + 1;
        const previousEnd = start - 1;
        const previousStart = previousEnd - duration + 1;
        const otherFilters = filters.filter((filter) => filter !== window).map(compileVisualFilterPredicate).filter((item): item is string => Boolean(item));
        const field = `TRY_CAST(${quoteIdentifier(window.field)} AS TIMESTAMP)`;
        comparisonPredicate = [...otherFilters, `${field} >= TRY_CAST(${sqlString(new Date(previousStart).toISOString())} AS TIMESTAMP)`, `${field} <= TRY_CAST(${sqlString(new Date(previousEnd).toISOString())} AS TIMESTAMP)`].join(' AND ');
      } else comparisonNote = 'Apply a bounded temporal filter to compare with the preceding period.';
    } else if (spec.comparison === 'cohort') {
      if (selectedFeatureIds.length) comparisonPredicate = selectedWhereClause(selectedFeatureIds.slice(0, 25_000), rowIdColumn).replace(/^WHERE\s+/, '');
      else comparisonNote = 'Select records to use the current selection as a comparison cohort.';
    }
    const comparisonExpression = spec.comparison === 'total'
      ? kpiAggregateExpression(spec)
      : comparisonPredicate ? kpiAggregateExpression(spec, comparisonPredicate) : 'NULL';
    const result = await duckdbService.query(
      `SELECT ${kpiAggregateExpression(spec, predicate)} AS active_value,
              ${kpiAggregateExpression(spec)} AS total_value,
              ${comparisonExpression} AS comparison_value,
              ${predicate ? `COUNT(*) FILTER (WHERE ${predicate})` : 'COUNT(*)'} AS active_rows,
              COUNT(*) AS total_rows
       FROM ${table};`,
    );
    const row = normalizeRows(result.toArray())[0] || {};
    const finite = (value: unknown) => value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value);
    const value = finite(row.active_value);
    const comparisonValue = spec.comparison === 'none' ? null : finite(row.comparison_value);
    const comparisonAvailable = spec.comparison !== 'none' && comparisonValue !== null;
    const delta = comparisonAvailable && value !== null && comparisonValue !== 0 ? (value - comparisonValue!) / Math.abs(comparisonValue!) : null;
    if (comparisonAvailable && comparisonValue === 0) comparisonNote = 'Delta is unavailable because the comparison value is zero.';
    return { specId: spec.id, value, comparisonValue, delta, activeRows: Number(row.active_rows ?? 0), totalRows: Number(row.total_rows ?? 0), comparisonAvailable, comparisonNote };
  }).catch((error) => { kpiQueryCache.delete(key); throw error; });
  kpiQueryCache.set(key, promise);
  return promise;
};

export const __kpiQueryCacheSizeForTests = () => kpiQueryCache.size;

const numberList = (value: unknown) => {
  const source = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && 'toArray' in value && typeof (value as { toArray?: unknown }).toArray === 'function'
      ? (value as { toArray: () => unknown[] }).toArray()
      : [];
  return source.map(Number).filter(Number.isFinite);
};

export const queryLayerDatasetProfile = async (layer: MapLayer): Promise<DatasetProfile> => {
  const key = `${layer.id}:${kpiSourceVersion(layer)}`;
  const cached = datasetProfileCache.get(key);
  if (cached) return cached;
  if (datasetProfileCache.size >= 24) datasetProfileCache.clear();

  const promise = analyticalQueryClient.run({
    key: analyticalQueryKey('dataset-profile', { datasetId: layer.id, sourceVersion: kpiSourceVersion(layer) }),
    datasetId: layer.id,
  }, async () => {
    const metadata = metadataForLayer(layer);
    const tableName = await analyticsTableForLayer(layer);
    const table = `"${tableName.replace(/"/g, '""')}"`;
    const expressions = ['COUNT(*) AS profile_row_count'];
    metadata.fields.forEach((field, index) => {
      const column = quoteIdentifier(field.name);
      expressions.push(`COUNT(*) FILTER (WHERE ${column} IS NULL) AS p${index}_nulls`);
      expressions.push(`${layer.featureCount <= 100_000 ? 'COUNT(DISTINCT ' : 'APPROX_COUNT_DISTINCT('}${column}) AS p${index}_distinct`);
      if (field.semanticType === 'numeric') {
        const numeric = `TRY_CAST(${column} AS DOUBLE)`;
        expressions.push(`MIN(${numeric}) AS p${index}_min`);
        expressions.push(`MAX(${numeric}) AS p${index}_max`);
        expressions.push(`AVG(${numeric}) AS p${index}_mean`);
        expressions.push(`APPROX_QUANTILE(${numeric}, [0.0, 0.25, 0.5, 0.75, 1.0]) AS p${index}_quantiles`);
      } else if (field.semanticType === 'temporal') {
        const temporal = `TRY_CAST(${column} AS TIMESTAMP)`;
        expressions.push(`MIN(${temporal}) AS p${index}_start`);
        expressions.push(`MAX(${temporal}) AS p${index}_end`);
      }
    });
    const result = await duckdbService.query(`SELECT ${expressions.join(', ')} FROM ${table};`);
    const row = normalizeRows(result.toArray())[0] || {};
    const rowCount = Number(row.profile_row_count ?? layer.featureCount ?? 0);
    const fields: DatasetFieldProfile[] = metadata.fields.map((field, index) => {
      const nullCount = Number(row[`p${index}_nulls`] ?? 0);
      const profile: DatasetFieldProfile = {
        ...field,
        nullCount,
        nullPercent: rowCount > 0 ? nullCount / rowCount : 0,
        distinctCount: Number(row[`p${index}_distinct`] ?? 0),
      };
      if (field.semanticType === 'numeric') {
        const finite = (value: unknown) => value === null || value === undefined || !Number.isFinite(Number(value)) ? undefined : Number(value);
        profile.min = finite(row[`p${index}_min`]);
        profile.max = finite(row[`p${index}_max`]);
        profile.mean = finite(row[`p${index}_mean`]);
        profile.quantiles = numberList(row[`p${index}_quantiles`]);
      } else if (field.semanticType === 'temporal') {
        profile.temporalStart = dateIso(row[`p${index}_start`]) || undefined;
        profile.temporalEnd = dateIso(row[`p${index}_end`]) || undefined;
      }
      return profile;
    });

    const issues: DatasetProfileIssue[] = [];
    fields.forEach((field) => {
      if (field.nullPercent >= 0.25) issues.push({
        id: `missing-${field.name}`,
        severity: field.nullPercent >= 0.5 ? 'warning' : 'info',
        field: field.name,
        message: `${field.name} is missing for ${(field.nullPercent * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}% of rows. Confirm whether this is expected.`,
        action: 'filter-missing',
      });
      const nonNull = Math.max(0, rowCount - field.nullCount);
      if (field.semanticType === 'identifier' && nonNull > 0 && field.distinctCount < nonNull) issues.push({
        id: `duplicate-${field.name}`,
        severity: 'warning',
        field: field.name,
        message: `${field.name} has ${(nonNull - field.distinctCount).toLocaleString()} repeated non-null values and may not be a unique identifier.`,
        action: 'inspect-identifiers',
      });
      if (field.semanticType === 'categorical' && field.distinctCount > 50) issues.push({
        id: `cardinality-${field.name}`,
        severity: 'info',
        field: field.name,
        message: `${field.name} has ${field.distinctCount.toLocaleString()} distinct values; use search or top-N grouping for readable categories.`,
        action: 'inspect-field',
      });
    });

    const sample = layer.geojson?.features.slice(0, 200) || [];
    let sampledFeatures = sample.length;
    let sampledValid = sample.filter((feature) => Boolean(feature.geometry)).length;
    if ((layer.source.kind === 'duckdb-table' || layer.source.kind === 'duckdb-query') && layer.source.geometryColumn) {
      try {
        const geometry = quoteIdentifier(layer.source.geometryColumn);
        const validityResult = await duckdbService.query(
          `SELECT COUNT(*) AS sample_count,
                  COUNT(*) FILTER (WHERE ${geometry} IS NOT NULL AND ST_IsValid(${geometry})) AS valid_count
           FROM (SELECT ${geometry} FROM ${table} LIMIT 200) AS geometry_sample;`,
        );
        const validity = normalizeRows(validityResult.toArray())[0] || {};
        sampledFeatures = Number(validity.sample_count ?? 0);
        sampledValid = Number(validity.valid_count ?? 0);
      } catch {
        // Geometry validity is an optional progressive signal; core field profiling remains usable.
      }
    }
    if (sampledFeatures && sampledValid < sampledFeatures) issues.push({
      id: 'missing-geometry',
      severity: 'warning',
      message: `${(sampledFeatures - sampledValid).toLocaleString()} of ${sampledFeatures.toLocaleString()} sampled features have missing or invalid geometry.`,
      action: 'inspect-geometry',
    });
    const declaredCrs = layer.source.kind === 'duckdb-table' || layer.source.kind === 'duckdb-query' ? layer.source.crs : undefined;
    const crsConfidence: DatasetGeometryProfile['crsConfidence'] = layer.source.kind === 'duckdb-table' || layer.source.kind === 'duckdb-query'
      ? layer.source.crsConfidence || (declaredCrs ? 'medium' : 'unknown')
      : layer.geojson ? 'assumed' : 'unknown';
    return {
      datasetId: layer.id,
      rowCount,
      fieldCount: fields.length,
      generatedAt: Date.now(),
      fields,
      geometry: {
        kind: layer.source.geometryKind,
        crs: declaredCrs || 'EPSG:4326',
        extent: boundsForLayer(layer),
        crsConfidence,
        sampledFeatures,
        sampledValid,
      },
      issues,
    };
  }).catch((error) => {
    datasetProfileCache.delete(key);
    throw error;
  });
  datasetProfileCache.set(key, promise);
  return promise;
};

export const __datasetProfileCacheSizeForTests = () => datasetProfileCache.size;

const aggregationExpression = (chart: VisualChartSpec, filterPredicate?: string) => {
  const filterSuffix = filterPredicate ? ` FILTER (WHERE ${filterPredicate})` : '';
  if (chart.aggregation === 'count' || !chart.measureField) return `COUNT(*)${filterSuffix}`;

  const field = `TRY_CAST(${quoteIdentifier(chart.measureField)} AS DOUBLE)`;
  if (chart.aggregation === 'sum') return `COALESCE(SUM(${field})${filterSuffix}, 0)`;
  if (chart.aggregation === 'avg') return `COALESCE(AVG(${field})${filterSuffix}, 0)`;
  if (chart.aggregation === 'min') return `COALESCE(MIN(${field})${filterSuffix}, 0)`;
  return `COALESCE(MAX(${field})${filterSuffix}, 0)`;
};

const chartPalette = (chart: VisualChartSpec, count: number) => {
  if (chart.type === 'histogram') {
    const palette = getPalette(chart.paletteId).colors;
    return Array.from({ length: count }, (_, index) => palette[Math.min(palette.length - 1, Math.floor((index / Math.max(1, count - 1)) * (palette.length - 1)))]);
  }

  const sequential = getPalette(chart.paletteId, CATEGORICAL_PALETTE_META).colors;
  const source = chart.paletteId === 'categorical' ? CATEGORICAL_PALETTE : sequential;
  return Array.from({ length: count }, (_, index) => source[index % source.length]);
};

const featureIdColumnForLayer = (layer: AnalyticsLayer) => {
  if (layer.source?.kind === 'duckdb-table' || layer.source?.kind === 'duckdb-query') {
    return layer.source.featureIdColumn || FEATURE_ID_PROPERTY;
  }
  return FEATURE_ID_PROPERTY;
};

const tableColumnNames = async (tableName: string) => {
  const schema = await duckdbService.getTableSchema(tableName);
  return new Set(normalizeRows(schema.toArray()).map((row) => String(row.name || '')));
};

const chartTableForLayer = async (layer: AnalyticsLayer, chart: VisualChartSpec) => {
  const tableName = await analyticsTableForLayer(layer);
  const featureIdColumn = featureIdColumnForLayer(layer);
  const requiredColumns = [
    chart.dimensionField,
    ...(chart.aggregation !== 'count' && chart.measureField ? [chart.measureField] : []),
    ...(chart.seriesField ? [chart.seriesField] : []),
  ].filter(Boolean);

  if (!layer.source || layer.source.kind === 'legacy-geojson') {
    return {
      tableName,
      featureIdExpression: quoteIdentifier(FEATURE_ID_PROPERTY),
    };
  }

  if ((layer.source?.kind === 'duckdb-table' || layer.source?.kind === 'duckdb-query') && layer.source.tileSource?.tableName) {
    try {
      const tileColumns = await tableColumnNames(layer.source.tileSource.tableName);
      const tileHasRequiredFields = requiredColumns.every((column) => tileColumns.has(column));
      if (tileHasRequiredFields && tileColumns.has(featureIdColumn)) {
        return {
          tableName: layer.source.tileSource.tableName,
          featureIdExpression: quoteIdentifier(featureIdColumn),
        };
      }
    } catch {
      // Fall through to the analytic source table below.
    }
  }

  try {
    const sourceColumns = await tableColumnNames(tableName);
    if (sourceColumns.has(featureIdColumn)) {
      return {
        tableName,
        featureIdExpression: quoteIdentifier(featureIdColumn),
      };
    }
  } catch {
    // If schema inspection fails, let the main chart query surface the data error.
  }

  return {
    tableName,
    featureIdExpression: 'NULL',
  };
};

const featureIdsFromValue = (value: unknown) =>
  String(value ?? '')
    .split('\u001f')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 200);

export const visualChartFilterKey = visualFilterKey;

export type ChartFacet = { field: string; value: string };

const facetPredicate = (facet: ChartFacet | undefined) =>
  facet
    ? `CAST(${quoteIdentifier(facet.field)} AS VARCHAR) = '${facet.value.replace(/'/g, "''")}'`
    : '';

export const queryLayerChart = async ({
  layer,
  filters,
  chart,
  facet,
}: {
  layer: AnalyticsLayer;
  filters: VisualFilter[];
  chart: VisualChartSpec;
  facet?: ChartFacet;
}): Promise<VisualChartResult> => {
  const { tableName, featureIdExpression } = await chartTableForLayer(layer, chart);
  return analyticalQueryClient.run({
    key: analyticalQueryKey('chart', { datasetId: layer.id, sourceVersion: kpiSourceVersion(layer), filters, chart, facet }),
    datasetId: layer.id,
  }, () => runChartQuery({ tableName, featureIdExpression, filters, chart, facet }));
};

/** Chart an arbitrary DuckDB dataset with the same cross-filter semantics as a layer. */
export const queryTableChart = async ({
  tableName,
  chart,
  facet,
  filters = [],
  rowIdColumn,
}: {
  tableName: string;
  chart: VisualChartSpec;
  facet?: ChartFacet;
  filters?: VisualFilter[];
  rowIdColumn?: string;
}): Promise<VisualChartResult> =>
  analyticalQueryClient.run({
    key: analyticalQueryKey('chart', { tableName, rowIdColumn, filters, chart, facet }),
    datasetId: chart.source && 'datasetId' in chart.source ? chart.source.datasetId : `table:${tableName}`,
  }, () => runChartQuery({ tableName, featureIdExpression: rowIdColumn ? quoteIdentifier(rowIdColumn) : 'NULL', filters, chart, facet }));

const sqlString = (value: string) => `'${value.replace(/'/g, "''")}'`;

const dateIso = (value: unknown) => {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

const runTemporalChartQuery = async ({
  tableName,
  filters,
  chart,
}: {
  tableName: string;
  filters: VisualFilter[];
  chart: VisualChartSpec;
}): Promise<VisualTemporalResult> => {
  const table = `"${tableName.replace(/"/g, '""')}"`;
  const field = quoteIdentifier(chart.dimensionField);
  const timestamp = `TRY_CAST(${field} AS TIMESTAMP)`;
  const whereClause = compileVisualFiltersWhereClause(filters);
  const contextPredicate = filters
    .filter((filter) => filter.field !== chart.dimensionField)
    .map(compileVisualFilterPredicate)
    .filter((item): item is string => Boolean(item))
    .join(' AND ');
  const [totalResult, filteredResult, extentResult] = await Promise.all([
    duckdbService.query(`SELECT COUNT(*) AS row_count FROM ${table};`),
    duckdbService.query(`SELECT COUNT(*) AS row_count FROM ${table} ${whereClause};`),
    duckdbService.query(`SELECT MIN(${timestamp}) AS min_date, MAX(${timestamp}) AS max_date FROM ${table};`),
  ]);
  const totalRows = Number(normalizeRows(totalResult.toArray())[0]?.row_count ?? 0);
  const filteredRows = Number(normalizeRows(filteredResult.toArray())[0]?.row_count ?? 0);
  const extent = normalizeRows(extentResult.toArray())[0] || {};
  const minDate = dateIso(extent.min_date);
  const maxDate = dateIso(extent.max_date);
  const requestedGrain = chart.timeGrain || 'auto';
  const grain = chooseTimeGrain(minDate || '', maxDate || '', requestedGrain);
  if (!minDate || !maxDate) {
    return { chartId: chart.id, grain, totalRows, filteredRows, minDate: '', maxDate: '', series: [], hasOtherSeries: false };
  }

  const seriesLimit = Math.max(2, Math.min(8, chart.maxCategories || 6));
  let seriesLabels = ['All'];
  let hasOtherSeries = false;
  let seriesExpression = sqlString('All');
  if (chart.seriesField) {
    const seriesField = quoteIdentifier(chart.seriesField);
    const rawSeries = `COALESCE(CAST(${seriesField} AS VARCHAR), 'Missing')`;
    const topResult = await duckdbService.query(
      `SELECT ${rawSeries} AS series FROM ${table}
       GROUP BY series ORDER BY COUNT(*) DESC, series LIMIT ${seriesLimit + 1};`,
    );
    const ranked = normalizeRows(topResult.toArray()).map((row) => String(row.series));
    const top = ranked.slice(0, seriesLimit);
    hasOtherSeries = ranked.length > seriesLimit;
    seriesLabels = [...top, ...(hasOtherSeries ? ['Other'] : [])];
    if (!seriesLabels.length) seriesLabels = ['Missing'];
    seriesExpression = hasOtherSeries
      ? `CASE WHEN ${rawSeries} IN (${top.map(sqlString).join(', ')}) THEN ${rawSeries} ELSE 'Other' END`
      : rawSeries;
  }

  const totalAggregate = aggregationExpression(chart);
  const aggregate = contextPredicate ? aggregationExpression(chart, contextPredicate) : totalAggregate;
  const filteredCount = contextPredicate ? `COUNT(*) FILTER (WHERE ${contextPredicate})` : 'COUNT(*)';
  const result = await duckdbService.query(
    `SELECT DATE_TRUNC('${grain}', ${timestamp}) AS bucket,
            ${seriesExpression} AS series,
            COUNT(*) AS total_count, ${totalAggregate} AS total_value,
            ${filteredCount} AS count_value, ${aggregate} AS aggregate_value
     FROM ${table}
     WHERE ${timestamp} IS NOT NULL
     GROUP BY bucket, series
     ORDER BY bucket, series;`,
  );
  const rowMap = new Map<string, Record<string, unknown>>();
  normalizeRows(result.toArray()).forEach((row) => {
    const bucket = temporalBucketKey(row.bucket, grain);
    if (bucket) rowMap.set(`${bucket}\u001f${String(row.series)}`, row);
  });
  const buckets = enumerateTimeBuckets(minDate, maxDate, grain);
  const colors = chartPalette(chart, seriesLabels.length);
  return {
    chartId: chart.id,
    grain,
    totalRows,
    filteredRows,
    minDate,
    maxDate,
    hasOtherSeries,
    series: seriesLabels.map((label, seriesIndex) => ({
      key: label,
      label,
      color: colors[seriesIndex],
      points: buckets.map((bucket) => {
        const row = rowMap.get(`${bucket.start}\u001f${label}`);
        const hasObservation = Boolean(row);
        return {
          bucketStart: bucket.start,
          bucketEnd: bucket.end,
          label: bucket.label,
          value: hasObservation ? Number(row?.aggregate_value ?? row?.count_value ?? 0) : null,
          count: hasObservation ? Number(row?.count_value ?? 0) : 0,
          totalValue: hasObservation ? Number(row?.total_value ?? 0) : null,
          totalCount: hasObservation ? Number(row?.total_count ?? 0) : 0,
        };
      }),
    })),
  };
};

export const queryLayerTemporalChart = async ({
  layer,
  filters,
  chart,
}: {
  layer: AnalyticsLayer;
  filters: VisualFilter[];
  chart: VisualChartSpec;
}): Promise<VisualTemporalResult> => {
  const { tableName } = await chartTableForLayer(layer, chart);
  return analyticalQueryClient.run({
    key: analyticalQueryKey('temporal-chart', { datasetId: layer.id, sourceVersion: kpiSourceVersion(layer), filters, chart }),
    datasetId: layer.id,
  }, () => runTemporalChartQuery({ tableName, filters, chart }));
};

export const queryTableTemporalChart = async ({
  tableName,
  chart,
  filters = [],
}: {
  tableName: string;
  chart: VisualChartSpec;
  filters?: VisualFilter[];
}): Promise<VisualTemporalResult> => analyticalQueryClient.run({
  key: analyticalQueryKey('temporal-chart', { tableName, filters, chart }),
  datasetId: chart.source && 'datasetId' in chart.source ? chart.source.datasetId : `table:${tableName}`,
}, () => runTemporalChartQuery({ tableName, filters, chart }));

/** Top facet values (by row count) for a small-multiples chart. */
export const queryChartFacetValues = async ({
  layer,
  tableName,
  facetField,
  limit = 6,
}: {
  layer?: AnalyticsLayer;
  tableName?: string;
  facetField: string;
  limit?: number;
}): Promise<string[]> => {
  const resolved = tableName ?? (layer ? await analyticsTableForLayer(layer) : null);
  if (!resolved) return [];
  const field = quoteIdentifier(facetField);
  const result = await duckdbService.query(
    `SELECT CAST(${field} AS VARCHAR) AS value FROM "${resolved.replace(/"/g, '""')}"
     WHERE ${field} IS NOT NULL
     GROUP BY value ORDER BY COUNT(*) DESC, value
     LIMIT ${Math.max(1, Math.min(12, limit))};`
  );
  return normalizeRows(result.toArray()).map((row) => String(row.value));
};

const runChartQuery = async ({
  tableName,
  featureIdExpression,
  filters,
  chart,
  facet,
}: {
  tableName: string;
  featureIdExpression: string;
  filters: VisualFilter[];
  chart: VisualChartSpec;
  facet?: ChartFacet;
}): Promise<VisualChartResult> => {
  const table = `"${tableName.replace(/"/g, '""')}"`;
  const facetWhere = facetPredicate(facet);
  const whereClause = compileVisualFiltersWhereClause(filters);
  const field = quoteIdentifier(chart.dimensionField);

  // Crossfilter semantics: a chart ignores filters on its own dimension so the
  // full distribution stays visible while brushing; other charts' filters apply.
  const contextPredicate = filters
    .filter((filter) => filter.field !== chart.dimensionField)
    .map(compileVisualFilterPredicate)
    .filter((item): item is string => Boolean(item))
    .join(' AND ');
  const totalAggregate = aggregationExpression(chart);
  const aggregate = contextPredicate ? aggregationExpression(chart, contextPredicate) : totalAggregate;
  const filteredCountExpr = contextPredicate ? `COUNT(*) FILTER (WHERE ${contextPredicate})` : 'COUNT(*)';
  const featureIdFilterSuffix = contextPredicate ? ` FILTER (WHERE ${contextPredicate})` : '';

  const combinedPredicates = [whereClause.replace(/^WHERE\s+/, ''), facetWhere].filter(Boolean).join(' AND ');
  const [totalResult, filteredResult] = await Promise.all([
    duckdbService.query(`SELECT COUNT(*) AS row_count FROM ${table} ${facetWhere ? `WHERE ${facetWhere}` : ''};`),
    duckdbService.query(`SELECT COUNT(*) AS row_count FROM ${table} ${combinedPredicates ? `WHERE ${combinedPredicates}` : ''};`),
  ]);
  const totalRaw = normalizeRows(totalResult.toArray())[0] || {};
  const filteredRaw = normalizeRows(filteredResult.toArray())[0] || {};

  if (chart.type === 'histogram') {
    // Bin over the unfiltered extent so bins stay stable while brushing and filtering.
    const statsResult = await duckdbService.query(
      `SELECT MIN(TRY_CAST(${field} AS DOUBLE)) AS min_value, MAX(TRY_CAST(${field} AS DOUBLE)) AS max_value
       FROM ${table};`
    );
    const stats = normalizeRows(statsResult.toArray())[0] || {};
    const min = Number(stats.min_value);
    const max = Number(stats.max_value);
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return {
        chartId: chart.id,
        totalRows: Number(totalRaw.row_count ?? 0),
        filteredRows: Number(filteredRaw.row_count ?? 0),
        data: [],
      };
    }

    const binCount = Math.max(4, Math.min(24, chart.maxCategories || 12));
    const width = max === min ? 1 : (max - min) / binCount;
    const bucketExpr = max === min
      ? '0'
      : `LEAST(${binCount - 1}, CAST(FLOOR((TRY_CAST(${field} AS DOUBLE) - ${min}) / ${width || 1}) AS INTEGER))`;
    const result = await duckdbService.query(
      `SELECT ${bucketExpr} AS bucket,
              COUNT(*) AS total_count, ${totalAggregate} AS total_value,
              ${filteredCountExpr} AS count_value, ${aggregate} AS aggregate_value,
              STRING_AGG(CAST(${featureIdExpression} AS VARCHAR), '\u001f')${featureIdFilterSuffix} AS feature_ids
       FROM ${table} WHERE TRY_CAST(${field} AS DOUBLE) IS NOT NULL${facetWhere ? ` AND ${facetWhere}` : ''}
       GROUP BY bucket
       ORDER BY bucket;`
    );
    const rows = normalizeRows(result.toArray());
    const colors = chartPalette(chart, binCount);
    const rowMap = new Map<number, any>();
    rows.forEach((row) => rowMap.set(Number(row.bucket), row));

    return {
      chartId: chart.id,
      totalRows: Number(totalRaw.row_count ?? 0),
      filteredRows: Number(filteredRaw.row_count ?? 0),
      data: Array.from({ length: binCount }, (_, index) => {
        const row = rowMap.get(index) || {};
        const from = min + width * index;
        const to = min + width * (index + 1);
        const label = `${from.toLocaleString(undefined, { maximumFractionDigits: 2 })}-${to.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
        const value = Number(row.aggregate_value ?? row.count_value ?? 0);
        const count = Number(row.count_value ?? 0);
        return {
          key: `bin-${index}`,
          label,
          value,
          count,
          totalValue: Number(row.total_value ?? value),
          totalCount: Number(row.total_count ?? count),
          color: colors[index],
          filter: { kind: 'range' as const, field: chart.dimensionField, min: from, max: to },
          featureIds: featureIdsFromValue(row.feature_ids),
        };
      }),
    };
  }

  const limit = Math.max(3, Math.min(30, chart.maxCategories || 8));
  // Order and limit by the unfiltered series so categories keep stable
  // positions (and don't pop in and out) as linked filters change.
  const result = await duckdbService.query(
    `SELECT CAST(${field} AS VARCHAR) AS label,
            COUNT(*) AS total_count, ${totalAggregate} AS total_value,
            ${filteredCountExpr} AS count_value, ${aggregate} AS aggregate_value,
            STRING_AGG(CAST(${featureIdExpression} AS VARCHAR), '\u001f')${featureIdFilterSuffix} AS feature_ids
     FROM ${table} WHERE ${field} IS NOT NULL${facetWhere ? ` AND ${facetWhere}` : ''}
     GROUP BY label
     ORDER BY total_value DESC, total_count DESC
     LIMIT ${limit};`
  );
  const rows = normalizeRows(result.toArray());
  const colors = chartPalette(chart, rows.length);

  return {
    chartId: chart.id,
    totalRows: Number(totalRaw.row_count ?? 0),
    filteredRows: Number(filteredRaw.row_count ?? 0),
    data: rows.map((row, index) => {
      const label = String(row.label);
      const value = Number(row.aggregate_value ?? row.count_value ?? 0);
      const count = Number(row.count_value ?? 0);
      return {
        key: label,
        label,
        value,
        count,
        totalValue: Number(row.total_value ?? value),
        totalCount: Number(row.total_count ?? count),
        color: colors[index],
        filter: { kind: 'category' as const, field: chart.dimensionField, values: [label] },
        featureIds: featureIdsFromValue(row.feature_ids),
      };
    }),
  };
};

const SCATTER_MAX_POINTS = 12000;

export const queryLayerScatter = async ({
  layer,
  filters,
  chart,
}: {
  layer: AnalyticsLayer;
  filters: VisualFilter[];
  chart: VisualChartSpec;
}): Promise<VisualScatterResult> => {
  // Force the measure field into the required-column check regardless of aggregation.
  const { tableName } = await chartTableForLayer(layer, { ...chart, aggregation: 'avg' });
  return analyticalQueryClient.run({
    key: analyticalQueryKey('scatter-chart', { datasetId: layer.id, sourceVersion: kpiSourceVersion(layer), filters, chart }),
    datasetId: layer.id,
  }, () => runScatterQuery({ tableName, filters, chart }));
};

/** Scatter over an arbitrary DuckDB table — see queryTableChart. */
export const queryTableScatter = async ({
  tableName,
  chart,
  filters = [],
}: {
  tableName: string;
  chart: VisualChartSpec;
  filters?: VisualFilter[];
}): Promise<VisualScatterResult> =>
  analyticalQueryClient.run({
    key: analyticalQueryKey('scatter-chart', { tableName, filters, chart }),
    datasetId: chart.source && 'datasetId' in chart.source ? chart.source.datasetId : `table:${tableName}`,
  }, () => runScatterQuery({ tableName, filters, chart }));

const runScatterQuery = async ({
  tableName,
  filters,
  chart,
}: {
  tableName: string;
  filters: VisualFilter[];
  chart: VisualChartSpec;
}): Promise<VisualScatterResult> => {
  if (!chart.measureField) {
    throw new Error('Scatter charts need a Y field');
  }
  const table = `"${tableName.replace(/"/g, '""')}"`;
  const x = `TRY_CAST(${quoteIdentifier(chart.dimensionField)} AS DOUBLE)`;
  const y = `TRY_CAST(${quoteIdentifier(chart.measureField)} AS DOUBLE)`;

  // Crossfilter semantics: exclude filters on the scatter's own axes so points
  // never vanish under the chart's own brush; other charts' filters colour points.
  const contextPredicate = filters
    .filter((filter) => filter.field !== chart.dimensionField && filter.field !== chart.measureField)
    .map(compileVisualFilterPredicate)
    .filter((item): item is string => Boolean(item))
    .join(' AND ');
  const whereClause = compileVisualFiltersWhereClause(filters);

  const [totalResult, filteredResult, extentResult] = await Promise.all([
    duckdbService.query(`SELECT COUNT(*) AS row_count FROM ${table};`),
    duckdbService.query(`SELECT COUNT(*) AS row_count FROM ${table} ${whereClause};`),
    duckdbService.query(
      `SELECT MIN(${x}) AS x_min, MAX(${x}) AS x_max, MIN(${y}) AS y_min, MAX(${y}) AS y_max, COUNT(*) AS point_count
       FROM ${table} WHERE ${x} IS NOT NULL AND ${y} IS NOT NULL;`
    ),
  ]);
  const totalRaw = normalizeRows(totalResult.toArray())[0] || {};
  const filteredRaw = normalizeRows(filteredResult.toArray())[0] || {};
  const extent = normalizeRows(extentResult.toArray())[0] || {};
  const pointCount = Number(extent.point_count ?? 0);
  const base = {
    chartId: chart.id,
    totalRows: Number(totalRaw.row_count ?? 0),
    filteredRows: Number(filteredRaw.row_count ?? 0),
  };

  const xMin = Number(extent.x_min);
  const xMax = Number(extent.x_max);
  const yMin = Number(extent.y_min);
  const yMax = Number(extent.y_max);
  if (!pointCount || ![xMin, xMax, yMin, yMax].every(Number.isFinite)) {
    return { ...base, sampled: false, points: [], xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
  }

  const sampled = pointCount > SCATTER_MAX_POINTS;
  // REPEATABLE keeps the sample stable across refetches so points don't jump while brushing.
  const sampleClause = sampled ? ` USING SAMPLE reservoir(${SCATTER_MAX_POINTS} ROWS) REPEATABLE (7)` : '';
  const result = await duckdbService.query(
    `SELECT ${x} AS x, ${y} AS y,
            ${contextPredicate ? `CASE WHEN ${contextPredicate} THEN 1 ELSE 0 END` : '1'} AS in_ctx
     FROM ${table} WHERE ${x} IS NOT NULL AND ${y} IS NOT NULL${sampleClause};`
  );
  const points = normalizeRows(result.toArray())
    .map((row) => ({
      x: Number(row.x),
      y: Number(row.y),
      inContext: (Number(row.in_ctx) ? 1 : 0) as 0 | 1,
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

  return { ...base, sampled, points, xMin, xMax, yMin, yMax };
};

export type TemporalRange = {
  field: string;
  minDate: string;
  maxDate: string;
  rowCount: number;
};

export const queryLayerTemporalRange = async ({
  layer,
  column,
}: {
  layer: AnalyticsLayer;
  column: string;
}): Promise<TemporalRange | null> => {
  const tableName = await analyticsTableForLayer(layer);
  const field = quoteIdentifier(column);
  const result = await duckdbService.query(
    `SELECT
      MIN(TRY_CAST(${field} AS DATE)) AS min_date,
      MAX(TRY_CAST(${field} AS DATE)) AS max_date,
      COUNT(TRY_CAST(${field} AS DATE)) AS date_count
    FROM "${tableName}"
    WHERE TRY_CAST(${field} AS DATE) IS NOT NULL;`
  );
  const raw = normalizeRows(result.toArray())[0] || {};
  const dateCount = Number(raw.date_count ?? 0);
  if (!dateCount || !raw.min_date || !raw.max_date) return null;

  const minDate = typeof raw.min_date === 'object' && raw.min_date && typeof (raw.min_date as any).toISOString === 'function'
    ? (raw.min_date as Date).toISOString().slice(0, 10)
    : String(raw.min_date).slice(0, 10);
  const maxDate = typeof raw.max_date === 'object' && raw.max_date && typeof (raw.max_date as any).toISOString === 'function'
    ? (raw.max_date as Date).toISOString().slice(0, 10)
    : String(raw.max_date).slice(0, 10);

  return { field: column, minDate, maxDate, rowCount: dateCount };
};

const selectedWhereClause = (selectedFeatureIds: string[], field = FEATURE_ID_PROPERTY) => {
  if (!selectedFeatureIds.length) return '';
  const values = selectedFeatureIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(', ');
  return `WHERE CAST(${quoteIdentifier(field)} AS VARCHAR) IN (${values})`;
};

const candidateColumns = (layer: Pick<AnalyticsLayer, 'source' | 'geojson'>) =>
  analyticsFieldsForLayer(layer)
    .filter((key) => ![FEATURE_ID_PROPERTY, 'geojson', 'geometry', 'geom', 'wkb_geometry', '__alur_tile_geom'].includes(key.toLowerCase()))
    .slice(0, 12);

export const queryLayerSummary = async ({
  layer,
  filters,
  selectedFeatureIds,
  summaryFields,
}: {
  layer: AnalyticsLayer;
  filters: VisualFilter[];
  selectedFeatureIds: string[];
  summaryFields?: string[];
}): Promise<LayerAnalyticsSummary> => {
  const tableName = await analyticsTableForLayer(layer);
  const table = `"${tableName.replace(/"/g, '""')}"`;
  const activePredicate = filters.map(compileVisualFilterPredicate).filter((item): item is string => Boolean(item)).join(' AND ') || 'TRUE';
  const selectionWhere = selectedWhereClause(selectedFeatureIds.slice(0, 25_000), featureIdColumnForLayer(layer));
  const selectedPredicate = selectionWhere.replace(/^WHERE\s+/, '') || 'FALSE';
  const countResult = await duckdbService.query(
    `SELECT COUNT(*) AS total_rows,
            COUNT(*) FILTER (WHERE ${activePredicate}) AS active_rows,
            COUNT(*) FILTER (WHERE ${selectedPredicate}) AS selected_rows
     FROM ${table};`,
  );
  const counts = normalizeRows(countResult.toArray())[0] || {};
  const totalRows = Number(counts.total_rows ?? 0);
  const filteredRows = Number(counts.active_rows ?? 0);
  const selectedRows = Number(counts.selected_rows ?? 0);

  const available = candidateColumns(layer);
  const requested = summaryFields?.filter((field) => available.includes(field));
  const columns = requested?.length ? requested.slice(0, 8) : available.slice(0, 5);
  if (!columns.length) return { totalRows, filteredRows, selectedRows, numericMetrics: [], categoryBreakdowns: [] };
  const statsResult = await duckdbService.query(
    `SELECT ${columns.map((column) => `COUNT(TRY_CAST(${quoteIdentifier(column)} AS DOUBLE)) AS ${quoteIdentifier(`${column}__numeric_count`)}, COUNT(${quoteIdentifier(column)}) AS ${quoteIdentifier(`${column}__non_null_count`)}`).join(', ')} FROM ${table};`
  );
  const statsRaw = normalizeRows(statsResult.toArray())[0] || {};
  const numericColumns = columns
    .filter((column) => {
      const numericCount = Number(statsRaw[`${column}__numeric_count`] ?? 0);
      const nonNullCount = Number(statsRaw[`${column}__non_null_count`] ?? 0);
      return numericCount > 0 && numericCount >= nonNullCount * 0.8;
    });
  const categoryColumns = columns
    .filter((column) => !numericColumns.includes(column));

  const numericMetrics = await Promise.all(numericColumns.map(async (field) => {
    const q = quoteIdentifier(field);
    const numeric = `TRY_CAST(${q} AS DOUBLE)`;
    const aggregate = (name: string, expression: string, predicate: string) => `${expression} FILTER (WHERE ${predicate}) AS ${name}`;
    const result = await duckdbService.query(
      `SELECT ${['selected', 'active', 'total'].flatMap((scope) => {
        const predicate = scope === 'selected' ? selectedPredicate : scope === 'active' ? activePredicate : 'TRUE';
        return [
          aggregate(`${scope}_count`, `COUNT(${numeric})`, predicate),
          aggregate(`${scope}_min`, `MIN(${numeric})`, predicate),
          aggregate(`${scope}_max`, `MAX(${numeric})`, predicate),
          aggregate(`${scope}_mean`, `AVG(${numeric})`, predicate),
          aggregate(`${scope}_sum`, `SUM(${numeric})`, predicate),
        ];
      }).join(', ')} FROM ${table};`
    );
    const raw = normalizeRows(result.toArray())[0] || {};
    const valueOrNull = (value: unknown) => {
      if (value === null || value === undefined) return null;
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    };
    const scope = (name: 'selected' | 'active' | 'total') => ({
      count: Number(raw[`${name}_count`] ?? 0),
      min: valueOrNull(raw[`${name}_min`]),
      max: valueOrNull(raw[`${name}_max`]),
      mean: valueOrNull(raw[`${name}_mean`]),
      sum: valueOrNull(raw[`${name}_sum`]),
    });
    return {
      field,
      kind: 'numeric' as const,
      selected: scope('selected'),
      active: scope('active'),
      total: scope('total'),
    };
  }));

  const categoryBreakdowns = await Promise.all(categoryColumns.map(async (field) => {
    const q = quoteIdentifier(field);
    const result = await duckdbService.query(
      `SELECT CAST(${q} AS VARCHAR) AS label,
              COUNT(*) FILTER (WHERE ${selectedPredicate}) AS selected_count,
              COUNT(*) FILTER (WHERE ${activePredicate}) AS active_count,
              COUNT(*) AS total_count
       FROM ${table} WHERE ${q} IS NOT NULL
       GROUP BY label ORDER BY selected_count DESC, active_count DESC, total_count DESC LIMIT 6;`
    );
    return {
      field,
      values: normalizeRows(result.toArray()).map((row) => ({
        label: String(row.label),
        selectedCount: Number(row.selected_count ?? 0),
        activeCount: Number(row.active_count ?? 0),
        totalCount: Number(row.total_count ?? 0),
      })),
    };
  }));

  return {
    totalRows,
    filteredRows,
    selectedRows,
    numericMetrics,
    categoryBreakdowns,
  };
};

const safeCohortTableName = (value: string) => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) throw new Error('The saved selection cohort has an invalid table reference.');
  return value;
};

export const cohortPredicate = (cohort: CohortSpec, featureIdColumn: string) => {
  if (cohort.definition.kind === 'filters') {
    return cohort.definition.filters.map(compileVisualFilterPredicate).filter((item): item is string => Boolean(item)).join(' AND ') || 'TRUE';
  }
  const tableName = safeCohortTableName(cohort.definition.tableName);
  const featureId = quoteIdentifier(featureIdColumn);
  return `EXISTS (SELECT 1 FROM "${tableName}" AS cohort_row WHERE CAST(cohort_row.${featureId} AS VARCHAR) = CAST(base.${featureId} AS VARCHAR))`;
};

const finiteNumberOrNull = (value: unknown) => {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export const queryCohortComparison = async ({
  layer,
  cohortA,
  cohortB,
  compareToRemainder = false,
  remainderFilters = [],
}: {
  layer: MapLayer;
  cohortA: CohortSpec;
  cohortB?: CohortSpec;
  compareToRemainder?: boolean;
  remainderFilters?: VisualFilter[];
}): Promise<CohortComparisonResult> => {
  if (cohortA.datasetId !== layer.id || (cohortB && cohortB.datasetId !== layer.id)) throw new Error('Both cohorts must belong to the selected dataset.');
  if (!cohortB && !compareToRemainder) throw new Error('Choose a second cohort or compare with the remainder.');
  const tableName = await analyticsTableForLayer(layer);
  const table = `"${tableName.replace(/"/g, '""')}"`;
  const idColumn = featureIdColumnForLayer(layer);
  const predicateA = cohortPredicate(cohortA, idColumn);
  const activePredicate = remainderFilters.map(compileVisualFilterPredicate).filter((item): item is string => Boolean(item)).join(' AND ') || 'TRUE';
  const predicateB = compareToRemainder ? `(${activePredicate}) AND NOT (${predicateA})` : cohortPredicate(cohortB!, idColumn);
  const countResult = await duckdbService.query(
    `SELECT COUNT(*) AS total_rows,
            COUNT(*) FILTER (WHERE ${predicateA}) AS a_rows,
            COUNT(*) FILTER (WHERE ${predicateB}) AS b_rows,
            COUNT(*) FILTER (WHERE (${predicateA}) AND (${predicateB})) AS overlap_rows
     FROM ${table} AS base;`,
  );
  const countRow = normalizeRows(countResult.toArray())[0] || {};
  const totalRows = Number(countRow.total_rows ?? 0);
  const aRows = Number(countRow.a_rows ?? 0);
  const bRows = Number(countRow.b_rows ?? 0);
  const overlapRows = Number(countRow.overlap_rows ?? 0);
  const metadata = metadataForLayer(layer);
  const numericFields = metadata.fields.filter((field) => field.semanticType === 'numeric').slice(0, 4);
  const categoricalFields = metadata.fields.filter((field) => ['categorical', 'boolean'].includes(field.semanticType)).slice(0, 3);
  const temporalField = metadata.fields.find((field) => field.semanticType === 'temporal');

  const numeric = await Promise.all(numericFields.map(async ({ name: field }) => {
    const numericValue = `TRY_CAST(${quoteIdentifier(field)} AS DOUBLE)`;
    const statsResult = await duckdbService.query(
      `SELECT
        COUNT(${numericValue}) FILTER (WHERE ${predicateA}) AS a_count,
        COUNT(${numericValue}) FILTER (WHERE ${predicateB}) AS b_count,
        AVG(${numericValue}) FILTER (WHERE ${predicateA}) AS a_mean,
        AVG(${numericValue}) FILTER (WHERE ${predicateB}) AS b_mean,
        STDDEV_SAMP(${numericValue}) FILTER (WHERE ${predicateA}) AS a_sd,
        STDDEV_SAMP(${numericValue}) FILTER (WHERE ${predicateB}) AS b_sd,
        MIN(${numericValue}) FILTER (WHERE (${predicateA}) OR (${predicateB})) AS range_min,
        MAX(${numericValue}) FILTER (WHERE (${predicateA}) OR (${predicateB})) AS range_max
       FROM ${table} AS base;`,
    );
    const stats = normalizeRows(statsResult.toArray())[0] || {};
    const aCount = Number(stats.a_count ?? 0);
    const bCount = Number(stats.b_count ?? 0);
    const aMean = finiteNumberOrNull(stats.a_mean);
    const bMean = finiteNumberOrNull(stats.b_mean);
    const aSd = finiteNumberOrNull(stats.a_sd);
    const bSd = finiteNumberOrNull(stats.b_sd);
    const pooledSd = aSd !== null && bSd !== null ? Math.sqrt((aSd * aSd + bSd * bSd) / 2) : null;
    const effectSize = aMean !== null && bMean !== null && pooledSd && pooledSd > 0 ? (aMean - bMean) / pooledSd : null;
    const min = finiteNumberOrNull(stats.range_min);
    const max = finiteNumberOrNull(stats.range_max);
    const binCount = 8;
    const bins = min === null || max === null ? [] : await (async () => {
      const width = max === min ? 1 : (max - min) / binCount;
      const expressions = Array.from({ length: binCount }, (_, index) => {
        const lower = min + width * index;
        const upper = index === binCount - 1 ? max : min + width * (index + 1);
        const range = index === binCount - 1
          ? `${numericValue} >= ${lower} AND ${numericValue} <= ${upper}`
          : `${numericValue} >= ${lower} AND ${numericValue} < ${upper}`;
        return `COUNT(*) FILTER (WHERE (${predicateA}) AND ${range}) AS a_bin_${index}, COUNT(*) FILTER (WHERE (${predicateB}) AND ${range}) AS b_bin_${index}`;
      });
      const result = await duckdbService.query(`SELECT ${expressions.join(', ')} FROM ${table} AS base;`);
      const row = normalizeRows(result.toArray())[0] || {};
      return Array.from({ length: binCount }, (_, index) => {
        const lower = min + width * index;
        const upper = index === binCount - 1 ? max : min + width * (index + 1);
        return { label: `${lower.toLocaleString(undefined, { maximumFractionDigits: 2 })}–${upper.toLocaleString(undefined, { maximumFractionDigits: 2 })}`, aCount: Number(row[`a_bin_${index}`] ?? 0), bCount: Number(row[`b_bin_${index}`] ?? 0) };
      });
    })();
    return { field, aCount, bCount, aMissing: Math.max(0, aRows - aCount), bMissing: Math.max(0, bRows - bCount), aMean, bMean, effectSize, bins };
  }));

  const categorical = await Promise.all(categoricalFields.map(async ({ name: field }) => {
    const column = quoteIdentifier(field);
    const result = await duckdbService.query(
      `SELECT COALESCE(CAST(${column} AS VARCHAR), '∅ Missing') AS label,
              COUNT(*) FILTER (WHERE ${predicateA}) AS a_count,
              COUNT(*) FILTER (WHERE ${predicateB}) AS b_count
       FROM ${table} AS base
       WHERE (${predicateA}) OR (${predicateB})
       GROUP BY label ORDER BY (a_count + b_count) DESC, label LIMIT 10;`,
    );
    return {
      field,
      values: normalizeRows(result.toArray()).map((row) => {
        const aCount = Number(row.a_count ?? 0);
        const bCount = Number(row.b_count ?? 0);
        const aShare = aRows ? aCount / aRows : 0;
        const bShare = bRows ? bCount / bRows : 0;
        return { label: String(row.label), aCount, bCount, aShare, bShare, shareDifference: aShare - bShare };
      }),
    };
  }));

  let temporal: CohortComparisonResult['temporal'];
  if (temporalField) {
    const column = quoteIdentifier(temporalField.name);
    const result = await duckdbService.query(
      `SELECT CAST(DATE_TRUNC('month', TRY_CAST(${column} AS TIMESTAMP)) AS VARCHAR) AS period,
              COUNT(*) FILTER (WHERE ${predicateA}) AS a_count,
              COUNT(*) FILTER (WHERE ${predicateB}) AS b_count
       FROM ${table} AS base
       WHERE TRY_CAST(${column} AS TIMESTAMP) IS NOT NULL AND ((${predicateA}) OR (${predicateB}))
       GROUP BY period ORDER BY period;`,
    );
    temporal = { field: temporalField.name, grain: 'month', points: normalizeRows(result.toArray()).map((row) => ({ period: String(row.period), aCount: Number(row.a_count ?? 0), bCount: Number(row.b_count ?? 0) })) };
  }

  return {
    totalRows,
    aRows,
    bRows,
    overlapRows,
    aOnlyRows: Math.max(0, aRows - overlapRows),
    bOnlyRows: Math.max(0, bRows - overlapRows),
    denominatorNote: compareToRemainder
      ? `B is the current active subset excluding A. The dataset contains ${totalRows.toLocaleString()} rows; overlap is necessarily zero.`
      : `Percentages use each cohort's own row count. ${overlapRows.toLocaleString()} rows belong to both cohorts and are reported in both denominators.`,
    missingValueNote: 'Numeric means and effect sizes exclude missing or non-numeric values; missing counts are reported per cohort. Category shares include missing values as “∅ Missing”.',
    numeric,
    categorical,
    temporal,
  };
};

export const queryLayerFieldProfile = async ({
  layer,
  column,
}: {
  layer: AnalyticsLayer;
  column: string;
}): Promise<FieldProfile> => {
  const tableName = await analyticsTableForLayer(layer);
  const field = quoteIdentifier(column);
  const totalResult = await duckdbService.query(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN ${field} IS NULL THEN 1 ELSE 0 END) AS null_count FROM "${tableName}";`
  );
  const totalRaw = normalizeRows(totalResult.toArray())[0] || {};
  const total = Number(totalRaw.total ?? 0);
  const nullCount = Number(totalRaw.null_count ?? 0);
  const statsResult = await duckdbService.query(
    `SELECT MIN(TRY_CAST(${field} AS DOUBLE)) AS min_value, MAX(TRY_CAST(${field} AS DOUBLE)) AS max_value, COUNT(TRY_CAST(${field} AS DOUBLE)) AS numeric_count, COUNT(${field}) AS non_null_count FROM "${tableName}";`
  );
  const stats = normalizeRows(statsResult.toArray())[0] || {};
  const min = Number(stats.min_value);
  const max = Number(stats.max_value);
  const numericCount = Number(stats.numeric_count ?? 0);
  const nonNullCount = Number(stats.non_null_count ?? 0);

  if (numericCount > 0 && numericCount >= nonNullCount * 0.8 && Number.isFinite(min) && Number.isFinite(max)) {
    const valuesResult = await duckdbService.query(
      `SELECT TRY_CAST(${field} AS DOUBLE) AS value FROM "${tableName}" WHERE TRY_CAST(${field} AS DOUBLE) IS NOT NULL ORDER BY value;`
    );
    const values = normalizeRows(valuesResult.toArray()).map((row) => Number(row.value)).filter(Number.isFinite);
    const binCount = 12;
    const width = max === min ? 1 : (max - min) / binCount;
    const bins = Array.from({ length: binCount }, (_, index) => ({
      label: `${(min + width * index).toPrecision(3)}-${(min + width * (index + 1)).toPrecision(3)}`,
      min: min + width * index,
      max: min + width * (index + 1),
      count: 0,
    }));
    values.forEach((value) => {
      const index = max === min ? 0 : Math.min(binCount - 1, Math.floor((value - min) / (width || 1)));
      bins[index].count += 1;
    });
    return { kind: 'numeric', total, nullCount, min, max, values, bins };
  }

  const categoriesResult = await duckdbService.query(
    `SELECT CAST(${field} AS VARCHAR) AS value, COUNT(*) AS count FROM "${tableName}" WHERE ${field} IS NOT NULL GROUP BY value ORDER BY count DESC LIMIT 12;`
  );
  return {
    kind: 'categorical',
    total,
    nullCount,
    categories: normalizeRows(categoriesResult.toArray()).map((row) => ({
      value: String(row.value),
      count: Number(row.count),
    })),
  };
};

const EXPLAIN_MAX_IDS = 5000;
const EXPLAIN_MAX_NUMERIC_FIELDS = 24;
const EXPLAIN_MAX_CATEGORY_FIELDS = 5;

/**
 * Rank a layer's attributes by how strongly the selected features differ from
 * the rest: standardized mean difference for numeric fields, total variation
 * distance over the top categories for categorical fields.
 */
export const explainLayerSelection = async ({
  layer,
  selectedFeatureIds,
}: {
  layer: AnalyticsLayer;
  selectedFeatureIds: string[];
}): Promise<SelectionExplanation | null> => {
  if (selectedFeatureIds.length < 2) return null;

  const tableName = await analyticsTableForLayer(layer);
  const table = `"${tableName.replace(/"/g, '""')}"`;
  const fidColumn = quoteIdentifier(featureIdColumnForLayer(layer));
  const idList = selectedFeatureIds
    .slice(0, EXPLAIN_MAX_IDS)
    .map((id) => `'${String(id).replace(/'/g, "''")}'`)
    .join(', ');
  const selPredicate = `CAST(${fidColumn} AS VARCHAR) IN (${idList})`;
  const restPredicate = `NOT (${selPredicate})`;

  const tileColumns = (layer.source?.kind === 'duckdb-table' || layer.source?.kind === 'duckdb-query')
    ? new Set(layer.source.tileSource?.propertyColumns || [])
    : null;
  const columns = analyticsFieldsForLayer(layer)
    .filter((name) => {
      const lower = name.toLowerCase();
      return ![FEATURE_ID_PROPERTY, 'geojson', 'geometry', 'geom', 'wkb_geometry'].includes(lower)
        && !lower.startsWith('__alur_')
        && (!tileColumns || tileColumns.has(name));
    })
    .slice(0, 36);
  if (!columns.length) return null;

  // One probe pass classifies fields as numeric vs categorical.
  const probeResult = await duckdbService.query(
    `SELECT COUNT(*) FILTER (WHERE ${selPredicate}) AS sel_count,
            COUNT(*) FILTER (WHERE ${restPredicate}) AS rest_count,
            ${columns.map((column, index) =>
              `COUNT(TRY_CAST(${quoteIdentifier(column)} AS DOUBLE)) AS p${index}_num, COUNT(${quoteIdentifier(column)}) AS p${index}_all`).join(', ')}
     FROM ${table};`
  );
  const probe = normalizeRows(probeResult.toArray())[0] || {};
  const selectedCount = Number(probe.sel_count ?? 0);
  const restCount = Number(probe.rest_count ?? 0);
  if (!selectedCount || !restCount) return null;

  const numericColumns: string[] = [];
  const categoricalColumns: string[] = [];
  columns.forEach((column, index) => {
    const numeric = Number(probe[`p${index}_num`] ?? 0);
    const nonNull = Number(probe[`p${index}_all`] ?? 0);
    if (nonNull > 0 && numeric >= nonNull * 0.8 && numericColumns.length < EXPLAIN_MAX_NUMERIC_FIELDS) {
      numericColumns.push(column);
    } else if (nonNull > 0 && categoricalColumns.length < EXPLAIN_MAX_CATEGORY_FIELDS) {
      categoricalColumns.push(column);
    }
  });

  const fields: SelectionDivergence[] = [];

  if (numericColumns.length) {
    const numericResult = await duckdbService.query(
      `SELECT ${numericColumns.map((column, index) => {
        const value = `TRY_CAST(${quoteIdentifier(column)} AS DOUBLE)`;
        return `AVG(${value}) FILTER (WHERE ${selPredicate}) AS n${index}_sel,
                AVG(${value}) FILTER (WHERE ${restPredicate}) AS n${index}_rest,
                STDDEV_POP(${value}) AS n${index}_std`;
      }).join(', ')}
       FROM ${table};`
    );
    const stats = normalizeRows(numericResult.toArray())[0] || {};
    numericColumns.forEach((column, index) => {
      const selectedMean = Number(stats[`n${index}_sel`]);
      const restMean = Number(stats[`n${index}_rest`]);
      const std = Number(stats[`n${index}_std`]);
      if (!Number.isFinite(selectedMean) || !Number.isFinite(restMean)) return;
      const score = std > 0
        ? Math.abs(selectedMean - restMean) / std
        : selectedMean === restMean ? 0 : 1;
      fields.push({ kind: 'numeric', field: column, score, selectedMean, restMean });
    });
  }

  for (const column of categoricalColumns) {
    const field = quoteIdentifier(column);
    const result = await duckdbService.query(
      `SELECT CAST(${field} AS VARCHAR) AS label,
              COUNT(*) FILTER (WHERE ${selPredicate}) AS sel_n,
              COUNT(*) FILTER (WHERE ${restPredicate}) AS rest_n
       FROM ${table} WHERE ${field} IS NOT NULL
       GROUP BY label ORDER BY COUNT(*) DESC LIMIT 8;`
    );
    const rows = normalizeRows(result.toArray());
    if (!rows.length) continue;
    const categories = rows.map((row) => ({
      label: String(row.label),
      selectedShare: Number(row.sel_n ?? 0) / selectedCount,
      restShare: Number(row.rest_n ?? 0) / restCount,
    }));
    const score = categories.reduce((sum, item) => sum + Math.abs(item.selectedShare - item.restShare), 0) / 2;
    categories.sort((a, b) => Math.abs(b.selectedShare - b.restShare) - Math.abs(a.selectedShare - a.restShare));
    fields.push({ kind: 'categorical', field: column, score, categories: categories.slice(0, 3) });
  }

  fields.sort((a, b) => b.score - a.score);
  return { selectedCount, restCount, fields: fields.slice(0, 8) };
};

const INTERNAL_TABLE_PREFIXES = ['__alur_', 'visual_layer_'];

/** DuckDB tables a chart can bind to directly (workflow outputs, SQL results). */
export const listChartTables = async (): Promise<string[]> => {
  const result = await duckdbService.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name;`
  );
  return normalizeRows(result.toArray())
    .map((row) => String(row.table_name))
    .filter((name) => name && !INTERNAL_TABLE_PREFIXES.some((prefix) => name.startsWith(prefix)));
};

export const describeChartTable = async (tableName: string): Promise<Array<{ name: string; type: string }>> => {
  const result = await duckdbService.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema = 'main' AND table_name = '${tableName.replace(/'/g, "''")}'
     ORDER BY ordinal_position;`
  );
  return normalizeRows(result.toArray()).map((row) => ({
    name: String(row.column_name),
    type: String(row.data_type),
  }));
};

export const __visualAnalyticsCacheSizeForTests = () => registeredLayerTables.size;
