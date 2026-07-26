import { duckdbService } from './duckdb';
import { DATASET_SOURCE_VERSION, type DatasetDescriptor, type DatasetSource } from '../types/datasets';
import { tableDatasetId, workflowDatasetId } from '../utils/datasetSource';

const qi = (value: string) => `"${value.replace(/"/g, '""')}"`;
const normaliseRows = (rows: any[]) => rows.map((row) => typeof row?.toJSON === 'function' ? row.toJSON() : row);
const materialisedTables = new Map<string, { tableName: string; rowIdColumn: string }>();

const safeRelationSuffix = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${value.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 36)}_${(hash >>> 0).toString(36)}`;
};

const candidateIdentifierColumns = (fields: Array<{ name: string; type: string }>) => {
  const named = fields.filter((field) => /(^id$|_id$|^uuid$|_uuid$|^guid$|_guid$|^code$|_code$)/i.test(field.name));
  return [...named, ...fields.filter((field) => !named.includes(field))].slice(0, 8);
};

const validatedUniqueColumn = async (tableName: string, fields: Array<{ name: string; type: string }>) => {
  for (const field of candidateIdentifierColumns(fields)) {
    const column = qi(field.name);
    const result = await duckdbService.query(
      `SELECT COUNT(*) AS row_count, COUNT(${column}) AS non_null_count, COUNT(DISTINCT ${column}) AS distinct_count FROM ${qi(tableName)};`,
    );
    const row = normaliseRows(result.toArray())[0] || {};
    const rowCount = Number(row.row_count ?? 0);
    if (rowCount > 0 && Number(row.non_null_count) === rowCount && Number(row.distinct_count) === rowCount) return field.name;
  }
  return null;
};

export const ensureStableTableDataset = async ({
  tableName,
  name = tableName,
  source,
}: {
  tableName: string;
  name?: string;
  source?: DatasetSource;
}): Promise<DatasetDescriptor> => {
  const schema = normaliseRows((await duckdbService.getTableSchema(tableName)).toArray()).map((field) => ({ name: String(field.name), type: String(field.type || 'UNKNOWN') }));
  const rowCountResult = await duckdbService.query(`SELECT COUNT(*) AS row_count FROM ${qi(tableName)};`);
  const rowCount = Number(normaliseRows(rowCountResult.toArray())[0]?.row_count ?? 0);
  const uniqueColumn = await validatedUniqueColumn(tableName, schema);
  const datasetId = source?.kind === 'workflow-node' ? source.datasetId : source?.kind === 'table' ? source.datasetId : tableDatasetId(tableName);
  let relationName = tableName;
  let rowIdColumn = uniqueColumn;
  let rowIdQuality: DatasetDescriptor['rowIdQuality'] = 'validated-unique';

  if (!rowIdColumn) {
    const cached = materialisedTables.get(tableName);
    if (cached) {
      relationName = cached.tableName;
      rowIdColumn = cached.rowIdColumn;
    } else {
      relationName = `__alur_dataset_${safeRelationSuffix(tableName)}`;
      rowIdColumn = '__alur_row_id';
      await duckdbService.query(
        `CREATE OR REPLACE TABLE ${qi(relationName)} AS SELECT ROW_NUMBER() OVER ()::BIGINT AS ${qi(rowIdColumn)}, * FROM ${qi(tableName)};`,
      );
      materialisedTables.set(tableName, { tableName: relationName, rowIdColumn });
    }
    rowIdQuality = 'materialised';
  }

  const resolvedSource: DatasetSource = source?.kind === 'workflow-node'
    ? { ...source, rowIdColumn }
    : { kind: 'table', datasetId, tableName: relationName, rowIdColumn };
  return {
    id: datasetId,
    name,
    sourceVersion: DATASET_SOURCE_VERSION,
    source: resolvedSource,
    fields: rowIdQuality === 'materialised' ? [{ name: rowIdColumn, type: 'BIGINT' }, ...schema] : schema,
    rowCount,
    rowIdColumn,
    rowIdQuality,
    sourceUpdatedAt: Date.now(),
    spatial: false,
    relationName,
    originTableName: tableName,
  };
};

export const ensureWorkflowDataset = (nodeId: string, tableName: string, name?: string) => ensureStableTableDataset({
  tableName,
  name: name || tableName,
  source: { kind: 'workflow-node', datasetId: workflowDatasetId(nodeId), nodeId, rowIdColumn: '__alur_row_id' },
});

export const relationForDataset = (dataset: DatasetDescriptor) => dataset.relationName
  || (dataset.source.kind === 'table' ? dataset.source.tableName : null);

export const clearDatasetMaterialisationCache = () => materialisedTables.clear();
