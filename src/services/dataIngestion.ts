import { duckdbService } from './duckdb';
import { useStore } from '../store/useStore';
import { nextNodePosition } from '../utils/nodePlacement';
import type { IngestionFormat, IngestionSource, IngestionSourceKind, ParsedJsonDataset, SourceFingerprint } from '../types/ingestion';
import { ensureWorkflowDataset } from './datasetService';
import { cacheSource } from './sourceCache';
import { tableDatasetId } from '../utils/datasetSource';

const MAX_JSON_BYTES = 25 * 1024 * 1024;
const MAX_URL_BYTES = 50 * 1024 * 1024;
const URL_TIMEOUT_MS = 20_000;

const escapeSqlString = (value: string) => value.replace(/'/g, "''");
const qi = (value: string) => `"${value.replace(/"/g, '""')}"`;

export const tableNameForFile = (fileName: string) => {
  const baseName = fileName.replace(/\.[^/.]+$/, '');
  let tableName = baseName.replace(/[^a-zA-Z0-9]/g, '_');
  if (/^[0-9]/.test(tableName)) tableName = `t_${tableName}`;
  return tableName || `data_${Date.now()}`;
};

export const detectIngestionFormat = (fileName: string, mimeType = ''): IngestionFormat | null => {
  const lower = fileName.toLowerCase().split(/[?#]/)[0];
  if (lower.endsWith('.parquet') || mimeType.includes('parquet')) return 'parquet';
  if (lower.endsWith('.csv') || mimeType.includes('csv')) return 'csv';
  if (lower.endsWith('.geojson') || mimeType.includes('geo+json')) return 'geojson';
  if (lower.endsWith('.json') || mimeType.includes('json')) return 'json';
  return null;
};

export const isIngestableFile = (fileName: string) => detectIngestionFormat(fileName) !== null;

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const featureRow = (feature: Record<string, unknown>) => {
  const properties = isRecord(feature.properties) ? feature.properties : {};
  const geometry = isRecord(feature.geometry) && typeof feature.geometry.type === 'string' ? feature.geometry : null;
  return {
    ...properties,
    ...(feature.id === undefined || Object.hasOwn(properties, '__geojson_id') ? {} : { __geojson_id: feature.id }),
    __alur_geojson: geometry ? JSON.stringify(geometry) : null,
  };
};

export const parseJsonDataset = (text: string): ParsedJsonDataset => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error: any) {
    throw new Error(`Invalid JSON: ${error?.message || 'the document could not be parsed'}`);
  }

  if (isRecord(value) && value.type === 'FeatureCollection') {
    if (!Array.isArray(value.features)) throw new Error('Invalid GeoJSON FeatureCollection: "features" must be an array.');
    const features = value.features.filter(isRecord);
    const invalidGeometryCount = features.filter((feature) => feature.geometry !== null && (!isRecord(feature.geometry) || typeof feature.geometry.type !== 'string')).length;
    return { format: 'geojson', rows: features.map(featureRow), invalidGeometryCount };
  }
  if (isRecord(value) && value.type === 'Feature') {
    const invalidGeometryCount = value.geometry !== null && (!isRecord(value.geometry) || typeof value.geometry.type !== 'string') ? 1 : 0;
    return { format: 'geojson', rows: [featureRow(value)], invalidGeometryCount };
  }

  const candidateRows = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.data)
      ? value.data
      : [value];
  if (!candidateRows.length) throw new Error('The JSON document contains no rows.');
  if (!candidateRows.every(isRecord)) throw new Error('JSON data must be an object, an array of objects, or an object with a data array.');
  return { format: 'json', rows: candidateRows, invalidGeometryCount: 0 };
};

const fingerprintFor = (file: File, format: IngestionFormat, sourceKind: IngestionSourceKind): SourceFingerprint => ({
  name: file.name,
  size: file.size,
  lastModified: file.lastModified,
  format,
  sourceKind,
});

