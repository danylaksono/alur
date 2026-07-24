import { duckdbService } from './duckdb';
import type { DatasetDescriptor } from '../types/datasets';
import type {
  ComparisonAlignedRecord,
  ComparisonMeasure,
  ComparisonOperand,
  ComparisonResult,
  ComparisonSpec,
  VisualFilter,
} from '../types/visualAnalytics';
import { compileVisualFiltersWhereClause, quoteIdentifier } from '../utils/visualFilterSql';

const resultCache = new Map<string, Promise<ComparisonResult>>();
export const ALIGNED_RECORD_LIMIT = 250;
export const SPATIAL_SAMPLE_LIMIT = 1500;
const toNumber = (value: unknown) => value === null || value === undefined ? null : Number(value);
const rows = (result: { toArray: () => unknown[] }) => result.toArray() as Array<Record<string, unknown>>;
const relation = (dataset: DatasetDescriptor) => dataset.relationName ? quoteIdentifier(dataset.relationName) : null;

const operandTable = (operand: ComparisonOperand, dataset: DatasetDescriptor) => {
  const materialisedTable = operand.scope.kind === 'materialised-selection'
    ? operand.scope.tableName
    : operand.scope.kind === 'cohort' && operand.scope.definition.kind === 'selection-table'
      ? operand.scope.definition.tableName
      : undefined;
  return materialisedTable ? quoteIdentifier(materialisedTable) : relation(dataset);
};

export const comparisonCacheKey = (spec: ComparisonSpec, datasets: Record<string, DatasetDescriptor>) => JSON.stringify({
  spec,
  versions: Object.fromEntries(spec.operands.map((operand) => [operand.datasetId, datasets[operand.datasetId]?.sourceUpdatedAt])),
});

const scopeFilters = (operand: ComparisonOperand): VisualFilter[] => {
  if (operand.scope.kind === 'filters') return operand.scope.filters;
  if (operand.scope.kind === 'cohort' && operand.scope.definition.kind === 'filters') return operand.scope.definition.filters;
  if (operand.scope.kind === 'time-window') return [{ kind: 'temporal', field: operand.scope.field, start: operand.scope.start, end: operand.scope.end }];
  return [];
};

export const operandWhereClause = (operand: ComparisonOperand) => compileVisualFiltersWhereClause(scopeFilters(operand));

const aggregationSql = (measure: ComparisonMeasure, operand: ComparisonOperand) => {
  if (measure.aggregation === 'count') return 'COUNT(*)';
  const field = measure.fields[operand.id];
  if (!field) return 'NULL';
  const numeric = `TRY_CAST(${quoteIdentifier(field)} AS DOUBLE)`;
  if (measure.aggregation === 'sum') return `SUM(${numeric})`;
  if (measure.aggregation === 'avg') return `AVG(${numeric})`;
  if (measure.aggregation === 'min') return `MIN(${numeric})`;
  return `MAX(${numeric})`;
};

const alignmentCtes = (spec: ComparisonSpec, datasets: Record<string, DatasetDescriptor>) => spec.operands.map((operand, operandIndex) => {
  const dataset = datasets[operand.datasetId];
  const table = operandTable(operand, dataset);
  const keyField = spec.alignment.keyFields?.[operand.id];
  if (!table || !keyField) return null;
  const measures = spec.measures.map((measure, measureIndex) => `${aggregationSql(measure, operand)} AS m${measureIndex}`);
  return `o${operandIndex} AS (SELECT CAST(${quoteIdentifier(keyField)} AS VARCHAR) AS alignment_key, TRUE AS present${operandIndex}${measures.length ? `, ${measures.join(', ')}` : ''} FROM ${table} ${operandWhereClause(operand)} GROUP BY 1)`;
});

