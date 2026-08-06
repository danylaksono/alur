import { useStore } from '../store/useStore';
import { ingestFile } from './dataIngestion';
import { duckdbService } from './duckdb';
import { downloadBlob, downloadText, filenameTimestamp, safeFilename } from '../utils/download';
import { describeDrawnLayer, toGeoJson, type DrawnLayer } from '../utils/drawnFeatures';

/**
 * Turns a hand-drawn layer into an ordinary ALUR dataset.
 *
 * Deliberately routed through `ingestFile` rather than writing to DuckDB
 * directly. A drawn layer *is* a GeoJSON FeatureCollection, so going through
 * the loading path gets geometry conversion, CRS detection, the dataset
 * registry entry, the map layer and the source cache for free — and, more
 * importantly, keeps drawn data on exactly the same footing as loaded data.
 * Everything downstream then works without being taught that drawing exists.
 */

const fileNameFor = (layer: DrawnLayer) => `${safeFilename(layer.name, 'drawn-layer')}.geojson`;

export const commitDrawnLayer = async (nodeId: string, layer: DrawnLayer) => {
  const { addToast, recordProvenance } = useStore.getState();
  if (!layer.features.length) {
    addToast({ type: 'warning', message: 'Draw at least one feature before creating the dataset.' });
    return null;
  }

  const text = JSON.stringify(toGeoJson(layer));
  const file = new File([text], fileNameFor(layer), { type: 'application/geo+json' });
  const result = await ingestFile(file, { nodeId, sourceKind: 'clipboard' });
  if (!result) return null;

  const summary = describeDrawnLayer(layer);
  recordProvenance({
    activity: 'dataset.created',
    entityId: result.tableName,
    generated: [result.layerId || result.tableName],
    payload: {
      name: layer.name,
      featureCount: summary.total,
      kinds: { point: summary.point, line: summary.line, polygon: summary.polygon },
      fields: layer.fields.map((field) => field.name),
    },
  });
  return result;
};

export const downloadDrawnLayerGeoJson = (layer: DrawnLayer) => {
  downloadText(JSON.stringify(toGeoJson(layer), null, 2), fileNameFor(layer), 'application/geo+json;charset=utf-8');
};

/**
 * Parquet comes from DuckDB rather than from the model, so the export matches
 * the table the rest of the app reads — including the geometry conversion the
 * ingestion path applied. Only available once the layer has been committed.
 */
export const downloadDrawnLayerParquet = async (tableName: string, layerName: string) => {
  const { addToast } = useStore.getState();
  try {
    const { buffer } = await duckdbService.exportTable(`SELECT * FROM "${tableName.replace(/"/g, '""')}"`, 'parquet');
    const name = `${safeFilename(layerName, 'drawn-layer')}-${filenameTimestamp()}.parquet`;
    // Copied into a fresh buffer: the view DuckDB returns is backed by WASM
    // memory that later queries may reuse or grow out from under the Blob.
    downloadBlob(new Blob([new Uint8Array(buffer)], { type: 'application/octet-stream' }), name);
  } catch (error) {
    addToast({ type: 'error', message: `Could not export Parquet: ${error instanceof Error ? error.message : String(error)}` });
  }
};
