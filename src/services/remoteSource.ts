import { duckdbService } from './duckdb';
import { useStore } from '../store/useStore';
import { nextNodePosition } from '../utils/nodePlacement';
import { finaliseIngestedTable, tableNameForFile } from './dataIngestion';
import type { SourceFingerprint } from '../types/ingestion';
import {
  bboxIsPushedDown,
  catalogEntryForUrl,
  detectRemoteFormat,
  guardFailure,
  isGlobUrl,
  normaliseRemoteUrl,
  remoteNameFromUrl,
  remoteTableSql,
  type RemoteBbox,
  type RemoteField,
} from '../utils/remoteSource';

const PROBE_TIMEOUT_MS = 15_000;

export type RemoteProbe = {
  url: string;
  name: string;
  byteSize: number | null;
  acceptsRanges: boolean;
};

export type RemoteInspection = RemoteProbe & {
  /** The path to use in SQL. The URL itself — see `inspectRemoteSource`. */
  scanPath: string;
  fields: RemoteField[];
  rowCount: number | null;
  bboxPushdown: boolean;
};

const normaliseRows = (rows: any[]) => rows.map((row) => (typeof row?.toJSON === 'function' ? row.toJSON() : row));

/**
 * A HEAD request before anything else, because the two ways this fails are
 * both invisible from inside DuckDB: a host that blocks cross-origin reads,
 * and a host that ignores Range and answers with the whole file. Finding out
 * up front turns "the tab froze" into a sentence the user can act on.
 */
