import { Handle, Position } from '@xyflow/react';
import { Download, Eye, FileArchive, Settings2 } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { buildUpToSQL } from '../../utils/workflowEngine';
import { duckdbService } from '../../services/duckdb';
import { FlowNodeShell, inputClass, nodeHandleClass, selectClass } from './FlowNodeShell';
import { materializeWorkflowOutput } from '../../services/layerMaterialization';
import { registerWorkflowResult } from '../../services/workflowRun';

type OutputMode = 'visualize' | 'export';
type ExportFormat = 'geojson' | 'csv' | 'json' | 'parquet';

export const OutputNode = ({ data, id, selected }: any) => {
  const setSelectedNodeId = useStore((s) => s.setSelectedNodeId);
  const addChatMessage = useStore((s) => s.addChatMessage);
  const updateNode = useStore((s) => s.updateNode);

  const maxFeatures = data.config?.maxFeatures ?? 5000;
  const outputMode: OutputMode = data.config?.outputMode ?? 'visualize';
  const exportFormat: ExportFormat = data.config?.exportFormat ?? 'geojson';
  const isExportMode = outputMode === 'export';

  const updateConfig = (payload: Record<string, unknown>) => updateNode(id, { ...data.config, ...payload });

  const handlePreview = async () => {
    setSelectedNodeId(id);
    const { nodes, edges } = useStore.getState();
    try {
      const workflow = buildUpToSQL(nodes, edges, id, { limit: maxFeatures });
      const result = await materializeWorkflowOutput({
        workflow,
        layerId: `output-${id}`,
        name: `Output: ${data.label}`,
        sourceNodeId: id,
        sourceKind: 'output',
        visualisationConfig: workflow.visualisationConfig,
      });
      if (!result.featureCount) {
        addChatMessage('system', '⚠️ Output node produced no rows.');
        return;
      }
      registerWorkflowResult(result, { nodeId: id });
      const count = `${result.featureCount.toLocaleString()}${result.featureCount >= maxFeatures ? '+' : ''}`;
      addChatMessage('system', result.kind === 'layer'
        ? `✅ Output rendered: ${count} features`
        : `✅ Output registered: ${count} rows (no geometry, so it is not on the map)`);
    } catch (err: any) {
      addChatMessage('system', `❌ Output error: ${err.message}`);
    }
  };

  const downloadBlob = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExport = async () => {
    const { nodes, edges } = useStore.getState();
    try {
      const workflow = buildUpToSQL(nodes, edges, id, { limit: maxFeatures });

      if (exportFormat === 'geojson') {
        const tableName = `alur_export_${id.replace(/[^a-zA-Z0-9_]/g, '_')}_${Date.now()}`;
        await duckdbService.materializeQueryAsTable(workflow.resultSql, tableName);
        const geojson = await duckdbService.getGeoJSONFromTable(tableName, 100000);
        if (!geojson || geojson.features.length === 0) {
          addChatMessage('system', '⚠️ Export node produced no features.');
          return;
        }
        downloadBlob(
          new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' }),
          `output-${id}.geojson`
        );
        addChatMessage('system', `📦 Exported ${geojson.features.length.toLocaleString()} features as GeoJSON.`);
        return;
      }

      const { buffer, fileName } = await duckdbService.exportTable(workflow.resultSql, exportFormat);
      const mimeType = exportFormat === 'csv'
        ? 'text/csv'
        : exportFormat === 'json'
        ? 'application/json'
        : 'application/octet-stream';
      downloadBlob(new Blob([buffer as BlobPart], { type: mimeType }), fileName);
      addChatMessage('system', `📦 Exported output as ${exportFormat.toUpperCase()}.`);
    } catch (err: any) {
      addChatMessage('system', `❌ Export failed: ${err.message}`);
    }
  };

  return (
    <FlowNodeShell
      id={id}
      selected={selected}
      tone="emerald"
      icon={isExportMode ? FileArchive : Eye}
      label={isExportMode ? 'Export Output' : 'Map Output'}
      title={isExportMode ? exportFormat.toUpperCase() : 'Visualize results'}
    >
      <div>
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Output Type
        </label>
        <select
          className={selectClass}
          value={outputMode}
          onChange={(e) => updateConfig({ outputMode: e.target.value })}
        >
          <option value="visualize">Visualize to map</option>
          <option value="export">Export file</option>
        </select>
      </div>

      {/* <div className="text-xs font-bold text-slate-700 flex items-center gap-2">
        {isExportMode ? (
          <><FileArchive className="w-3 h-3 text-emerald-600" /> Export Result</>
        ) : (
          <><MapIcon className="w-3 h-3 text-emerald-600" /> Visualize Result</>
        )}
      </div> */}

      {isExportMode ? (
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Format
          </label>
          <select
            className={selectClass}
            value={exportFormat}
            onChange={(e) => updateConfig({ exportFormat: e.target.value })}
          >
            <option value="geojson">GeoJSON</option>
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
            <option value="parquet">Parquet</option>
          </select>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-2">
        <Settings2 className="w-2.5 h-2.5 text-slate-400" />
        <label className="text-[11px] text-slate-500 font-medium">Max features:</label>
        <input
          type="number"
          min={1}
          max={100000}
          value={maxFeatures}
          onChange={(e) => updateConfig({ maxFeatures: Number(e.target.value) })}
          className={`${inputClass} w-24 px-2 py-1 text-[11px] font-mono`}
        />
      </div>
      )}

      <div className="flex gap-2 mt-2 pt-2 border-t">
        {isExportMode ? (
          <button
            onClick={handleExport}
            className="flex flex-1 items-center justify-center gap-1.5 bg-emerald-50 text-emerald-700 py-1.5 rounded-lg text-[11px] font-bold hover:bg-emerald-100 transition-colors"
          >
            <Download className="w-3 h-3" /> EXPORT
          </button>
        ) : (
          <button
            onClick={handlePreview}
            className="flex-1 bg-emerald-50 text-emerald-700 py-1.5 rounded-lg text-[11px] font-bold hover:bg-emerald-100 transition-colors"
          >
            PREVIEW
          </button>
        )}
      </div>
      <Handle type="target" position={Position.Left} className={nodeHandleClass('emerald')} />
    </FlowNodeShell>
  );
};
