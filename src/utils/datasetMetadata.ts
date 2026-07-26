import type { MapLayer, WorkflowNode } from '../store/useStore';
import type { DatasetField, DatasetMetadata, FieldSemanticType } from '../types/datasets';
import type { LayerField } from '../types/layers';

const SYSTEM_FIELDS = new Set([
  'geojson',
  'geometry',
  'geom',
  'wkb_geometry',
  '__alur_tile_geom',
  '_alur_feature_id',
]);

const NUMERIC_TYPE = /tinyint|smallint|integer|bigint|hugeint|utinyint|usmallint|uinteger|ubigint|float|double|decimal|numeric|real/i;
const TEMPORAL_TYPE = /date|timestamp|time|interval/i;
const BOOLEAN_TYPE = /bool/i;
const GEOMETRY_TYPE = /geometry|geography|point|linestring|polygon/i;
const IDENTIFIER_NAME = /(^id$|_id$|^uuid$|_uuid$|^guid$|_guid$|^code$|_code$|reference|identifier)/i;

export const inferFieldSemanticType = (field: LayerField): FieldSemanticType => {
  const name = field.name.trim();
  const type = field.type.trim();
  const lowerName = name.toLowerCase();

  if (SYSTEM_FIELDS.has(lowerName) || GEOMETRY_TYPE.test(type)) return 'geometry';
  if (BOOLEAN_TYPE.test(type)) return 'boolean';
  if (TEMPORAL_TYPE.test(type)) return 'temporal';
  if (IDENTIFIER_NAME.test(name)) return 'identifier';
  if (NUMERIC_TYPE.test(type)) return 'numeric';
  if (/char|string|text|varchar|enum/i.test(type)) return 'categorical';
  return 'unknown';
};

export const datasetFields = (fields: LayerField[]): DatasetField[] =>
  fields
    .map((field) => ({ ...field, semanticType: inferFieldSemanticType(field) }))
    .filter((field) => field.semanticType !== 'geometry' && !field.name.toLowerCase().startsWith('__alur_'))
    .sort((a, b) => a.name.localeCompare(b.name));

export const metadataForLayer = (layer: MapLayer): DatasetMetadata => ({
  id: layer.id,
  name: layer.name,
  kind: 'layer',
  fields: datasetFields(layer.source.fields),
  rowCount: layer.featureCount,
  geometryKind: layer.source.geometryKind,
  crs: layer.source.kind === 'duckdb-table' || layer.source.kind === 'duckdb-query'
    ? layer.source.crs
    : undefined,
  featureIdColumn: layer.source.kind === 'duckdb-table' || layer.source.kind === 'duckdb-query'
    ? layer.source.featureIdColumn
    : '_alur_feature_id',
  sourceUpdatedAt: layer.createdAt,
});

type SchemaField = { name?: unknown; type?: unknown };

const schemaFields = (schema: unknown[] | undefined): LayerField[] =>
  (schema || []).flatMap((field) => {
    if (!field || typeof field !== 'object') return [];
    const { name, type } = field as SchemaField;
    if (typeof name !== 'string' || !name.trim()) return [];
    return [{ name, type: typeof type === 'string' ? type : 'UNKNOWN' }];
  });

export const metadataForWorkflowNode = (
  node: WorkflowNode,
  schema: unknown[] | undefined,
): DatasetMetadata => ({
  id: node.id,
  name: node.data.label,
  kind: 'workflow-node',
  fields: datasetFields(schemaFields(schema)),
  rowCount: typeof node.data.config?.featureCount === 'number'
    ? node.data.config.featureCount
    : undefined,
});

export const fieldByName = (metadata: DatasetMetadata, name: string) =>
  metadata.fields.find((field) => field.name === name);

export const preferredExplorationField = (metadata: DatasetMetadata) => {
  const preference: FieldSemanticType[] = ['categorical', 'numeric', 'temporal', 'boolean', 'unknown', 'identifier'];
  for (const semanticType of preference) {
    const field = metadata.fields.find((candidate) => candidate.semanticType === semanticType);
    if (field) return field;
  }
  return undefined;
};

