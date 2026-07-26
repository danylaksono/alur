import type { GeometryKind } from './visualisation';

export const DATASET_SOURCE_VERSION = 1 as const;

export type DatasetSource =
  | { kind: 'layer'; layerId: string }
  | { kind: 'table'; datasetId: string; tableName: string; rowIdColumn: string }
  | { kind: 'workflow-node'; datasetId: string; nodeId: string; rowIdColumn: string };

export type DatasetDescriptor = {
  id: string;
  name: string;
  sourceVersion: typeof DATASET_SOURCE_VERSION;
  source: DatasetSource;
  fields: Array<{ name: string; type: string }>;
  rowCount?: number;
  rowIdColumn: string;
  rowIdQuality: 'validated-unique' | 'materialised' | 'map-feature-id';
  sourceUpdatedAt: number;
  spatial: boolean;
  /** Spatial metadata used by generic consumers such as comparison maps. */
  geometryColumn?: string;
  geometryCrs?: string;
  geometryKind?: GeometryKind;
  bounds?: [[number, number], [number, number]];
  /** Physical DuckDB relation used by the dataset query adapter. */
  relationName?: string;
  originTableName?: string;
};

export type DatasetKind = 'layer' | 'table' | 'workflow-node';

export type FieldSemanticType =
  | 'numeric'
  | 'categorical'
  | 'boolean'
  | 'temporal'
  | 'identifier'
  | 'geometry'
  | 'unknown';

export type DatasetField = {
  name: string;
  type: string;
  semanticType: FieldSemanticType;
};

export type DatasetMetadata = {
  id: string;
  name: string;
  kind: DatasetKind;
  fields: DatasetField[];
  rowCount?: number;
  geometryKind?: GeometryKind;
  crs?: string;
  featureIdColumn?: string;
  sourceUpdatedAt?: number;
};

export type DatasetFieldProfile = DatasetField & {
  nullCount: number;
  nullPercent: number;
  distinctCount: number;
  min?: number;
  max?: number;
  mean?: number;
  quantiles?: number[];
  temporalStart?: string;
  temporalEnd?: string;
};

export type DatasetProfileIssue = {
  id: string;
  severity: 'info' | 'warning';
  field?: string;
  message: string;
  action: 'inspect-field' | 'filter-missing' | 'inspect-identifiers' | 'inspect-geometry';
};

export type DatasetGeometryProfile = {
  kind?: GeometryKind;
  crs?: string;
  extent?: [[number, number], [number, number]];
  crsConfidence: 'high' | 'medium' | 'low' | 'assumed' | 'unknown';
  sampledFeatures: number;
  sampledValid: number;
};

export type DatasetProfile = {
  datasetId: string;
  rowCount: number;
  fieldCount: number;
  generatedAt: number;
  fields: DatasetFieldProfile[];
  geometry?: DatasetGeometryProfile;
  issues: DatasetProfileIssue[];
};
