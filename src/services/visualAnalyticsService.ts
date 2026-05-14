import { duckdbService } from './duckdb';
import { FEATURE_ID_PROPERTY, type LayerAnalyticsSummary, type VisualFilter } from '../types/visualAnalytics';
import { compileVisualFiltersWhereClause, quoteIdentifier } from '../utils/visualFilterSql';

const tableNameForLayer = (layerId: string) => `visual_layer_${layerId.replace(/[^a-zA-Z0-9_]/g, '_')}`;

const registeredLayerTables = new Map<string, string>();

const toRows = (layer: { id: string; geojson: GeoJSON.FeatureCollection }) =>
  layer.geojson.features.map((feature, index) => ({
    _feature: index + 1,
    ...(feature.properties || {}),
  }));

const normalizeRows = (rows: any[]) =>
  rows.map((row) => (typeof row?.toJSON === 'function' ? row.toJSON() : row));

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
  await duckdbService.registerJsonRows(tableName, toRows(layer));
  registeredLayerTables.set(tableName, signature);
  return tableName;
};

export const clearLayerAnalyticsCache = (layerId?: string) => {
  if (!layerId) {
    registeredLayerTables.clear();
    return;
  }
  registeredLayerTables.delete(tableNameForLayer(layerId));
};

export const queryLayerRows = async ({
  layer,
  filters,
  search,
  sortBy,
  sortDirection,
  pageIndex,
  pageSize,
}: {
  layer: { id: string; geojson: GeoJSON.FeatureCollection };
  filters: VisualFilter[];
  search: string;
  sortBy: string | null;
  sortDirection: 'asc' | 'desc';
  pageIndex: number;
  pageSize: number;
}) => {
  const tableName = await registerLayerForAnalytics(layer);
  const searchableColumns = Object.keys(layer.geojson.features[0]?.properties || {})
    .filter((key) => key !== FEATURE_ID_PROPERTY);
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
    duckdbService.query(`SELECT COUNT(*) AS row_count FROM "${tableName}" ${whereClause};`),
    duckdbService.query(`SELECT * FROM "${tableName}" ${whereClause} ${sortClause} LIMIT ${pageSize} OFFSET ${offset};`),
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
}: {
  layer: { id: string; geojson: GeoJSON.FeatureCollection };
  filters: VisualFilter[];
  column: string;
}) => {
  const tableName = await registerLayerForAnalytics(layer);
  const whereClause = compileVisualFiltersWhereClause(filters);
  const field = quoteIdentifier(column);
  const totalResult = await duckdbService.query(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN ${field} IS NULL THEN 1 ELSE 0 END) AS null_count FROM "${tableName}" ${whereClause};`
  );
  const totalRaw = normalizeRows(totalResult.toArray())[0] || {};
  const total = Number(totalRaw.total ?? 0);
  const nullCount = Number(totalRaw.null_count ?? 0);

  const statsResult = await duckdbService.query(
    `SELECT MIN(TRY_CAST(${field} AS DOUBLE)) AS min_value, MAX(TRY_CAST(${field} AS DOUBLE)) AS max_value, COUNT(TRY_CAST(${field} AS DOUBLE)) AS numeric_count, COUNT(${field}) AS non_null_count FROM "${tableName}" ${whereClause};`
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
      `SELECT ${bucketExpr} AS bucket, COUNT(*) AS count FROM "${tableName}" ${andOrWhere} ${field} IS NOT NULL GROUP BY bucket ORDER BY bucket;`
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
    `SELECT CAST(${field} AS VARCHAR) AS label, COUNT(*) AS count FROM "${tableName}" ${andOrWhere} ${field} IS NOT NULL GROUP BY label ORDER BY count DESC LIMIT 12;`
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
  layer: { id: string; geojson: GeoJSON.FeatureCollection };
  column: string;
}): Promise<TemporalRange | null> => {
  const tableName = await registerLayerForAnalytics(layer);
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

const selectedWhereClause = (selectedFeatureIds: string[]) => {
  if (!selectedFeatureIds.length) return '';
  const values = selectedFeatureIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(', ');
  return `WHERE CAST(${quoteIdentifier(FEATURE_ID_PROPERTY)} AS VARCHAR) IN (${values})`;
};

const candidateColumns = (layer: { geojson: GeoJSON.FeatureCollection }) =>
  Object.keys(layer.geojson.features[0]?.properties || {})
    .filter((key) => ![FEATURE_ID_PROPERTY, 'geojson', 'geometry', 'geom'].includes(key.toLowerCase()))
    .slice(0, 12);

export const queryLayerSummary = async ({
  layer,
  filters,
  selectedFeatureIds,
}: {
  layer: { id: string; geojson: GeoJSON.FeatureCollection };
  filters: VisualFilter[];
  selectedFeatureIds: string[];
}): Promise<LayerAnalyticsSummary> => {
  const tableName = await registerLayerForAnalytics(layer);
  const table = `"${tableName}"`;
  const totalResult = await duckdbService.query(`SELECT COUNT(*) AS row_count FROM ${table};`);
  const totalRaw = normalizeRows(totalResult.toArray())[0] || {};
  const totalRows = Number(totalRaw.row_count ?? 0);

  const baseWhere = selectedFeatureIds.length
    ? selectedWhereClause(selectedFeatureIds)
    : compileVisualFiltersWhereClause(filters);
  const filteredResult = await duckdbService.query(`SELECT COUNT(*) AS row_count FROM ${table} ${baseWhere};`);
  const filteredRaw = normalizeRows(filteredResult.toArray())[0] || {};
  const filteredRows = Number(filteredRaw.row_count ?? 0);
  const selectedRows = selectedFeatureIds.length ? filteredRows : 0;

  const columns = candidateColumns(layer);
  const statsResult = await duckdbService.query(
    `SELECT ${columns.map((column) => `COUNT(TRY_CAST(${quoteIdentifier(column)} AS DOUBLE)) AS ${quoteIdentifier(`${column}__numeric_count`)}`).join(', ')} FROM ${table} ${baseWhere};`
  );
  const statsRaw = normalizeRows(statsResult.toArray())[0] || {};
  const numericColumns = columns
    .filter((column) => Number(statsRaw[`${column}__numeric_count`] ?? 0) > 0)
    .slice(0, 3);
  const categoryColumns = columns
    .filter((column) => !numericColumns.includes(column))
    .slice(0, 2);

  const numericMetrics = await Promise.all(numericColumns.map(async (field) => {
    const q = quoteIdentifier(field);
    const result = await duckdbService.query(
      `SELECT COUNT(TRY_CAST(${q} AS DOUBLE)) AS count_value, MIN(TRY_CAST(${q} AS DOUBLE)) AS min_value, MAX(TRY_CAST(${q} AS DOUBLE)) AS max_value, AVG(TRY_CAST(${q} AS DOUBLE)) AS mean_value, SUM(TRY_CAST(${q} AS DOUBLE)) AS sum_value FROM ${table} ${baseWhere};`
    );
    const raw = normalizeRows(result.toArray())[0] || {};
    const valueOrNull = (value: unknown) => {
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    };
    return {
      field,
      kind: 'numeric' as const,
      count: Number(raw.count_value ?? 0),
      min: valueOrNull(raw.min_value),
      max: valueOrNull(raw.max_value),
      mean: valueOrNull(raw.mean_value),
      sum: valueOrNull(raw.sum_value),
    };
  }));

  const categoryBreakdowns = await Promise.all(categoryColumns.map(async (field) => {
    const q = quoteIdentifier(field);
    const andOrWhere = baseWhere ? `${baseWhere} AND` : 'WHERE';
    const result = await duckdbService.query(
      `SELECT CAST(${q} AS VARCHAR) AS label, COUNT(*) AS count FROM ${table} ${andOrWhere} ${q} IS NOT NULL GROUP BY label ORDER BY count DESC LIMIT 4;`
    );
    return {
      field,
      values: normalizeRows(result.toArray()).map((row) => ({
        label: String(row.label),
        count: Number(row.count),
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

export const __visualAnalyticsCacheSizeForTests = () => registeredLayerTables.size;
