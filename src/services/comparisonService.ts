import { duckdbService } from './duckdb';
import type { DatasetDescriptor } from '../types/datasets';
import type {
  ComparisonMeasure,
  ComparisonOperand,
  ComparisonResult,
  ComparisonSpec,
  VisualFilter,
} from '../types/visualAnalytics';
import { compileVisualFiltersWhereClause, quoteIdentifier } from '../utils/visualFilterSql';

const resultCache = new Map<string, Promise<ComparisonResult>>();
const toNumber = (value: unknown) => value === null || value === undefined ? null : Number(value);
const rows = (result: { toArray: () => unknown[] }) => result.toArray() as Array<Record<string, unknown>>;
const relation = (dataset: DatasetDescriptor) => dataset.relationName ? quoteIdentifier(dataset.relationName) : null;

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
    const materialisedTable = operand.scope.kind === 'materialised-selection'
      ? operand.scope.tableName
      : operand.scope.kind === 'cohort' && operand.scope.definition.kind === 'selection-table'
        ? operand.scope.definition.tableName
        : undefined;
    const table = materialisedTable ? quoteIdentifier(materialisedTable) : relation(dataset);
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

  return { specId: spec.id, summaries, distributions, categoryShares, temporalSeries, warnings: [...new Set(warnings)], generatedAt: Date.now() };
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
