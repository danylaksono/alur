export type IngestionFormat = 'parquet' | 'csv' | 'json' | 'geojson';
/**
 * `url` downloads the whole file and then reads it; `remote` leaves the file
 * where it is and reads parts of it over HTTP range requests. They are kept
 * apart because only `remote` can be reopened from a saved project without the
 * original bytes, and only `url` is bounded by a download cap.
 */
export type IngestionSourceKind = 'file' | 'url' | 'clipboard' | 'remote';

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
