import { type ChangeEvent, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Database, Upload, FileJson, Loader2, Sparkles } from 'lucide-react';
import { duckdbService } from '../../services/duckdb';
import { useStore } from '../../store/useStore';
import { FlowNodeShell, nodeHandleClass } from './FlowNodeShell';

export const InputNode = ({ data, id }: any) => {
  const updateNode = useStore((s) => s.updateNode);
  const addChatMessage = useStore((s) => s.addChatMessage);
  const addMapLayer = useStore((s) => s.addMapLayer);
  const focusLayer = useStore((s) => s.focusLayer);
  const [loading, setLoading] = useState(false);

  const loadAndRegister = async (
    buffer: Uint8Array,
    fileName: string,
    filePath: string,
    alreadyRegistered = false,
  ) => {
    const baseName = fileName.replace(/\.[^/.]+$/, '');
    let tableName = baseName.replace(/[^a-zA-Z0-9]/g, '_');
    if (/^[0-9]/.test(tableName)) tableName = `t_${tableName}`;
    const quotedTableName = `"${tableName.replace(/"/g, '""')}"`;
    const escapeSqlString = (v: string) => v.replace(/'/g, "''");
    const fileNameLower = fileName.toLowerCase();

    if (!alreadyRegistered) {
      await duckdbService.registerFileBuffer(filePath, buffer);
    }

    let query = '';
    if (fileNameLower.endsWith('.parquet')) {
      query = `CREATE OR REPLACE VIEW ${quotedTableName} AS SELECT * FROM read_parquet('${escapeSqlString(filePath)}');`;
    } else if (fileNameLower.endsWith('.csv')) {
      query = `CREATE OR REPLACE VIEW ${quotedTableName} AS SELECT * FROM read_csv_auto('${escapeSqlString(filePath)}');`;
    }

    if (!query) {
      addChatMessage('system', `Unsupported file type: ${fileName}`);
      return;
    }

    await duckdbService.query(query);
    updateNode(id, { ...data.config, tableName, fileName });
    addChatMessage('system', `Registered table: ${tableName} from ${fileName}`);

    await duckdbService.optimizeTable(tableName);

    addChatMessage('system', `Preparing table-backed map layer...`);
    const [source, featureCount] = await Promise.all([
      duckdbService.prepareLayerSource(tableName, { kind: 'duckdb-table' }),
      duckdbService.getTableFeatureCount(tableName),
    ]);

    if (source) {
      addMapLayer({
        id: tableName,
        name: fileName,
        source,
        tileSource: source.tileSource,
        featureCount,
        sourceNodeId: id,
        sourceKind: 'input',
      });
      focusLayer(tableName);
      addChatMessage(
        'system',
        `✅ Loaded ${featureCount.toLocaleString()} features from ${fileName} onto the map with vector tiles.`,
      );
    } else {
      addChatMessage(
        'system',
        `Table ${tableName} registered, but no geometry or lat/lon columns were found to render a map layer.`,
      );
    }
  };

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      const normalizedFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const filePath = `${Date.now()}_${normalizedFileName}`;
      const fileKind = file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'parquet';
      const registeredPath = await duckdbService.registerUploadedFile(filePath, file, fileKind);
      await loadAndRegister(new Uint8Array(), file.name, registeredPath, true);
    } catch (err: any) {
      addChatMessage('system', `Error loading file: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadSample = async () => {
    setLoading(true);
    addChatMessage('system', 'Loading sample dataset: need_london.parquet ...');
    try {
      const fileName = 'need_london.parquet';
      const url = new URL('/need_london.parquet', window.location.origin).href;
      await duckdbService.registerFileUrl(fileName, url);
      await loadAndRegister(new Uint8Array(), fileName, fileName, true);
    } catch (err: any) {
      addChatMessage('system', `Error loading sample data: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <FlowNodeShell
      id={id}
      tone="blue"
      icon={Database}
      label="Data Source"
      title={data.config.tableName || 'Load data'}
    >
      {loading ? (
        <div className="flex flex-col items-center justify-center py-4 gap-2">
          <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
          <span className="text-[10px] text-muted-foreground">Loading data...</span>
        </div>
      ) : data.config.tableName ? (
        <div>
          <div className="text-sm font-bold text-slate-700 truncate max-w-[180px]">
            {data.config.tableName}
          </div>
          <div className="text-[10px] text-muted-foreground flex items-center gap-1 mt-1">
            <FileJson className="w-2.5 h-2.5" /> {data.config.fileName}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Upload from disk */}
          <label className="cursor-pointer group flex flex-col items-center justify-center py-3 border-2 border-dashed border-muted rounded-lg hover:bg-blue-50 hover:border-blue-200 transition-all">
            <Upload className="w-4 h-4 text-muted-foreground group-hover:text-blue-500 mb-1" />
            <span className="text-[10px] font-medium text-muted-foreground group-hover:text-blue-600">
              Upload Parquet / CSV
            </span>
            <input
              type="file"
              className="hidden"
              onChange={handleFileUpload}
              accept=".parquet,.csv,.json"
            />
          </label>
          {/* Load bundled sample */}
          {/* <button
            type="button"
            onClick={handleLoadSample}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-blue-200 bg-blue-50 text-[10px] font-semibold text-blue-600 hover:bg-blue-100 transition-colors"
          >
            <Sparkles className="w-3 h-3" />
            Load Sample (London NEED)
          </button> */}
        </div>
      )}
      <Handle type="source" position={Position.Right} className={nodeHandleClass('blue')} />
    </FlowNodeShell>
  );
};
