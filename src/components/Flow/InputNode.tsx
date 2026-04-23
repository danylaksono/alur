import { type ChangeEvent } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Database, Upload, FileJson } from 'lucide-react';
import { duckdbService } from '../../services/duckdb';
import { useStore } from '../../store/useStore';
import { NodeActions } from './NodeActions';

export const InputNode = ({ data, id }: any) => {
  const { updateNode, addChatMessage, addMapLayer } = useStore();

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const buffer = new Uint8Array(await file.arrayBuffer());
    const baseName = file.name.replace(/\.[^/.]+$/, "");
    let tableName = baseName.replace(/[^a-zA-Z0-9]/g, "_");
    if (/^[0-9]/.test(tableName)) {
      tableName = `t_${tableName}`;
    }
    const quotedTableName = `"${tableName.replace(/"/g, '""')}"`;
    const normalizedFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = `${Date.now()}_${normalizedFileName}`;
    const escapeSqlString = (value: string) => value.replace(/'/g, "''");
    const fileNameLower = file.name.toLowerCase();

    try {
      await duckdbService.registerFileBuffer(filePath, buffer);

      let query = '';
      if (fileNameLower.endsWith('.parquet')) {
        query = `CREATE VIEW ${quotedTableName} AS SELECT * FROM read_parquet('${escapeSqlString(filePath)}');`;
      } else if (fileNameLower.endsWith('.csv')) {
        query = `CREATE VIEW ${quotedTableName} AS SELECT * FROM read_csv_auto('${escapeSqlString(filePath)}');`;
      }

      if (!query) {
        addChatMessage('system', `Unsupported file type: ${file.name}`);
        return;
      }

      await duckdbService.query(query);
      updateNode(id, { ...data.config, tableName, fileName: file.name });
      addChatMessage('system', `Registered table: ${tableName} from ${file.name}`);

      const layerGeoJSON = await duckdbService.getGeoJSONFromTable(tableName);
      if (layerGeoJSON) {
        addMapLayer({ id: tableName, name: file.name, geojson: layerGeoJSON });
        addChatMessage('system', `Loaded ${file.name} as an input layer on the map.`);
      } else {
        addChatMessage('system', `Table ${tableName} registered, but no geometry column was found to create a map layer.`);
      }
    } catch (err: any) {
      addChatMessage('system', `Error loading file: ${err.message}`);
    }
  };

  return (
    <div className="relative box-border px-4 py-3 w-[240px] bg-white border-l-4 border-l-blue-500 rounded-xl shadow-lg">
      <NodeActions id={id} />
      <div className="text-[10px] font-bold text-muted-foreground uppercase mb-1 flex items-center gap-1">
        <Database className="w-3 h-3 text-blue-500" /> Data Source
      </div>
      
      {data.config.tableName ? (
        <div>
          <div className="text-sm font-bold text-slate-700 truncate max-w-[160px]">
            {data.config.tableName}
          </div>
          <div className="text-[10px] text-muted-foreground flex items-center gap-1 mt-1">
            <FileJson className="w-2.5 h-2.5" /> {data.config.fileName}
          </div>
        </div>
      ) : (
        <label className="cursor-pointer group flex flex-col items-center justify-center py-4 border-2 border-dashed border-muted rounded-lg hover:bg-blue-50 hover:border-blue-200 transition-all">
          <Upload className="w-5 h-5 text-muted-foreground group-hover:text-blue-500 mb-1" />
          <span className="text-[10px] font-medium text-muted-foreground group-hover:text-blue-600">Upload Parquet/CSV</span>
          <input type="file" className="hidden" onChange={handleFileUpload} accept=".parquet,.csv,.json" />
        </label>
      )}

      <Handle type="source" position={Position.Right} className="!bg-blue-400" />
    </div>
  );
};
