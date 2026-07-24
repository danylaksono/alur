import { duckdbService } from './duckdb';
import { useStore } from '../store/useStore';
import { nextNodePosition } from '../utils/nodePlacement';

const escapeSqlString = (value: string) => value.replace(/'/g, "''");

const tableNameForFile = (fileName: string) => {
  const baseName = fileName.replace(/\.[^/.]+$/, '');
  let tableName = baseName.replace(/[^a-zA-Z0-9]/g, '_');
  if (/^[0-9]/.test(tableName)) tableName = `t_${tableName}`;
  return tableName;
};

export const isIngestableFile = (fileName: string) => /\.(parquet|csv)$/i.test(fileName);

/**
 * Loads a Parquet/CSV file into DuckDB, attaches it to an input node (creating
 * one when none is given), and materializes a map layer when the data has
 * geometry. Single ingestion path shared by the input node, the header
 * "Add data" button, and map drag-drop.
 */
export const ingestFile = async (
  file: File,
  options: { nodeId?: string; position?: { x: number; y: number } } = {},
): Promise<{ tableName: string; layerId: string | null } | null> => {
  const { addNode, addToast, startLoadingOperation } = useStore.getState();

  if (!isIngestableFile(file.name)) {
    addToast({ type: 'error', message: `Unsupported file type: ${file.name}. Use Parquet or CSV.` });
    return null;
  }

  const operationId = `ingest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  startLoadingOperation({
    id: operationId,
    title: 'Loading data',
    detail: 'Registering the file with DuckDB…',
    progress: 8,
    fileName: file.name,
  });

  let nodeId = options.nodeId;
  if (!nodeId) {
    nodeId = `input-${Date.now()}`;
    addNode({
      id: nodeId,
      type: 'input',
      position: options.position ?? nextNodePosition(useStore.getState().nodes),
      data: {
        label: 'Data Source',
        type: 'input',
        config: { fileName: file.name, loadStatus: 'loading', loadStage: 'Registering file…' },
      },
    });
  }

  const updateStage = (detail: string, progress: number) => {
    const state = useStore.getState();
    state.updateLoadingOperation(operationId, { detail, progress });
    const currentConfig = state.nodes.find((node) => node.id === nodeId)?.data.config || {};
    state.updateNode(nodeId, {
      ...currentConfig,
      fileName: file.name,
      loadStatus: 'loading',
      loadStage: detail,
    });
  };

  try {
    updateStage('Registering the file with DuckDB…', 10);
    const normalizedFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = `${Date.now()}_${normalizedFileName}`;
    const fileKind = file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'parquet';
    const registered = await duckdbService.registerUploadedFile(filePath, file, fileKind);

    updateStage('Opening the dataset…', 28);
    const tableName = tableNameForFile(file.name);
    const quotedTableName = `"${tableName.replace(/"/g, '""')}"`;
    const scanSql = registered.scanSql || (fileKind === 'csv'
      ? `read_csv_auto('${escapeSqlString(registered.path)}')`
      : `read_parquet('${escapeSqlString(registered.path)}')`);
    await duckdbService.query(`CREATE OR REPLACE VIEW ${quotedTableName} AS SELECT * FROM ${scanSql};`);

    updateStage('Inspecting geometry and coordinate system…', 42);
    const source = await duckdbService.prepareLayerSource(tableName, { kind: 'duckdb-table' });

    if (!source) {
      const featureCount = await duckdbService.getTableFeatureCount(tableName);
      const currentConfig = useStore.getState().nodes.find((node) => node.id === nodeId)?.data.config || {};
      useStore.getState().updateNode(nodeId, {
        ...currentConfig,
        tableName,
        fileName: file.name,
        featureCount,
        loadStatus: 'ready',
        loadStage: undefined,
      });
      useStore.getState().finishLoadingOperation(operationId);
      addToast({
        type: 'warning',
        message: `Table ${tableName} registered, but no geometry or lat/lon columns were found to render a map layer.`,
      });
      return { tableName, layerId: null };
    }

    updateStage('Preparing map features…', 78);
    // The MVT table is already materialized and is much cheaper to count than
    // scanning the uploaded Parquet/CSV relation a second time.
    const featureCount = await duckdbService.getTableFeatureCount(source.tileSource.tableName);
    const { updateNode: updateNodeAgain, addMapLayer, focusLayer } = useStore.getState();
    const baseConfig = useStore.getState().nodes.find((node) => node.id === nodeId)?.data.config || {};
    updateNodeAgain(nodeId, {
      ...baseConfig,
      tableName,
      fileName: file.name,
      featureCount,
      crs: source.crs,
      crsName: source.crsName,
      crsConfidence: source.crsConfidence,
      crsReason: source.crsReason,
      loadStatus: 'ready',
      loadStage: undefined,
    });
    addMapLayer({
      id: tableName,
      name: file.name,
      source,
      tileSource: source.tileSource,
      featureCount,
      sourceNodeId: nodeId,
      sourceKind: 'input',
    });
    focusLayer(tableName);
    useStore.getState().updateLoadingOperation(operationId, {
      detail: 'Drawing features on the map…',
      progress: 92,
      waitForLayerId: tableName,
    });
    addToast({
      type: 'success',
      message: `Loaded ${featureCount.toLocaleString()} features from ${file.name}.`,
    });
    return { tableName, layerId: tableName };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const state = useStore.getState();
    const currentConfig = state.nodes.find((node) => node.id === nodeId)?.data.config || {};
    state.updateNode(nodeId, {
      ...currentConfig,
      fileName: file.name,
      loadStatus: 'error',
      loadStage: undefined,
      loadError: message,
    });
    state.finishLoadingOperation(operationId);
    addToast({ type: 'error', message: `Error loading file: ${message}` });
    return null;
  }
};