export const probeRemoteSource = async (input: string): Promise<RemoteProbe> => {
  if (isGlobUrl(input)) {
    throw new Error('Wildcards need a directory listing, which plain HTTPS does not offer. Point at one Parquet file.');
  }
  const url = normaliseRemoteUrl(input);
  if (!detectRemoteFormat(url)) {
    throw new Error('Remote reading works on Parquet and GeoParquet files. Other formats have to be downloaded.');
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: 'HEAD', credentials: 'omit', signal: controller.signal });
    if (!response.ok) throw new Error(`The server returned ${response.status} ${response.statusText}.`);
    const statedSize = Number(response.headers.get('content-length'));
    return {
      url: url.toString(),
      name: remoteNameFromUrl(url),
      byteSize: Number.isFinite(statedSize) && statedSize > 0 ? statedSize : null,
      acceptsRanges: (response.headers.get('accept-ranges') || '').toLowerCase().includes('bytes'),
    };
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('The server did not respond within 15 seconds.');
    if (error instanceof TypeError) {
      throw new Error('The browser could not reach that URL. The host has to allow cross-origin reads (CORS) for a browser to read it.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
};

/**
 * Reads the Parquet footer and nothing else.
 *
 * The URL goes into the scan directly rather than through `registerFileURL`:
 * with httpfs loaded the bare URL is the path that actually issues range
 * requests, and a registered handle routes back through duckdb-wasm's own
 * HTTP runtime, which downloads whole objects instead.
 */
export const inspectRemoteSource = async (probe: RemoteProbe): Promise<RemoteInspection> => {
  await duckdbService.init();
  const ranged = await duckdbService.ensureHttpfs();
  if (!ranged) {
    throw new Error('The httpfs extension could not be loaded, so the file could only be read by downloading all of it. Check the connection and try again.');
  }

  const escaped = probe.url.replace(/'/g, "''");
  try {
    const described = await duckdbService.query(`DESCRIBE SELECT * FROM read_parquet('${escaped}');`);
    const fields: RemoteField[] = normaliseRows(described.toArray()).map((row: any) => ({
      name: String(row.column_name),
      type: String(row.column_type || 'UNKNOWN'),
    }));
    if (!fields.length) throw new Error('The file reports no columns.');

    // The row count lives in the footer that was just read, so it is free.
    let rowCount: number | null = null;
    try {
      const counted = await duckdbService.query(`SELECT count(*) AS row_count FROM read_parquet('${escaped}');`);
      rowCount = Number(normaliseRows(counted.toArray())[0]?.row_count ?? 0);
    } catch {
      rowCount = null;
    }

    return { ...probe, scanPath: probe.url, fields, rowCount, bboxPushdown: bboxIsPushedDown(fields) };
  } catch (err: any) {
    throw new Error(`DuckDB could not read the remote file. ${err?.message || String(err)}`);
  }
};

const fingerprintFor = (inspection: RemoteInspection, name: string): SourceFingerprint => ({
  name,
  size: inspection.byteSize ?? 0,
  lastModified: 0,
  format: 'parquet',
  sourceKind: 'remote',
});

export type RemoteReadOptions = {
  url: string;
  nodeId?: string;
  position?: { x: number; y: number };
  bbox?: RemoteBbox | null;
  limit?: number | null;
  columns?: string[];
  /**
   * A completed inspection to reuse. The dialog has already read the footer by
   * the time the user presses Read, and re-reading it costs a second round
   * trip for nothing. Omitted by callers with no prior inspection, such as
   * reopening a saved project.
   */
  inspection?: RemoteInspection;
};

/**
 * Reads a bounded slice of a remote Parquet file into a local table.
 *
 * The bounds are not optional decoration: `guardFailure` refuses an unbounded
 * read of a large file outright rather than starting one and hoping. Once the
 * slice has landed it is an ordinary DuckDB table, so every node downstream is
 * unaware that it came from the network.
 */
export const readRemoteSource = async (options: RemoteReadOptions): Promise<{ tableName: string; layerId: string | null } | null> => {
  const { addNode, addToast, startLoadingOperation } = useStore.getState();

  const operationId = `remote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let nodeId = options.nodeId;
  let displayName = 'remote source';

  try {
    const probe: RemoteProbe = options.inspection ?? await probeRemoteSource(options.url);
    displayName = catalogEntryForUrl(probe.url)?.name ?? probe.name;

    const refusal = guardFailure({ byteSize: probe.byteSize, bbox: options.bbox, limit: options.limit });
    if (refusal) throw new Error(refusal);

    startLoadingOperation({ id: operationId, title: 'Reading remote data', detail: 'Reading the file index…', progress: 10, fileName: displayName });

    if (!nodeId) {
      nodeId = `input-${Date.now()}`;
      addNode({
        id: nodeId,
        type: 'input',
        position: options.position ?? nextNodePosition(useStore.getState().nodes),
        data: {
          label: 'Data Source',
          type: 'input',
          config: { sourceMode: 'remote', remoteUrl: probe.url, fileName: displayName, loadStatus: 'loading', loadStage: 'Reading the file index…' },
        },
      });
    }

    const updateStage = (detail: string, progress: number) => {
      const state = useStore.getState();
      state.updateLoadingOperation(operationId, { detail, progress });
      const currentConfig = state.nodes.find((node) => node.id === nodeId)?.data.config || {};
      state.updateNode(nodeId!, { ...currentConfig, loadStatus: 'loading', loadStage: detail });
    };

    const inspection = options.inspection ?? await inspectRemoteSource(probe);
    const fingerprint = fingerprintFor(inspection, displayName);

    if (!probe.acceptsRanges) {
      addToast({
        type: 'warning',
        message: `${displayName} does not advertise range support, so the whole file may be fetched. Watch the network tab if it stalls.`,
      });
    }
    if (options.bbox && !inspection.bboxPushdown) {
      addToast({
        type: 'warning',
        message: `${displayName} has no bbox column, so the area filter reduces the result but still reads every row.`,
      });
    }

    updateStage(options.bbox ? 'Fetching the row groups that touch the area…' : 'Fetching rows…', 40);
    const tableName = tableNameForFile(displayName);
    await duckdbService.query(
      remoteTableSql(tableName, {
        path: inspection.scanPath,
        fields: inspection.fields,
        bbox: options.bbox,
        limit: options.limit,
        columns: options.columns,
      }),
    );

    const state = useStore.getState();
    const currentConfig = state.nodes.find((node) => node.id === nodeId)?.data.config || {};
    state.updateNode(nodeId, {
      ...currentConfig,
      sourceMode: 'remote',
      remoteUrl: probe.url,
      remoteBbox: options.bbox ?? undefined,
      remoteLimit: options.limit ?? undefined,
      remoteColumns: options.columns?.length ? options.columns : undefined,
      remoteByteSize: probe.byteSize ?? undefined,
      remoteRowCount: inspection.rowCount ?? undefined,
      remoteBboxPushdown: inspection.bboxPushdown,
    });

    return await finaliseIngestedTable({
      nodeId,
      tableName,
      displayName,
      fingerprint,
      updateStage,
      operationId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const state = useStore.getState();
    if (nodeId) {
      const currentConfig = state.nodes.find((node) => node.id === nodeId)?.data.config || {};
      state.updateNode(nodeId, { ...currentConfig, sourceMode: 'remote', remoteUrl: options.url, loadStatus: 'error', loadStage: undefined, loadError: message });
    }
    state.finishLoadingOperation(operationId);
    addToast({ type: 'error', message: `Could not read ${displayName}: ${message}` });
    return null;
  }
};
