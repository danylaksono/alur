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
  const { addNode, addToast } = useStore.getState();

  if (!isIngestableFile(file.name)) {
    addToast({ type: 'error', message: `Unsupported file type: ${file.name}. Use Parquet or CSV.` });
    return null;
  }

  let nodeId = options.nodeId;
  if (!nodeId) {
    nodeId = `input-${Date.now()}`;
    addNode({
      id: nodeId,
      type: 'input',
      position: options.position ?? nextNodePosition(useStore.getState().nodes),
      data: { label: 'Data Source', type: 'input', config: {} },
    });
  }

  try {
    const normalizedFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = `${Date.now()}_${normalizedFileName}`;
    const fileKind = file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'parquet';
    const registered = await duckdbService.registerUploadedFile(filePath, file, fileKind);

    const tableName = tableNameForFile(file.name);
    const quotedTableName = `"${tableName.replace(/"/g, '""')}"`;
    const scanSql = registered.scanSql || (fileKind === 'csv'
      ? `read_csv_auto('${escapeSqlString(registered.path)}')`
      : `read_parquet('${escapeSqlString(registered.path)}')`);
    await duckdbService.query(`CREATE OR REPLACE VIEW ${quotedTableName} AS SELECT * FROM ${scanSql};`);

    const { updateNode, nodes } = useStore.getState();
    const baseConfig = nodes.find((node) => node.id === nodeId)?.data.config || {};
    updateNode(nodeId, { ...baseConfig, tableName, fileName: file.name });

    await duckdbService.optimizeTable(tableName);

    const [source, featureCount] = await Promise.all([
      duckdbService.prepareLayerSource(tableName, { kind: 'duckdb-table' }),
      duckdbService.getTableFeatureCount(tableName),
    ]);

    if (!source) {
      addToast({
        type: 'warning',
        message: `Table ${tableName} registered, but no geometry or lat/lon columns were found to render a map layer.`,
      });
      return { tableName, layerId: null };
    }

    const { updateNode: updateNodeAgain, addMapLayer, focusLayer } = useStore.getState();
    updateNodeAgain(nodeId, {
      ...baseConfig,
      tableName,
      fileName: file.name,
      featureCount,
      crs: source.crs,
      crsName: source.crsName,
      crsConfidence: source.crsConfidence,
      crsReason: source.crsReason,
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
    addToast({
      type: 'success',
      message: `Loaded ${featureCount.toLocaleString()} features from ${file.name}.`,
    });
    return { tableName, layerId: tableName };
  } catch (err: any) {
    addToast({ type: 'error', message: `Error loading file: ${err.message}` });
    return null;
  }
};