const registerJsonDataset = async (tableName: string, parsed: ParsedJsonDataset) => {
  if (!parsed.rows.length) throw new Error('The JSON document contains no rows.');
  if (parsed.format === 'json') {
    await duckdbService.registerJsonRows(tableName, parsed.rows);
    return;
  }
  const rawTable = `__alur_json_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  await duckdbService.registerJsonRows(rawTable, parsed.rows);
  await duckdbService.query(`
    CREATE OR REPLACE TABLE ${qi(tableName)} AS
    SELECT * EXCLUDE (__alur_geojson),
      CASE WHEN __alur_geojson IS NULL THEN NULL ELSE TRY(ST_GeomFromGeoJSON(__alur_geojson)) END AS geometry
    FROM ${qi(rawTable)};
    DROP TABLE ${qi(rawTable)};
  `);
};

/**
 * Turns a table that is already in DuckDB into a node and a map layer.
 *
 * Shared by the file path and the remote range-read path so a dataset has one
 * way of coming into existence rather than two, only one of which is tested.
 * Everything before this point differs (a File is registered, a URL is
 * scanned); everything after it — geometry inspection, CRS estimate, tile
 * source, layer, toast — is identical and belongs in one place.
 */
export const finaliseIngestedTable = async ({
  nodeId,
  tableName,
  displayName,
  fingerprint,
  updateStage,
  operationId,
  invalidGeometryCount = 0,
}: {
  nodeId: string;
  tableName: string;
  displayName: string;
  fingerprint: SourceFingerprint;
  updateStage: (detail: string, progress: number) => void;
  operationId: string;
  invalidGeometryCount?: number;
}): Promise<{ tableName: string; layerId: string | null }> => {
  const { addToast } = useStore.getState();

  updateStage('Inspecting geometry and coordinate system…', 45);
  const source = await duckdbService.prepareLayerSource(tableName, { kind: 'duckdb-table' });
  const totalRows = await duckdbService.getTableFeatureCount(tableName);

  if (!source) {
    const dataset = await ensureWorkflowDataset(nodeId, tableName, displayName);
    const currentConfig = useStore.getState().nodes.find((node) => node.id === nodeId)?.data.config || {};
    useStore.getState().rebindDataset(tableDatasetId(tableName), dataset);
    useStore.getState().updateNode(nodeId, { ...currentConfig, tableName: dataset.relationName || tableName, datasetId: dataset.id, fileName: displayName, sourceFingerprint: fingerprint, featureCount: totalRows, rowIdColumn: dataset.rowIdColumn, rowIdQuality: dataset.rowIdQuality, loadStatus: 'ready', loadStage: undefined });
    useStore.getState().setSelectedNodeId(nodeId);
    useStore.getState().finishLoadingOperation(operationId);
    addToast({ type: 'warning', message: `Registered ${totalRows.toLocaleString()} rows as ${tableName}, but found no renderable geometry or latitude/longitude fields.` });
    return { tableName, layerId: null };
  }

  updateStage('Preparing map features…', 78);
  const renderedFeatureCount = await duckdbService.getTableFeatureCount(source.tileSource.tableName);
  const { updateNode: updateNodeAgain, addMapLayer, focusLayer } = useStore.getState();
  const baseConfig = useStore.getState().nodes.find((node) => node.id === nodeId)?.data.config || {};
  updateNodeAgain(nodeId, {
    ...baseConfig,
    tableName,
    fileName: displayName,
    sourceFingerprint: fingerprint,
    featureCount: totalRows,
    invalidGeometryCount: Math.max(totalRows - renderedFeatureCount, invalidGeometryCount),
    crs: source.crs,
    crsName: source.crsName,
    crsConfidence: source.crsConfidence,
    crsReason: source.crsReason,
    loadStatus: 'ready',
    loadStage: undefined,
  });
  addMapLayer({ id: tableName, name: displayName, source, tileSource: source.tileSource, featureCount: renderedFeatureCount, sourceNodeId: nodeId, sourceKind: 'input' });
  focusLayer(tableName);
  useStore.getState().updateLoadingOperation(operationId, { detail: 'Drawing features on the map…', progress: 92, waitForLayerId: tableName });
  const skipped = Math.max(0, totalRows - renderedFeatureCount);
  addToast({
    type: skipped ? 'warning' : 'success',
    message: skipped
      ? `Loaded ${renderedFeatureCount.toLocaleString()} map features from ${displayName}; preserved ${skipped.toLocaleString()} rows without valid geometry in the table.`
      : `Loaded ${renderedFeatureCount.toLocaleString()} features from ${displayName}.`,
  });
  return { tableName, layerId: tableName };
};

/** Shared, typed ingestion path used by file pickers, URL/clipboard imports, and drag-and-drop. */
export const ingestFile = async (
  file: File,
  options: { nodeId?: string; position?: { x: number; y: number }; sourceKind?: IngestionSourceKind } = {},
): Promise<{ tableName: string; layerId: string | null } | null> => {
  const { addNode, addToast, startLoadingOperation } = useStore.getState();
  const detectedFormat = detectIngestionFormat(file.name, file.type);

  if (!detectedFormat) {
    addToast({ type: 'error', message: `Unsupported file type: ${file.name}. Use Parquet, CSV, JSON, or GeoJSON.` });
    return null;
  }
  if ((detectedFormat === 'json' || detectedFormat === 'geojson') && file.size > MAX_JSON_BYTES) {
    addToast({ type: 'error', message: `${file.name} is too large for guarded JSON parsing (${Math.round(file.size / 1024 / 1024)} MB; limit ${MAX_JSON_BYTES / 1024 / 1024} MB). Convert it to Parquet for larger datasets.` });
    return null;
  }

  const operationId = `ingest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  startLoadingOperation({ id: operationId, title: 'Loading data', detail: 'Inspecting the source…', progress: 8, fileName: file.name });

  let nodeId = options.nodeId;
  const sourceKind = options.sourceKind || 'file';
  let fingerprint = fingerprintFor(file, detectedFormat, sourceKind);
  if (!nodeId) {
    nodeId = `input-${Date.now()}`;
    addNode({
      id: nodeId,
      type: 'input',
      position: options.position ?? nextNodePosition(useStore.getState().nodes),
      data: { label: 'Data Source', type: 'input', config: { fileName: file.name, sourceFingerprint: fingerprint, loadStatus: 'loading', loadStage: 'Inspecting source…' } },
    });
  }

  const updateStage = (detail: string, progress: number) => {
    const state = useStore.getState();
    state.updateLoadingOperation(operationId, { detail, progress });
    const currentConfig = state.nodes.find((node) => node.id === nodeId)?.data.config || {};
    state.updateNode(nodeId!, { ...currentConfig, fileName: file.name, sourceFingerprint: fingerprint, loadStatus: 'loading', loadStage: detail });
  };

  try {
    const tableName = tableNameForFile(file.name);
    const quotedTableName = qi(tableName);
    let invalidGeometryCount = 0;

    if (detectedFormat === 'json' || detectedFormat === 'geojson') {
      updateStage('Parsing JSON safely in the browser…', 18);
      const parsed = parseJsonDataset(await file.text());
      fingerprint = fingerprintFor(file, parsed.format, sourceKind);
      invalidGeometryCount = parsed.invalidGeometryCount;
      updateStage(parsed.format === 'geojson' ? 'Converting GeoJSON geometry…' : 'Registering JSON rows…', 32);
      await registerJsonDataset(tableName, parsed);
    } else {
      updateStage('Registering the file with DuckDB…', 12);
      const normalizedFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const filePath = `${Date.now()}_${normalizedFileName}`;
      const registered = await duckdbService.registerUploadedFile(filePath, file, detectedFormat);
      updateStage('Opening the dataset…', 28);
      const scanSql = registered.scanSql || (detectedFormat === 'csv'
        ? `read_csv_auto('${escapeSqlString(registered.path)}')`
        : `read_parquet('${escapeSqlString(registered.path)}')`);
      await duckdbService.query(`CREATE OR REPLACE VIEW ${quotedTableName} AS SELECT * FROM ${scanSql};`);
    }

    // Keep a copy so reopening this project does not mean re-picking the file.
    // Deliberately not awaited: the user is waiting on the map, not on a cache,
    // and a failure here costs a convenience rather than the dataset.
    void cacheSource(file, { format: detectedFormat });

    return await finaliseIngestedTable({
      nodeId,
      tableName,
      displayName: file.name,
      fingerprint,
      updateStage,
      operationId,
      invalidGeometryCount,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const state = useStore.getState();
    const currentConfig = state.nodes.find((node) => node.id === nodeId)?.data.config || {};
    state.updateNode(nodeId!, { ...currentConfig, fileName: file.name, sourceFingerprint: fingerprint, loadStatus: 'error', loadStage: undefined, loadError: message });
    state.finishLoadingOperation(operationId);
    addToast({ type: 'error', message: `Error loading ${file.name}: ${message}` });
    return null;
  }
};

const fileNameFromUrl = (url: URL, contentType: string) => {
  const name = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) || 'remote-data');
  if (detectIngestionFormat(name, contentType)) return name;
  if (contentType.includes('geo+json')) return `${name}.geojson`;
  if (contentType.includes('json')) return `${name}.json`;
  if (contentType.includes('csv')) return `${name}.csv`;
  if (contentType.includes('parquet')) return `${name}.parquet`;
  return name;
};

