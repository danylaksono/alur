import { duckdbService } from './duckdb';
import { downloadBlob, filenameTimestamp, safeFilename } from '../utils/download';
import {
  exportFormatSpec,
  featureCollectionToGeoJson,
  featureCollectionToGeoJsonSeq,
  featureCollectionToGpx,
  featureCollectionToKml,
  featureCollectionToWktCsv,
  looksProjected,
  type GeoExportFormat,
} from '../utils/geoExport';
import { createCompressedZipArchive } from '../utils/zipArchive';

/**
 * One place that turns "this SQL, in this format" into a downloadable file.
 *
 * Two routes exist because two different things are being exported. Tabular
 * formats (CSV/JSON/Parquet) are written by DuckDB itself, so the file matches
 * the table byte for byte. Geospatial formats go through GeoJSON, because that
 * is where DuckDB's geometry becomes coordinates the serialisers can reshape.
 */

export type BuiltExport = {
  blob: Blob;
  fileName: string;
  /** Null for tabular exports, where rows are never materialised in the browser. */
  featureCount: number | null;
  /** Non-fatal caveats worth telling the analyst about — truncation, CRS, lost geometry. */
  warnings: string[];
};

export type BuildExportOptions = {
  sql: string;
  format: GeoExportFormat | string;
  /** Used for the download filename and the KML document name. */
  baseName: string;
  /** Ceiling on features pulled into the browser for geospatial formats. */
  featureLimit?: number;
};

export class NoGeometryError extends Error {
  constructor() {
    super('This result has no geometry column, so it cannot be written as a spatial file. Export it as CSV, JSON or Parquet instead.');
    this.name = 'NoGeometryError';
  }
}

const exportTableName = (baseName: string) =>
  `alur_export_${safeFilename(baseName, 'output').replace(/-/g, '_')}_${Date.now()}`;

const textBlob = (text: string, mimeType: string) => new Blob([text], { type: `${mimeType};charset=utf-8` });

export const buildExport = async ({
  sql,
  format,
  baseName,
  featureLimit = 100000,
}: BuildExportOptions): Promise<BuiltExport> => {
  const spec = exportFormatSpec(format);
  const fileName = `${safeFilename(baseName, 'alur-export')}-${filenameTimestamp()}.${spec.extension}`;
  const warnings: string[] = [];

  if (!spec.needsGeometry) {
    const { buffer } = await duckdbService.exportTable(sql, spec.id as 'csv' | 'json' | 'parquet');
    // Copied into a fresh buffer: the view DuckDB returns is backed by WASM
    // memory that later queries may reuse or grow out from under the Blob.
    return { blob: new Blob([new Uint8Array(buffer)], { type: spec.mimeType }), fileName, featureCount: null, warnings };
  }

  const tableName = exportTableName(baseName);
  let collection: GeoJSON.FeatureCollection | null = null;
  try {
    await duckdbService.materializeQueryAsTable(sql, tableName);
    collection = await duckdbService.getGeoJSONFromTable(tableName, featureLimit);
  } finally {
    await duckdbService.query(`DROP TABLE IF EXISTS "${tableName}";`).catch(() => undefined);
  }

  if (!collection) throw new NoGeometryError();

  const featureCount = collection.features.length;
  if (featureCount >= featureLimit) {
    warnings.push(`Only the first ${featureLimit.toLocaleString()} features were written.`);
  }
  if (spec.requiresWgs84 && looksProjected(collection)) {
    warnings.push(`${spec.label} expects longitude/latitude, but these coordinates look projected. Reproject the result to EPSG:4326 first.`);
  }

  switch (spec.id) {
    case 'geojson':
      return { blob: textBlob(featureCollectionToGeoJson(collection), spec.mimeType), fileName, featureCount, warnings };
    case 'geojsonl':
      return { blob: textBlob(featureCollectionToGeoJsonSeq(collection), spec.mimeType), fileName, featureCount, warnings };
    case 'wkt-csv':
      return { blob: textBlob(featureCollectionToWktCsv(collection), spec.mimeType), fileName, featureCount, warnings };
    case 'kml':
      return {
        blob: textBlob(featureCollectionToKml(collection, { documentName: baseName }), spec.mimeType),
        fileName,
        featureCount,
        warnings,
      };
    case 'kmz': {
      const kml = featureCollectionToKml(collection, { documentName: baseName });
      // "doc.kml" is the conventional entry name every KMZ reader looks for.
      const archive = await createCompressedZipArchive([{ name: 'doc.kml', data: new TextEncoder().encode(kml) }]);
      return { blob: new Blob([archive.buffer as ArrayBuffer], { type: spec.mimeType }), fileName, featureCount, warnings };
    }
    case 'gpx': {
      const { gpx, skipped } = featureCollectionToGpx(collection, { documentName: baseName });
      if (skipped) {
        warnings.push(`${skipped.toLocaleString()} feature${skipped === 1 ? '' : 's'} had no GPX-compatible geometry and were left out.`);
      }
      return { blob: textBlob(gpx, spec.mimeType), fileName, featureCount: featureCount - skipped, warnings };
    }
    default:
      throw new Error(`Unsupported export format: ${spec.id}`);
  }
};

/** Builds the file and hands it to the browser. Returns the export for messaging. */
export const downloadExport = async (options: BuildExportOptions): Promise<BuiltExport> => {
  const result = await buildExport(options);
  downloadBlob(result.blob, result.fileName);
  return result;
};
