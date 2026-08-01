import type { Edge } from '@xyflow/react';
import { duckdbService } from './duckdb';
import { buildWorkflowSQL, cteAlias } from '../utils/workflowEngine';
import type { WorkflowNode } from '../store/useStore';
import type { WorkflowFragment } from '../utils/workflowFragments';
import type { ColumnProfile } from '../components/DataTable';
import type { VisualFilter } from '../types/visualAnalytics';
import { compileVisualFiltersWhereClause } from '../utils/visualFilterSql';
import { buildComputedRelation, type ComputedField } from '../utils/fieldCalculator';

export const qi = (name: string) => `"${name.replace(/"/g, '""')}"`;
export const escapeSql = (value: string) => value.replace(/'/g, "''");

export const searchableColumnNames = (schema: any[] | undefined) =>
  (schema || [])
    .map((col: any) => col.name || col.column_name)
    .filter((name: unknown): name is string =>
      typeof name === 'string' && !['geojson', 'geometry', 'geom'].includes(name.toLowerCase())
    );

export const columnType = (schema: any[] | undefined, column: string) => {
  const found = (schema || []).find((col: any) => (col.name || col.column_name) === column);
  return String(found?.type || found?.column_type || '').toLowerCase();
};

export const isNumericType = (type: string) =>
  ['tinyint', 'smallint', 'integer', 'bigint', 'hugeint', 'utinyint', 'usmallint', 'uinteger', 'ubigint', 'float', 'double', 'decimal', 'real']
    .some((item) => type.includes(item));

const rowToJson = (row: any) => (typeof row?.toJSON === 'function' ? row.toJSON() : row);

const searchPredicate = (schema: any[] | undefined, search: string, computedFields: ComputedField[] = []) => {
  const normalizedSearch = search.trim();
  const columns = [...searchableColumnNames(schema), ...computedFields.map((field) => field.name)];
  if (!normalizedSearch || !columns.length) return '';
  return columns
    .map((name) => `CAST(${qi(name)} AS VARCHAR) ILIKE '%${escapeSql(normalizedSearch)}%'`)
    .join(' OR ');
};

const combinedWhereClause = (schema: any[] | undefined, search: string, filters: VisualFilter[] = [], computedFields: ComputedField[] = []) => {
  const predicates = [
    compileVisualFiltersWhereClause(filters).replace(/^WHERE\s+/, ''),
    searchPredicate(schema, search, computedFields),
  ].filter(Boolean);
  return predicates.length ? ` WHERE (${predicates.join(') AND (')})` : '';
};

export const buildNodeSelectSql = (nodes: WorkflowNode[], edges: Edge[], nodeId: string, fragments: WorkflowFragment[] = []) => {
  const { withClause } = buildWorkflowSQL(nodes, edges, { fragments });
  return `${withClause} SELECT * FROM ${cteAlias(nodeId)}`;
};

export const buildNodeTableExportSql = ({
  nodes,
  edges,
  nodeId,
  schema,
  filters,
  search,
  sortBy,
  sortDirection,
  computedFields,
  fragments = [],
}: {
  nodes: WorkflowNode[];
  edges: Edge[];
  fragments?: WorkflowFragment[];
  nodeId: string;
  schema: any[] | undefined;
  filters: VisualFilter[];
  search: string;
  sortBy: string | null;
  sortDirection: 'asc' | 'desc';
  computedFields: ComputedField[];
}) => {
  const { withClause } = buildWorkflowSQL(nodes, edges, { fragments });
  const relation = buildComputedRelation(cteAlias(nodeId), computedFields);
  const whereClause = combinedWhereClause(schema, search, filters, computedFields);
  const sortClause = sortBy ? ` ORDER BY ${qi(sortBy)} ${sortDirection.toUpperCase()} NULLS LAST` : '';
  return `${withClause} SELECT * FROM ${relation}${whereClause}${sortClause}`;
};

export const queryNodePreviewRows = async ({
  nodes,
  edges,
  nodeId,
  schema,
  search,
  sortBy,
  sortDirection,
  pageIndex,
  pageSize,
  filters = [],
  computedFields = [],
  fragments = [],
}: {
  nodes: WorkflowNode[];
  edges: Edge[];
  fragments?: WorkflowFragment[];
  nodeId: string;
  schema: any[] | undefined;
  search: string;
  sortBy: string | null;
  sortDirection: 'asc' | 'desc';
  pageIndex: number;
  pageSize: number;
  filters?: VisualFilter[];
  computedFields?: ComputedField[];
}) => {
  const { withClause } = buildWorkflowSQL(nodes, edges, { fragments });
  const targetAlias = cteAlias(nodeId);
  const relation = buildComputedRelation(targetAlias, computedFields);
  const whereClause = combinedWhereClause(schema, search, filters, computedFields);
  const sortClause = sortBy
    ? ` ORDER BY ${qi(sortBy)} ${sortDirection.toUpperCase()} NULLS LAST`
    : '';
  const offset = pageIndex * pageSize;
  const countSql = `${withClause} SELECT COUNT(*) AS row_count FROM ${relation}${whereClause};`;
  const previewSql = `${withClause} SELECT * FROM ${relation}${whereClause}${sortClause} LIMIT ${pageSize} OFFSET ${offset};`;

  const [countResult, result] = await Promise.all([
    duckdbService.query(countSql),
    duckdbService.query(previewSql),
  ]);
  const countRaw = rowToJson(countResult.toArray()[0]);
  return {
    rows: result.toArray().map(rowToJson) as Record<string, any>[],
    total: Number(countRaw?.row_count ?? countRaw?.count_star ?? 0),
  };
};

export const queryNodeColumnProfile = async ({
  nodes,
  edges,
  nodeId,
  schema,
  search,
  column,
  filters = [],
  computedFields = [],
  fragments = [],
}: {
  nodes: WorkflowNode[];
  edges: Edge[];
  fragments?: WorkflowFragment[];
  nodeId: string;
  schema: any[] | undefined;
  search: string;
  column: string;
  filters?: VisualFilter[];
  computedFields?: ComputedField[];
}): Promise<ColumnProfile> => {
  const { withClause } = buildWorkflowSQL(nodes, edges, { fragments });
  const targetAlias = cteAlias(nodeId);
  const type = columnType(schema, column);
  const relation = buildComputedRelation(targetAlias, computedFields);
  const whereClause = combinedWhereClause(schema, search, filters, computedFields);

  const totalSql = `${withClause} SELECT COUNT(*) AS total, SUM(CASE WHEN ${qi(column)} IS NULL THEN 1 ELSE 0 END) AS null_count FROM ${relation}${whereClause};`;
  const totalResult = await duckdbService.query(totalSql);
  const totalRaw = rowToJson(totalResult.toArray()[0]);
  const total = Number(totalRaw?.total ?? 0);
  const nullCount = Number(totalRaw?.null_count ?? 0);

  const statsSql = `${withClause} SELECT MIN(TRY_CAST(${qi(column)} AS DOUBLE)) AS min_value, MAX(TRY_CAST(${qi(column)} AS DOUBLE)) AS max_value, COUNT(TRY_CAST(${qi(column)} AS DOUBLE)) AS numeric_count, COUNT(${qi(column)}) AS non_null_count FROM ${relation}${whereClause};`;
  const statsResult = await duckdbService.query(statsSql);
  const statsRaw = rowToJson(statsResult.toArray()[0]);
  const numericCount = Number(statsRaw?.numeric_count ?? 0);
  const nonNullCount = Number(statsRaw?.non_null_count ?? 0);
  if (isNumericType(type) || (numericCount > 0 && numericCount >= nonNullCount * 0.8)) {
    const min = Number(statsRaw?.min_value);
    const max = Number(statsRaw?.max_value);
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return { column, kind: 'numeric', total, nullCount, bins: [] };
    }
    const binCount = 12;
    const bucketExpr = max === min
      ? '0'
      : `LEAST(${binCount - 1}, CAST(FLOOR((TRY_CAST(${qi(column)} AS DOUBLE) - ${min}) / ${((max - min) / binCount) || 1}) AS INTEGER))`;
    const binsSql = `${withClause} SELECT ${bucketExpr} AS bucket, COUNT(*) AS count FROM ${relation}${whereClause}${whereClause ? ' AND' : ' WHERE'} ${qi(column)} IS NOT NULL GROUP BY bucket ORDER BY bucket;`;
    const binsResult = await duckdbService.query(binsSql);
    const binMap = new Map<number, number>();
    binsResult.toArray().forEach((row: any) => {
      const raw = rowToJson(row);
      binMap.set(Number(raw.bucket), Number(raw.count));
    });
    const width = max === min ? 1 : (max - min) / binCount;
    const bins = Array.from({ length: binCount }, (_, index) => ({
      label: `${(min + width * index).toPrecision(3)}-${(min + width * (index + 1)).toPrecision(3)}`,
      min: min + width * index,
      max: min + width * (index + 1),
      count: binMap.get(index) || 0,
    }));
    return { column, kind: 'numeric', total, nullCount, min, max, bins };
  }

  const binsSql = `${withClause} SELECT CAST(${qi(column)} AS VARCHAR) AS label, COUNT(*) AS count FROM ${relation}${whereClause}${whereClause ? ' AND' : ' WHERE'} ${qi(column)} IS NOT NULL GROUP BY label ORDER BY count DESC LIMIT 12;`;
  const binsResult = await duckdbService.query(binsSql);
  const bins = binsResult.toArray().map((row: any) => {
    const raw = rowToJson(row);
    return { label: String(raw.label), value: String(raw.label), count: Number(raw.count) };
  });
  return { column, kind: 'categorical', total, nullCount, bins };
};
