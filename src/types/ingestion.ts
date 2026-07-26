export type IngestionFormat = 'parquet' | 'csv' | 'json' | 'geojson';
export type IngestionSourceKind = 'file' | 'url' | 'clipboard';

export type IngestionSource =
  | { kind: 'file'; file: File }
  | { kind: 'url'; url: string }
  | { kind: 'clipboard'; text: string; name?: string };

export type SourceFingerprint = {
  name: string;
  size: number;
  lastModified: number;
  format: IngestionFormat;
  sourceKind: IngestionSourceKind;
};

export type ParsedJsonDataset = {
  format: 'json' | 'geojson';
  rows: Record<string, unknown>[];
  invalidGeometryCount: number;
};
