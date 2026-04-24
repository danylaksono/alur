import { type ChangeEvent, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Database, Upload, FileJson, Loader2, Sparkles } from 'lucide-react';
import { duckdbService } from '../../services/duckdb';
import { useStore } from '../../store/useStore';
import { NodeActions } from './NodeActions';

export const InputNode = ({ data, id }: any) => {
  const { updateNode, addChatMessage, addMapLayer } = useStore();
  const [loading, setLoading] = useState(false);

  const loadAndRegister = async (
    buffer: Uint8Array,
    fileName: string,
    filePath: string,
  ) => {
    const baseName = fileName.replace(/\.[^/.]+$/, '');
    let tableName = baseName.replace(/[^a-zA-Z0-9]/g, '_');
    if (/^[0-9]/.test(tableName)) tableName = `t_${tableName}`;
    const quotedTableName = `"${tableName.replace(/"/g, '""')}"`;
    const escapeSqlString = (v: string) => v.replace(/'/g, "''");
    const fileNameLower = fileName.toLowerCase();

    await duckdbService.registerFileBuffer(filePath, buffer);

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

    addChatMessage('system', `Extracting geometry and building GeoJSON layer...`);
    const layerGeoJSON = await duckdbService.getGeoJSONFromTable(tableName);

    if (layerGeoJSON) {
      addMapLayer({ id: tableName, name: fileName, geojson: layerGeoJSON });
      addChatMessage(
        'system',
        `✅ Loaded ${layerGeoJSON.features.length.toLocaleString()} features from ${fileName} onto the map.`,
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
      const buffer = new Uint8Array(await file.arrayBuffer());
      const normalizedFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const filePath = `${Date.now()}_${normalizedFileName}`;
      await loadAndRegister(buffer, file.name, filePath);
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
      const response = await fetch('/need_london.parquet');
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      const buffer = new Uint8Array(await response.arrayBuffer());
      const fileName = 'need_london.parquet';
      const filePath = `sample_${Date.now()}_need_london.parquet`;
      await loadAndRegister(buffer, fileName, filePath);
    } catch (err: any) {
      addChatMessage('system', `Error loading sample data: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative box-border px-4 py-3 w-[260px] bg-white border-l-4 border-l-blue-500 rounded-xl shadow-lg">
      <NodeActions id={id} />
      <div className="text-[10px] font-bold text-muted-foreground uppercase mb-2 flex items-center gap-1">
        <Database className="w-3 h-3 text-blue-500" /> Data Source
      </div>

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
        </div>
      )}

      <Handle type="source" position={Position.Right} className="!bg-blue-400" />
    </div>
  );
};