export const ingestUrl = async (input: string) => {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Enter a valid HTTPS URL.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only HTTP and HTTPS data URLs are supported.');
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), URL_TIMEOUT_MS);
  try {
    const response = await fetch(url, { credentials: 'omit', signal: controller.signal });
    if (!response.ok) throw new Error(`The server returned ${response.status} ${response.statusText}.`);
    const statedSize = Number(response.headers.get('content-length') || 0);
    if (statedSize > MAX_URL_BYTES) throw new Error(`The remote file is larger than the ${MAX_URL_BYTES / 1024 / 1024} MB URL limit.`);
    const blob = await response.blob();
    if (blob.size > MAX_URL_BYTES) throw new Error(`The downloaded file is larger than the ${MAX_URL_BYTES / 1024 / 1024} MB URL limit.`);
    const name = fileNameFromUrl(url, response.headers.get('content-type') || blob.type);
    if (!detectIngestionFormat(name, blob.type)) throw new Error('The URL does not identify a supported Parquet, CSV, JSON, or GeoJSON resource.');
    return ingestFile(new File([blob], name, { type: blob.type, lastModified: Date.now() }), { sourceKind: 'url' });
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('The data URL timed out after 20 seconds.');
    throw new Error(`Could not load the data URL. ${error?.message || 'Check CORS access and try again.'}`);
  } finally {
    window.clearTimeout(timeout);
  }
};