const queryAlignedRecords = async (
  spec: ComparisonSpec,
  datasets: Record<string, DatasetDescriptor>,
  signal?: AbortSignal,
): Promise<{ records: ComparisonAlignedRecord[]; total: number; overlap: NonNullable<ComparisonResult['overlap']> }> => {
  if (spec.alignment.mode !== 'entity-keyed' || !spec.operands.length) return { records: [], total: 0, overlap: [] };
  const ctes = alignmentCtes(spec, datasets);
  if (ctes.some((cte) => !cte)) return { records: [], total: 0, overlap: [] };
  const keyUnion = spec.operands.map((_, index) => `SELECT alignment_key FROM o${index}`).join(' UNION ');
  const valueColumns = spec.operands.flatMap((_, operandIndex) => [
    `o${operandIndex}.present${operandIndex} AS present${operandIndex}`,
    ...spec.measures.map((__, measureIndex) => `o${operandIndex}.m${measureIndex} AS o${operandIndex}m${measureIndex}`),
  ]);
  const joins = spec.operands.map((_, index) => `LEFT JOIN o${index} ON o${index}.alignment_key = keys.alignment_key`).join(' ');
  if (signal?.aborted) throw new DOMException('Comparison query cancelled', 'AbortError');
  const alignedRows = rows(await duckdbService.query(`WITH ${ctes.join(', ')}, keys AS (${keyUnion}) SELECT keys.alignment_key, COUNT(*) OVER () AS aligned_total${valueColumns.length ? `, ${valueColumns.join(', ')}` : ''} FROM keys ${joins} ORDER BY keys.alignment_key LIMIT ${ALIGNED_RECORD_LIMIT};`));
  const records = alignedRows.map((row): ComparisonAlignedRecord => {
    const values: ComparisonAlignedRecord['values'] = {};
    const presentOperandIds: string[] = [];
    spec.operands.forEach((operand, operandIndex) => {
      if (row[`present${operandIndex}`]) presentOperandIds.push(operand.id);
      values[operand.id] = Object.fromEntries(spec.measures.map((measure, measureIndex) => [measure.id, toNumber(row[`o${operandIndex}m${measureIndex}`])]));
    });
    const deltas = Object.fromEntries(spec.measures.map((measure) => {
      if (spec.operands.length !== 2) return [measure.id, null];
      const a = values[spec.operands[0].id][measure.id];
      const b = values[spec.operands[1].id][measure.id];
      return [measure.id, a === null || b === null ? null : b - a];
    }));
    return { key: String(row.alignment_key), presentOperandIds, values, deltas };
  });
  const overlapColumns: string[] = [];
  for (let left = 0; left < spec.operands.length; left += 1) for (let right = left + 1; right < spec.operands.length; right += 1) {
    overlapColumns.push(`(SELECT COUNT(*) FROM o${left} INNER JOIN o${right} USING (alignment_key)) AS overlap_${left}_${right}`);
  }
  const overlapRow = overlapColumns.length
    ? rows(await duckdbService.query(`WITH ${ctes.join(', ')} SELECT ${overlapColumns.join(', ')};`))[0] || {}
    : {};
  const overlap: NonNullable<ComparisonResult['overlap']> = [];
  for (let left = 0; left < spec.operands.length; left += 1) for (let right = left + 1; right < spec.operands.length; right += 1) overlap.push({
    operandAId: spec.operands[left].id,
    operandBId: spec.operands[right].id,
    count: Number(overlapRow[`overlap_${left}_${right}`] || 0),
  });
  return { records, total: Number(alignedRows[0]?.aligned_total || 0), overlap };
};

const spatialGeometry = (dataset: DatasetDescriptor) => dataset.geometryColumn
  || dataset.fields.find((field) => field.type.toLowerCase() === 'geometry')?.name;

