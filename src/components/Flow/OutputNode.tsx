import { Handle, Position } from '@xyflow/react';
import { Eye, Map as MapIcon, ClipboardCopy, Settings2 } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { NodeActions } from './NodeActions';
import { NodeSchema } from './NodeSchema';
import { buildUpToSQL } from '../../utils/workflowEngine';
import { duckdbService } from '../../services/duckdb';

export const OutputNode = ({ data, id }: any) => {
  const setSelectedNodeId = useStore((s) => s.setSelectedNodeId);
  const addMapLayer = useStore((s) => s.addMapLayer);
  const addChatMessage = useStore((s) => s.addChatMessage);
  const updateNode = useStore((s) => s.updateNode);

  const maxFeatures = data.config?.maxFeatures ?? 5000;

  const handlePreview = async () => {
    setSelectedNodeId(id);
    const { nodes, edges } = useStore.getState();
    try {
      const { sql } = buildUpToSQL(nodes, edges, id, { limit: maxFeatures });
      const geojson = await duckdbService.getGeoJSON(sql);
      if (!geojson || geojson.features.length === 0) {
        addChatMessage('system', '⚠️ Output node produced no features.');
        return;
      }
      addMapLayer({
        id: `output-${id}`,
        name: `Output: ${data.label}`,
        geojson,
        sourceNodeId: id,
      });
      const msg = geojson.features.length >= maxFeatures
        ? `✅ Output rendered: ${geojson.features.length.toLocaleString()}+ features (limited to ${maxFeatures})`
        : `✅ Output rendered: ${geojson.features.length.toLocaleString()} features`;
      addChatMessage('system', msg);
    } catch (err: any) {
      addChatMessage('system', `❌ Output error: ${err.message}`);
    }
  };

  const handleShare = async () => {
    const { nodes, edges } = useStore.getState();
    try {
      const { sql } = buildUpToSQL(nodes, edges, id, { limit: maxFeatures });
      const geojson = await duckdbService.getGeoJSON(sql);
      if (!geojson || geojson.features.length === 0) {
        addChatMessage('system', '⚠️ Nothing to share.');
        return;
      }
      const text = JSON.stringify(geojson, null, 2);
      await navigator.clipboard.writeText(text);
      addChatMessage('system', `📋 Copied ${geojson.features.length} features as GeoJSON to clipboard.`);
    } catch (err: any) {
      addChatMessage('system', `❌ Share failed: ${err.message}`);
    }
  };

  return (
    <div className="relative box-border px-4 py-3 w-[260px] bg-white border-l-4 border-l-emerald-500 rounded-xl shadow-lg">
      <NodeActions id={id} />
      <div className="text-[10px] font-bold text-muted-foreground uppercase mb-1 flex items-center gap-1">
        <Eye className="w-3 h-3 text-emerald-500" /> Map Output
      </div>

      <div className="text-xs font-bold text-slate-700 mt-2 flex items-center gap-2">
        <MapIcon className="w-3 h-3 text-emerald-600" /> Visualize Results
      </div>

      <div className="mt-2 flex items-center gap-2">
        <Settings2 className="w-2.5 h-2.5 text-slate-400" />
        <label className="text-[9px] text-slate-500 font-medium">Max features:</label>
        <input
          type="number"
          min={1}
          max={100000}
          value={maxFeatures}
          onChange={(e) => updateNode(id, { ...data.config, maxFeatures: Number(e.target.value) })}
          className="w-20 text-[10px] border border-slate-200 rounded px-1.5 py-0.5 font-mono text-slate-700"
        />
      </div>

      <div className="flex gap-2 mt-2 pt-2 border-t">
        <button
          onClick={handlePreview}
          className="flex-1 bg-emerald-50 text-emerald-700 py-1.5 rounded-lg text-[10px] font-bold hover:bg-emerald-100 transition-colors"
        >
          PREVIEW
        </button>
        <button
          onClick={handleShare}
          className="flex items-center gap-1 px-2 bg-slate-50 text-slate-600 rounded-lg hover:bg-slate-100 text-[9px] font-semibold transition-colors"
        >
          <ClipboardCopy className="w-3 h-3" /> Copy
        </button>
      </div>

      <NodeSchema nodeId={id} />

      <Handle type="target" position={Position.Left} className="!bg-emerald-400" />
    </div>
  );
};
