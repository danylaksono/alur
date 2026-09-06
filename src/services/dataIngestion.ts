import { duckdbService } from "./duckdb";
import { useStore } from "../store/useStore";
import { nextNodePosition } from "../utils/nodePlacement";
import type {
  IngestionFormat,
  IngestionSource,
  IngestionSourceKind,
  ParsedJsonDataset,
  SourceFingerprint,
} from "../types/ingestion";
import { ensureWorkflowDataset } from "./datasetService";
import { cacheSource } from "./sourceCache";
import { tableDatasetId } from "../utils/datasetSource";

const MAX_JSON_BYTES = 25 * 1024 * 1024;
const MAX_URL_BYTES = 50 * 1024 * 1024;
const URL_TIMEOUT_MS = 20_000;

const escapeSqlString = (value: string) => value.replace(/'/g, "''");
const qi = (value: string) => `"${value.replace(/"/g, '""')}"`;

export const tableNameForFile = (fileName: string) => {
  const baseName = fileName.replace(/\.[^/.]+$/, "");
  let tableName = baseName.replace(/[^a-zA-Z0-9]/g, "_");
  if (/^[0-9]/.test(tableName)) tableName = `t_${tableName}`;
  return tableName || `data_${Date.now()}`;
};

/**
 * Formats DuckDB's spatial extension reads through GDAL.
 *
 * The extension bundles GDAL, so this costs no dependency — ST_Read opens all
 * of them and works out which is which. `.zip` is here because that is how a
 * Shapefile actually arrives: it is several files that have to travel together,
 * and the archive is unpacked before DuckDB sees it.
 */
const SPATIAL_EXTENSIONS = [
  '.shp',
  '.zip',
  '.gpkg',
  '.kml',
  '.gpx',
  '.fgb',
  '.gml',
  '.tab',
  '.topojson',
  '.geojsonl',
  '.geojsons',
];

/** The member of an unpacked archive worth opening, in order of preference. */
const ARCHIVE_PRIMARY_EXTENSIONS = ['.shp', '.gpkg', '.gml', '.tab', '.kml', '.geojson', '.fgb'];

export const detectIngestionFormat = (
  fileName: string,
  mimeType = "",
): IngestionFormat | null => {
  const lower = fileName.toLowerCase().split(/[?#]/)[0];
  if (lower.endsWith(".parquet") || mimeType.includes("parquet"))
    return "parquet";
  if (lower.endsWith(".csv") || mimeType.includes("csv")) return "csv";
  if (lower.endsWith(".geojson") || mimeType.includes("geo+json"))
    return "geojson";
  if (lower.endsWith(".json") || mimeType.includes("json")) return "json";
  if (SPATIAL_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "spatial";
  return null;
};

export const isIngestableFile = (fileName: string) =>
  detectIngestionFormat(fileName) !== null;

/**
 * Registers a GDAL-readable file and returns the SQL that opens it.
 *
 * A Shapefile is not one file: the geometry is in `.shp`, the index in `.shx`
 * and the attributes in `.dbf`, and GDAL needs all three side by side. It finds
 * them by basename, so an archive is unpacked and its members are registered
 * flat under one prefix — collisions between two uploads are what the prefix is
 * for. GDAL's own `/vsizip/` cannot be used: it reads the real filesystem and
 * cannot see anything DuckDB has registered in memory.
 */
const registerSpatialFile = async (file: File): Promise<string> => {
  const prefix = `spatial_${Date.now()}_${Math.random().toString(36).slice(2, 7)}_`;
  const safe = (name: string) => prefix + name.replace(/[^a-zA-Z0-9._-]/g, "_");

  if (!file.name.toLowerCase().endsWith(".zip")) {
    const path = safe(file.name);
    await duckdbService.registerFileBuffer(
      path,
      new Uint8Array(await file.arrayBuffer()),
    );
    return `ST_Read('${escapeSqlString(path)}')`;
  }

  const { unzipSync } = await import("fflate");
  const members = unzipSync(new Uint8Array(await file.arrayBuffer()));
  // Flattened: GDAL matches sidecars on basename, and a nested archive would
  // otherwise separate a .shp from the .dbf that belongs to it.
  const registered = new Map<string, string>();
  for (const [entry, bytes] of Object.entries(members)) {
    const base = entry.split("/").pop();
    if (!base || !bytes.length) continue;
    const path = safe(base);
    await duckdbService.registerFileBuffer(path, bytes);
    registered.set(base.toLowerCase(), path);
  }

  const primary = ARCHIVE_PRIMARY_EXTENSIONS.flatMap((ext) =>
    [...registered.entries()].filter(([name]) => name.endsWith(ext)),
  )[0];
  if (!primary) {
    throw new Error(
      `${file.name} contains no spatial file this can open. Expected one of ${ARCHIVE_PRIMARY_EXTENSIONS.join(", ")} inside the archive.`,
    );
  }
  return `ST_Read('${escapeSqlString(primary[1])}')`;
};

// --- H3 cell detection ------------------------------------------------------

/** Canonical H3 cell ids in their string form are 15–16 hex digits. */
export const H3_CELL_ID_PATTERN = /^[0-9a-f]{15,16}$/i;

/** Whether a single value is plausibly an H3 cell id. */
export const looksLikeH3Cell = (value: unknown): boolean =>
  typeof value === "string" && H3_CELL_ID_PATTERN.test(value);

/** Ranks a column name as a candidate H3 cell column (name hint or generic). */
export const h3CellColumnScore = (name: string): number =>
  /h3|hex|cell|cell_id|hexagon|index/i.test(name) ? 2 : 1;

/**
 * When a loaded table holds only H3 cell ids (a deliberately geometry-free
 * parquet, for size), derive each cell's boundary as a GEOMETRY column in a
 * view so the existing layer pipeline can draw it. The original file is
 * untouched and the cell column stays in the table, so downstream H3 nodes can
 * still operate on it.
 */
export const maybeDeriveH3Geometry = async (
  tableName: string,
): Promise<{ view: string; cellColumn: string } | null> => {
  try {
    const schema = (await duckdbService.getTableSchema(tableName))
      .toArray()
      .map((row: any) =>
        typeof row.toJSON === "function" ? row.toJSON() : row,
      );
    const stringCols = schema.filter((col: any) =>
      /varchar|char|text|string/i.test(String(col.type || "")),
    );
    if (!stringCols.length) return null;

    const ordered = [...stringCols].sort(
      (a, b) =>
        h3CellColumnScore(String(b.name)) - h3CellColumnScore(String(a.name)),
    );

    for (const col of ordered.slice(0, 3)) {
      const name = String(col.name);
      const q = qi(name);
      const probe = await duckdbService.query(
        `SELECT COUNT(*) AS total, COUNT_IF(LOWER(${q}) ~ '^[0-9a-f]{15,16}$') AS matched ` +
          `FROM (SELECT ${q} FROM ${qi(tableName)} WHERE ${q} IS NOT NULL LIMIT 1000) t`,
      );
      const probeRow = probe.toArray()[0];
      const row =
        typeof probeRow?.toJSON === "function" ? probeRow.toJSON() : probeRow;
      const total = Number(row?.total ?? 0);
      const matched = Number(row?.matched ?? 0);
      if (total === 0 || matched !== total) continue;

      // The regex is a strong signal; h3_string_to_h3 is the authority. Confirm
      // a sample actually parses before building a view we are going to tile.
      const loaded = await duckdbService.ensureH3();
      if (!loaded) return null;
      const confirm = await duckdbService.query(
        `SELECT COUNT_IF(TRY(h3_string_to_h3(${q})) IS NULL) AS invalid ` +
          `FROM (SELECT ${q} FROM ${qi(tableName)} WHERE ${q} IS NOT NULL LIMIT 100) t`,
      );
      const confirmRow = confirm.toArray()[0];
      const confirmJson =
        typeof confirmRow?.toJSON === "function"
          ? confirmRow.toJSON()
          : confirmRow;
      if (Number(confirmJson?.invalid ?? 1) > 0) continue;

      const view = await deriveH3GeometryView(tableName, name);
      return { view, cellColumn: name };
    }
    return null;
  } catch {
    return null;
  }
};

const deriveH3GeometryView = async (
  tableName: string,
  cellColumn: string,
): Promise<string> => {
  const schema = (await duckdbService.getTableSchema(tableName))
    .toArray()
    .map((row: any) => (typeof row.toJSON === "function" ? row.toJSON() : row));
  const carried = schema
    .map((col: any) => String(col.name || ""))
    .filter(
      (name: string) =>
        !["geometry", "geom", "wkb_geometry"].includes(name.toLowerCase()),
    )
    .map(qi)
    .join(", ");
  const view = `${tableName}__h3geom`;
  await duckdbService.query(
    `CREATE OR REPLACE VIEW ${qi(view)} AS ` +
      `SELECT ${carried}, ST_GeomFromText(h3_cell_to_boundary_wkt(h3_string_to_h3(${qi(cellColumn)}))) AS geometry ` +
      `FROM ${qi(tableName)};`,
  );
  return view;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const featureRow = (feature: Record<string, unknown>) => {
  const properties = isRecord(feature.properties) ? feature.properties : {};
  const geometry =
    isRecord(feature.geometry) && typeof feature.geometry.type === "string"
      ? feature.geometry
      : null;
  return {
    ...properties,
    ...(feature.id === undefined || Object.hasOwn(properties, "__geojson_id")
      ? {}
      : { __geojson_id: feature.id }),
    __alur_geojson: geometry ? JSON.stringify(geometry) : null,
  };
};

export const parseJsonDataset = (text: string): ParsedJsonDataset => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error: any) {
    throw new Error(
      `Invalid JSON: ${error?.message || "the document could not be parsed"}`,
    );
  }

  if (isRecord(value) && value.type === "FeatureCollection") {
    if (!Array.isArray(value.features))
      throw new Error(
        'Invalid GeoJSON FeatureCollection: "features" must be an array.',
      );
    const features = value.features.filter(isRecord);
    const invalidGeometryCount = features.filter(
      (feature) =>
        feature.geometry !== null &&
        (!isRecord(feature.geometry) ||
          typeof feature.geometry.type !== "string"),
    ).length;
    return {
      format: "geojson",
      rows: features.map(featureRow),
      invalidGeometryCount,
    };
  }
  if (isRecord(value) && value.type === "Feature") {
    const invalidGeometryCount =
      value.geometry !== null &&
      (!isRecord(value.geometry) || typeof value.geometry.type !== "string")
        ? 1
        : 0;
    return {
      format: "geojson",
      rows: [featureRow(value)],
      invalidGeometryCount,
    };
  }

  const candidateRows = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.data)
      ? value.data
      : [value];
  if (!candidateRows.length)
    throw new Error("The JSON document contains no rows.");
  if (!candidateRows.every(isRecord))
    throw new Error(
      "JSON data must be an object, an array of objects, or an object with a data array.",
    );
  return { format: "json", rows: candidateRows, invalidGeometryCount: 0 };
};

const fingerprintFor = (
  file: File,
  format: IngestionFormat,
  sourceKind: IngestionSourceKind,
): SourceFingerprint => ({
  name: file.name,
  size: file.size,
  lastModified: file.lastModified,
  format,
  sourceKind,
});

const registerJsonDataset = async (
  tableName: string,
  parsed: ParsedJsonDataset,
) => {
  if (!parsed.rows.length)
    throw new Error("The JSON document contains no rows.");
  if (parsed.format === "json") {
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
  tableName: initialTableName,
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
  let tableName = initialTableName;
  let derivedH3: { view: string; cellColumn: string } | null = null;

  updateStage("Inspecting geometry and coordinate system…", 45);
  let source = await duckdbService.prepareLayerSource(tableName, {
    kind: "duckdb-table",
  });

  if (!source) {
    // An H3-only table (cell ids, no geometry — a deliberately trimmed file)
    // can still be drawn: derive the hexagon boundary geometry and re-inspect.
    derivedH3 = await maybeDeriveH3Geometry(tableName);
    if (derivedH3) {
      tableName = derivedH3.view;
      updateStage("Deriving H3 cell boundaries…", 55);
      source = await duckdbService.prepareLayerSource(tableName, {
        kind: "duckdb-table",
      });
    }
  }

  const totalRows = await duckdbService.getTableFeatureCount(tableName);

  if (!source) {
    const dataset = await ensureWorkflowDataset(nodeId, tableName, displayName);
    const currentConfig =
      useStore.getState().nodes.find((node) => node.id === nodeId)?.data
        .config || {};
    useStore.getState().rebindDataset(tableDatasetId(tableName), dataset);
    useStore
      .getState()
      .updateNode(nodeId, {
        ...currentConfig,
        tableName: dataset.relationName || tableName,
        datasetId: dataset.id,
        fileName: displayName,
        sourceFingerprint: fingerprint,
        featureCount: totalRows,
        rowIdColumn: dataset.rowIdColumn,
        rowIdQuality: dataset.rowIdQuality,
        loadStatus: "ready",
        loadStage: undefined,
      });
    useStore.getState().setSelectedNodeId(nodeId);
    useStore.getState().finishLoadingOperation(operationId);
    addToast({
      type: "warning",
      message: `Registered ${totalRows.toLocaleString()} rows as ${tableName}, but found no renderable geometry or latitude/longitude fields.`,
    });
    return { tableName, layerId: null };
  }

  updateStage("Preparing map features…", 78);
  const renderedFeatureCount = await duckdbService.getTableFeatureCount(
    source.tileSource.tableName,
  );
  const {
    updateNode: updateNodeAgain,
    addMapLayer,
    focusLayer,
  } = useStore.getState();
  const baseConfig =
    useStore.getState().nodes.find((node) => node.id === nodeId)?.data.config ||
    {};
  updateNodeAgain(nodeId, {
    ...baseConfig,
    tableName,
    fileName: displayName,
    sourceFingerprint: fingerprint,
    featureCount: totalRows,
    invalidGeometryCount: Math.max(
      totalRows - renderedFeatureCount,
      invalidGeometryCount,
    ),
    crs: source.crs,
    crsName: source.crsName,
    crsConfidence: source.crsConfidence,
    crsReason: source.crsReason,
    loadStatus: "ready",
    loadStage: undefined,
  });
  addMapLayer({
    id: tableName,
    name: displayName,
    source,
    tileSource: source.tileSource,
    featureCount: renderedFeatureCount,
    sourceNodeId: nodeId,
    sourceKind: "input",
  });
  focusLayer(tableName);
  useStore
    .getState()
    .updateLoadingOperation(operationId, {
      detail: "Drawing features on the map…",
      progress: 92,
      waitForLayerId: tableName,
    });
  const skipped = Math.max(0, totalRows - renderedFeatureCount);
  const h3Note = derivedH3
    ? ` Detected H3 cell column "${derivedH3.cellColumn}" — derived hexagon boundaries for display; the file itself is unchanged.`
    : "";
  addToast({
    type: skipped ? "warning" : "success",
    message: `${
      skipped
        ? `Loaded ${renderedFeatureCount.toLocaleString()} map features from ${displayName}; preserved ${skipped.toLocaleString()} rows without valid geometry in the table.`
        : `Loaded ${renderedFeatureCount.toLocaleString()} features from ${displayName}.`
    }${h3Note}`,
  });
  return { tableName, layerId: tableName };
};

/** Shared, typed ingestion path used by file pickers, URL/clipboard imports, and drag-and-drop. */
export const ingestFile = async (
  file: File,
  options: {
    nodeId?: string;
    position?: { x: number; y: number };
    sourceKind?: IngestionSourceKind;
    /**
     * The bytes were built in this tab, not read from outside.
     *
     * The JSON size guard exists because parsing a large untrusted document is
     * how the tab locks up, and a file somebody dropped is exactly that. A
     * calculation's result is not: it was constructed in memory, one row per row
     * DuckDB already held, and refusing it means a calculation silently produces
     * nothing on any dataset big enough to be interesting. So the limit still
     * applies to everything that came from outside, and only to that.
     */
    generated?: boolean;
  } = {},
): Promise<{ tableName: string; layerId: string | null } | null> => {
  const { addNode, addToast, startLoadingOperation } = useStore.getState();
  const detectedFormat = detectIngestionFormat(file.name, file.type);

  if (!detectedFormat) {
    addToast({
      type: "error",
      message: `Unsupported file type: ${file.name}. Use Parquet, CSV, JSON, GeoJSON, or a spatial file (Shapefile .zip, GeoPackage, KML, GPX, FlatGeobuf).`,
    });
    return null;
  }
  if (
    !options.generated &&
    (detectedFormat === "json" || detectedFormat === "geojson") &&
    file.size > MAX_JSON_BYTES
  ) {
    addToast({
      type: "error",
      message: `${file.name} is too large for guarded JSON parsing (${Math.round(file.size / 1024 / 1024)} MB; limit ${MAX_JSON_BYTES / 1024 / 1024} MB). Convert it to Parquet for larger datasets.`,
    });
    return null;
  }

  const operationId = `ingest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  startLoadingOperation({
    id: operationId,
    title: "Loading data",
    detail: "Inspecting the source…",
    progress: 8,
    fileName: file.name,
  });

  let nodeId = options.nodeId;
  const sourceKind = options.sourceKind || "file";
  let fingerprint = fingerprintFor(file, detectedFormat, sourceKind);
  if (!nodeId) {
    nodeId = `input-${Date.now()}`;
    addNode({
      id: nodeId,
      type: "input",
      position: options.position ?? nextNodePosition(useStore.getState().nodes),
      data: {
        label: "Data Source",
        type: "input",
        config: {
          fileName: file.name,
          sourceFingerprint: fingerprint,
          loadStatus: "loading",
          loadStage: "Inspecting source…",
        },
      },
    });
  }

  const updateStage = (detail: string, progress: number) => {
    const state = useStore.getState();
    state.updateLoadingOperation(operationId, { detail, progress });
    const currentConfig =
      state.nodes.find((node) => node.id === nodeId)?.data.config || {};
    state.updateNode(nodeId!, {
      ...currentConfig,
      fileName: file.name,
      sourceFingerprint: fingerprint,
      loadStatus: "loading",
      loadStage: detail,
    });
  };

  try {
    const tableName = tableNameForFile(file.name);
    const quotedTableName = qi(tableName);
    let invalidGeometryCount = 0;

    if (detectedFormat === "json" || detectedFormat === "geojson") {
      updateStage("Parsing JSON safely in the browser…", 18);
      const parsed = parseJsonDataset(await file.text());
      fingerprint = fingerprintFor(file, parsed.format, sourceKind);
      invalidGeometryCount = parsed.invalidGeometryCount;
      updateStage(
        parsed.format === "geojson"
          ? "Converting GeoJSON geometry…"
          : "Registering JSON rows…",
        32,
      );
      await registerJsonDataset(tableName, parsed);
    } else if (detectedFormat === "spatial") {
      updateStage("Reading the spatial file…", 18);
      const scanSql = await registerSpatialFile(file);
      updateStage("Opening the dataset…", 32);
      await duckdbService.query(
        `CREATE OR REPLACE VIEW ${quotedTableName} AS SELECT * FROM ${scanSql};`,
      );
    } else {
      updateStage("Registering the file with DuckDB…", 12);
      const normalizedFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const filePath = `${Date.now()}_${normalizedFileName}`;
      const registered = await duckdbService.registerUploadedFile(
        filePath,
        file,
        detectedFormat,
      );
      updateStage("Opening the dataset…", 28);
      const scanSql =
        registered.scanSql ||
        (detectedFormat === "csv"
          ? `read_csv_auto('${escapeSqlString(registered.path)}')`
          : `read_parquet('${escapeSqlString(registered.path)}')`);
      await duckdbService.query(
        `CREATE OR REPLACE VIEW ${quotedTableName} AS SELECT * FROM ${scanSql};`,
      );
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
    const currentConfig =
      state.nodes.find((node) => node.id === nodeId)?.data.config || {};
    state.updateNode(nodeId!, {
      ...currentConfig,
      fileName: file.name,
      sourceFingerprint: fingerprint,
      loadStatus: "error",
      loadStage: undefined,
      loadError: message,
    });
    state.finishLoadingOperation(operationId);
    addToast({
      type: "error",
      message: `Error loading ${file.name}: ${message}`,
    });
    return null;
  }
};

const fileNameFromUrl = (url: URL, contentType: string) => {
  const name = decodeURIComponent(
    url.pathname.split("/").filter(Boolean).at(-1) || "remote-data",
  );
  if (detectIngestionFormat(name, contentType)) return name;
  if (contentType.includes("geo+json")) return `${name}.geojson`;
  if (contentType.includes("json")) return `${name}.json`;
  if (contentType.includes("csv")) return `${name}.csv`;
  if (contentType.includes("parquet")) return `${name}.parquet`;
  return name;
};

export const ingestUrl = async (input: string) => {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Enter a valid HTTPS URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("Only HTTP and HTTPS data URLs are supported.");
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), URL_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      credentials: "omit",
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error(
        `The server returned ${response.status} ${response.statusText}.`,
      );
    const statedSize = Number(response.headers.get("content-length") || 0);
    if (statedSize > MAX_URL_BYTES)
      throw new Error(
        `The remote file is larger than the ${MAX_URL_BYTES / 1024 / 1024} MB URL limit.`,
      );
    const blob = await response.blob();
    if (blob.size > MAX_URL_BYTES)
      throw new Error(
        `The downloaded file is larger than the ${MAX_URL_BYTES / 1024 / 1024} MB URL limit.`,
      );
    const name = fileNameFromUrl(
      url,
      response.headers.get("content-type") || blob.type,
    );
    if (!detectIngestionFormat(name, blob.type))
      throw new Error(
        "The URL does not identify a supported Parquet, CSV, JSON, or GeoJSON resource.",
      );
    return ingestFile(
      new File([blob], name, { type: blob.type, lastModified: Date.now() }),
      { sourceKind: "url" },
    );
  } catch (error: any) {
    if (error?.name === "AbortError")
      throw new Error("The data URL timed out after 20 seconds.");
    throw new Error(
      `Could not load the data URL. ${error?.message || "Check CORS access and try again."}`,
    );
  } finally {
    window.clearTimeout(timeout);
  }
};

export const ingestClipboardText = async (
  text: string,
  name = "clipboard.json",
) => {
  if (!text.trim()) throw new Error("Paste JSON or GeoJSON first.");
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > MAX_JSON_BYTES)
    throw new Error(
      `Pasted text exceeds the ${MAX_JSON_BYTES / 1024 / 1024} MB limit.`,
    );
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    // Parse before starting ingestion so syntax errors leave no half-created node.
    const parsed = parseJsonDataset(text);
    const extension = parsed.format === "geojson" ? "geojson" : "json";
    const fileName =
      name.replace(/\.(csv|tsv|json|geojson)$/i, "") + `.${extension}`;
    return ingestFile(
      new File([text], fileName, {
        type:
          parsed.format === "geojson"
            ? "application/geo+json"
            : "application/json",
        lastModified: Date.now(),
      }),
      { sourceKind: "clipboard" },
    );
  }
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const delimiter = lines[0]?.includes("\t") ? "\t" : ",";
  if (lines.length < 2 || !lines[0].includes(delimiter))
    throw new Error("Paste JSON, GeoJSON, CSV, or TSV with a header row.");
  const fileName = name.replace(/\.(csv|tsv|json|geojson)$/i, "") + ".csv";
  return ingestFile(
    new File([text], fileName, { type: "text/csv", lastModified: Date.now() }),
    { sourceKind: "clipboard" },
  );
};

export const ingestSource = (source: IngestionSource) => {
  if (source.kind === "file")
    return ingestFile(source.file, { sourceKind: "file" });
  if (source.kind === "url") return ingestUrl(source.url);
  return ingestClipboardText(source.text, source.name);
};