const lonLatGeometrySql = (dataset: DatasetDescriptor, geometryField: string) => {
  const geometry = quoteIdentifier(geometryField);
  const crs = dataset.geometryCrs?.replace(/'/g, "''");
  return crs && crs.toUpperCase() !== 'EPSG:4326'
    ? `ST_Transform(${geometry}, '${crs}', 'EPSG:4326', true)`
    : geometry;
};

const querySpatialSample = async (
  spec: ComparisonSpec,
  operand: ComparisonOperand,
  dataset: DatasetDescriptor,
  denominator: number,
  signal?: AbortSignal,
): Promise<NonNullable<ComparisonResult['spatialSamples']>[number] | null> => {
  const table = operandTable(operand, dataset);
  const geometryField = spatialGeometry(dataset);
  if (!table || !geometryField) return null;
  const keyField = spec.alignment.keyFields?.[operand.id] || dataset.rowIdColumn;
  const measure = spec.measures[0];
  const measureField = measure?.fields[operand.id];
  const valueSql = !measure || measure.aggregation === 'count' || !measureField ? '1' : `TRY_CAST(${quoteIdentifier(measureField)} AS DOUBLE)`;
  const geometry = quoteIdentifier(geometryField);
  const lonLatGeometry = lonLatGeometrySql(dataset, geometryField);
  if (signal?.aborted) throw new DOMException('Comparison query cancelled', 'AbortError');
  const scopeWhere = operandWhereClause(operand);
  const spatialWhere = `${scopeWhere}${scopeWhere ? ' AND' : ' WHERE'} ${geometry} IS NOT NULL`;
  const sampleRows = rows(await duckdbService.query(`SELECT CAST(${quoteIdentifier(keyField)} AS VARCHAR) AS __alur_key, ${valueSql} AS __alur_value, ST_AsGeoJSON(${lonLatGeometry}) AS geojson FROM ${table} ${spatialWhere} LIMIT ${SPATIAL_SAMPLE_LIMIT};`));
  const features = sampleRows.flatMap((row): GeoJSON.Feature[] => {
    if (!row.geojson) return [];
    try {
      return [{
        type: 'Feature',
        id: String(row.__alur_key),
        geometry: JSON.parse(String(row.geojson)) as GeoJSON.Geometry,
        properties: { __alur_key: String(row.__alur_key), __alur_value: toNumber(row.__alur_value), __alur_operand_id: operand.id },
      }];
    } catch { return []; }
  });
  return { operandId: operand.id, measureId: measure?.id, features: { type: 'FeatureCollection', features }, sampled: denominator > SPATIAL_SAMPLE_LIMIT, featureCount: denominator };
};

const queryDifferenceSpatialSample = async (
  spec: ComparisonSpec,
  datasets: Record<string, DatasetDescriptor>,
  signal?: AbortSignal,
): Promise<NonNullable<ComparisonResult['differenceSpatialSample']> | null> => {
  if (spec.operands.length !== 2 || spec.alignment.mode !== 'entity-keyed' || !spec.measures[0]) return null;
  const [a, b] = spec.operands;
  const datasetA = datasets[a.datasetId];
  const datasetB = datasets[b.datasetId];
  const tableA = operandTable(a, datasetA);
  const tableB = operandTable(b, datasetB);
  const keyA = spec.alignment.keyFields?.[a.id];
  const keyB = spec.alignment.keyFields?.[b.id];
  const geometryField = spatialGeometry(datasetA);
  if (!tableA || !tableB || !keyA || !keyB || !geometryField) return null;
  const measure = spec.measures[0];
  const geometry = quoteIdentifier(geometryField);
  const whereA = operandWhereClause(a);
  const geometryWhereA = `${whereA}${whereA ? ' AND' : ' WHERE'} ${geometry} IS NOT NULL`;
  const query = `WITH a AS (
      SELECT CAST(${quoteIdentifier(keyA)} AS VARCHAR) AS alignment_key,
             ${aggregationSql(measure, a)} AS value_a,
             ANY_VALUE(ST_AsGeoJSON(${lonLatGeometrySql(datasetA, geometryField)})) AS geojson
      FROM ${tableA} ${geometryWhereA} GROUP BY 1
    ), b AS (
      SELECT CAST(${quoteIdentifier(keyB)} AS VARCHAR) AS alignment_key,
             ${aggregationSql(measure, b)} AS value_b
      FROM ${tableB} ${operandWhereClause(b)} GROUP BY 1
    )
    SELECT a.alignment_key AS __alur_key, b.value_b - a.value_a AS __alur_value, a.geojson, COUNT(*) OVER () AS feature_total
    FROM a INNER JOIN b USING (alignment_key)
    WHERE a.value_a IS NOT NULL AND b.value_b IS NOT NULL
    ORDER BY a.alignment_key LIMIT ${SPATIAL_SAMPLE_LIMIT};`;
  if (signal?.aborted) throw new DOMException('Comparison query cancelled', 'AbortError');
  const sampleRows = rows(await duckdbService.query(query));
  const features = sampleRows.flatMap((row): GeoJSON.Feature[] => {
    if (!row.geojson) return [];
    try {
      return [{ type: 'Feature', id: String(row.__alur_key), geometry: JSON.parse(String(row.geojson)) as GeoJSON.Geometry, properties: { __alur_key: String(row.__alur_key), __alur_value: toNumber(row.__alur_value), __alur_operand_id: '__difference__' } }];
    } catch { return []; }
  });
  const featureCount = Number(sampleRows[0]?.feature_total || 0);
  return { operandId: '__difference__', measureId: measure.id, features: { type: 'FeatureCollection', features }, sampled: featureCount > SPATIAL_SAMPLE_LIMIT, featureCount };
};

export type ComparisonCompatibility = {
  valid: boolean;
  warnings: string[];
  differenceMapEligible: boolean;
};

export const comparisonCompatibility = (spec: ComparisonSpec, datasets: Record<string, DatasetDescriptor>): ComparisonCompatibility => {
  const warnings: string[] = [];
  if (spec.operands.length < 2 || spec.operands.length > 4) warnings.push('A comparison requires two to four operands.');
  const missing = spec.operands.filter((operand) => !datasets[operand.datasetId]);
  if (missing.length) warnings.push(`Missing source: ${missing.map((operand) => operand.label).join(', ')}.`);
  if (spec.alignment.mode === 'entity-keyed' && spec.operands.some((operand) => !spec.alignment.keyFields?.[operand.id])) warnings.push('Entity alignment requires a key field for every operand.');
  if (spec.alignment.mode === 'temporal' && spec.operands.some((operand) => !spec.alignment.timeFields?.[operand.id])) warnings.push('Temporal alignment requires a time field for every operand.');
  const differenceMapEligible = spec.operands.length === 2
    && spec.alignment.mode === 'entity-keyed'
    && spec.measures.length > 0
    && spec.operands.every((operand) => Boolean(datasets[operand.datasetId]?.spatial && spec.alignment.keyFields?.[operand.id] && spec.measures[0].fields[operand.id]));
  if (spec.requestedViews.includes('map') && !spec.operands.some((operand) => datasets[operand.datasetId]?.spatial)) warnings.push('Map view is unavailable because none of the operands is spatial.');
  return { valid: warnings.every((warning) => !warning.startsWith('A comparison') && !warning.startsWith('Missing source')), warnings, differenceMapEligible };
};

const runComparison = async (
  spec: ComparisonSpec,
  datasets: Record<string, DatasetDescriptor>,
  signal?: AbortSignal,
): Promise<ComparisonResult> => {
  const compatibility = comparisonCompatibility(spec, datasets);
  if (!compatibility.valid) return { specId: spec.id, summaries: [], distributions: [], categoryShares: [], temporalSeries: [], warnings: compatibility.warnings, generatedAt: Date.now() };
  const warnings = [...compatibility.warnings];
  const summaries: ComparisonResult['summaries'] = spec.measures.map((measure) => ({ measureId: measure.id, values: [] }));
  const distributions: ComparisonResult['distributions'] = [];
  const categoryShares: ComparisonResult['categoryShares'] = [];
  const temporalSeries: ComparisonResult['temporalSeries'] = [];

  for (const operand of spec.operands) {
    if (signal?.aborted) throw new DOMException('Comparison query cancelled', 'AbortError');
    const dataset = datasets[operand.datasetId];
    const table = operandTable(operand, dataset);
    if (!table) {
      warnings.push(`${operand.label} has no queryable relation. Relink or materialise the dataset first.`);
      continue;
    }
    if (operand.scope.kind === 'materialised-selection' || (operand.scope.kind === 'cohort' && operand.scope.definition.kind === 'selection-table')) {
      warnings.push(`${operand.label} uses a transient materialised selection; recreate it after relinking the source.`);
    }
    const where = operandWhereClause(operand);
    const expressions = [
      'COUNT(*) AS denominator',
      ...spec.measures.map((measure, index) => `${aggregationSql(measure, operand)} AS m${index}`),
      ...spec.measures.map((measure, index) => {
        if (measure.aggregation === 'count') return `0 AS missing${index}`;
        const field = measure.fields[operand.id];
        return field ? `COUNT(*) - COUNT(${quoteIdentifier(field)}) AS missing${index}` : `COUNT(*) AS missing${index}`;
      }),
    ];
    const summary = rows(await duckdbService.query(`SELECT ${expressions.join(', ')} FROM ${table} ${where};`))[0] || {};
    const denominator = Number(summary.denominator || 0);
    spec.measures.forEach((measure, index) => summaries[index].values.push({ operandId: operand.id, value: toNumber(summary[`m${index}`]), denominator, missing: Number(summary[`missing${index}`] || 0) }));

    for (const dimension of spec.dimensions.slice(0, 3)) {
      const field = quoteIdentifier(dimension);
      const categoryRows = rows(await duckdbService.query(`SELECT COALESCE(CAST(${field} AS VARCHAR), 'Missing') AS label, COUNT(*) AS count FROM ${table} ${where} GROUP BY 1 ORDER BY count DESC LIMIT 20;`));
      categoryShares.push({ dimension, operandId: operand.id, values: categoryRows.map((row) => ({ label: String(row.label), count: Number(row.count), share: denominator ? Number(row.count) / denominator : 0 })) });
    }

    for (const measure of spec.measures.slice(0, 4)) {
      const fieldName = measure.fields[operand.id];
      if (!fieldName || measure.aggregation === 'count') continue;
      const numeric = `TRY_CAST(${quoteIdentifier(fieldName)} AS DOUBLE)`;
      const binRows = rows(await duckdbService.query(`WITH values AS (SELECT ${numeric} AS value FROM ${table} ${where}), bounds AS (SELECT MIN(value) lo, MAX(value) hi FROM values WHERE value IS NOT NULL) SELECT CASE WHEN hi = lo THEN 0 ELSE LEAST(9, FLOOR((value-lo)/(hi-lo)*10)) END AS bin, MIN(value) AS lo, MAX(value) AS hi, COUNT(*) AS count FROM values, bounds WHERE value IS NOT NULL GROUP BY 1 ORDER BY 1;`));
      const validCount = binRows.reduce((sum, row) => sum + Number(row.count), 0);
      distributions.push({ measureId: measure.id, operandId: operand.id, bins: binRows.map((row) => ({ label: `${Number(row.lo).toLocaleString()}–${Number(row.hi).toLocaleString()}`, count: Number(row.count), share: validCount ? Number(row.count) / validCount : 0 })) });
    }

    if (spec.alignment.mode === 'temporal') {
      const timeField = spec.alignment.timeFields?.[operand.id];
      if (timeField) for (const measure of spec.measures.slice(0, 2)) {
        const period = `date_trunc('month', TRY_CAST(${quoteIdentifier(timeField)} AS TIMESTAMP))`;
        const temporalRows = rows(await duckdbService.query(`SELECT CAST(${period} AS VARCHAR) AS period, ${aggregationSql(measure, operand)} AS value FROM ${table} ${where} GROUP BY 1 ORDER BY 1;`));
        temporalSeries.push({ measureId: measure.id, operandId: operand.id, points: temporalRows.map((row) => ({ period: String(row.period), value: toNumber(row.value) })) });
      }
    }
  }

  let alignedRecords: ComparisonResult['alignedRecords'];
  let alignedRecordCount: number | undefined;
  let alignedRecordsTruncated: boolean | undefined;
  let overlap: ComparisonResult['overlap'];
  if (spec.alignment.mode === 'entity-keyed' && (spec.requestedViews.includes('records') || spec.requestedViews.includes('map'))) {
    const aligned = await queryAlignedRecords(spec, datasets, signal);
    alignedRecords = aligned.records;
    alignedRecordCount = aligned.total;
    alignedRecordsTruncated = aligned.total > ALIGNED_RECORD_LIMIT;
    overlap = aligned.overlap;
  }

  const spatialSamples: NonNullable<ComparisonResult['spatialSamples']> = [];
  if (spec.requestedViews.includes('map')) for (const operand of spec.operands) {
    const dataset = datasets[operand.datasetId];
    if (!dataset?.spatial) continue;
    const denominator = summaries[0]?.values.find((value) => value.operandId === operand.id)?.denominator || 0;
    const sample = await querySpatialSample(spec, operand, dataset, denominator, signal);
    if (sample) spatialSamples.push(sample);
    else warnings.push(`${operand.label} is marked spatial but has no queryable geometry column.`);
  }

  const differenceSpatialSample = compatibility.differenceMapEligible && spec.requestedViews.includes('map')
    ? await queryDifferenceSpatialSample(spec, datasets, signal)
    : null;

  return { specId: spec.id, summaries, distributions, categoryShares, temporalSeries, overlap, alignedRecords, alignedRecordCount, alignedRecordsTruncated, spatialSamples, differenceSpatialSample: differenceSpatialSample || undefined, warnings: [...new Set(warnings)], generatedAt: Date.now() };
};

export const queryComparison = (spec: ComparisonSpec, datasets: Record<string, DatasetDescriptor>, signal?: AbortSignal) => {
  const key = comparisonCacheKey(spec, datasets);
  const cached = resultCache.get(key);
  if (cached) return cached;
  const request = runComparison(spec, datasets, signal).catch((error) => {
    resultCache.delete(key);
    throw error;
  });
  resultCache.set(key, request);
  return request;
};

export const clearComparisonCache = () => resultCache.clear();