export const ingestClipboardText = async (text: string, name = 'clipboard.json') => {
  if (!text.trim()) throw new Error('Paste JSON or GeoJSON first.');
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > MAX_JSON_BYTES) throw new Error(`Pasted text exceeds the ${MAX_JSON_BYTES / 1024 / 1024} MB limit.`);
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    // Parse before starting ingestion so syntax errors leave no half-created node.
    const parsed = parseJsonDataset(text);
    const extension = parsed.format === 'geojson' ? 'geojson' : 'json';
    const fileName = name.replace(/\.(csv|tsv|json|geojson)$/i, '') + `.${extension}`;
    return ingestFile(new File([text], fileName, { type: parsed.format === 'geojson' ? 'application/geo+json' : 'application/json', lastModified: Date.now() }), { sourceKind: 'clipboard' });
  }
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const delimiter = lines[0]?.includes('\t') ? '\t' : ',';
  if (lines.length < 2 || !lines[0].includes(delimiter)) throw new Error('Paste JSON, GeoJSON, CSV, or TSV with a header row.');
  const fileName = name.replace(/\.(csv|tsv|json|geojson)$/i, '') + '.csv';
  return ingestFile(new File([text], fileName, { type: 'text/csv', lastModified: Date.now() }), { sourceKind: 'clipboard' });
};

export const ingestSource = (source: IngestionSource) => {
  if (source.kind === 'file') return ingestFile(source.file, { sourceKind: 'file' });
  if (source.kind === 'url') return ingestUrl(source.url);
  return ingestClipboardText(source.text, source.name);
};
