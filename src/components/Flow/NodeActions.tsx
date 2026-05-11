import { useState, useRef, useEffect, type ReactNode } from 'react';
import { Copy, Trash2, Info, Play, Download, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { buildUpToSQL } from '../../utils/workflowEngine';
import { duckdbService } from '../../services/duckdb';

interface NodeActionsProps {
  id: string;
  helperContent?: ReactNode;
}

export const NodeActions = ({ id, helperContent }: NodeActionsProps) => {
  const removeNode = useStore((s) => s.removeNode);
  const duplicateNode = useStore((s) => s.duplicateNode);
  const nodeExecutionStates = useStore((s) => s.nodeExecutionStates);
  const setNodeExecutionState = useStore((s) => s.setNodeExecutionState);
  const addMapLayer = useStore((s) => s.addMapLayer);
  const addChatMessage = useStore((s) => s.addChatMessage);
  const [showHelper, setShowHelper] = useState(false);
  const [exporting, setExporting] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const execState = nodeExecutionStates[id];

  const handleExecute = async () => {
    const { nodes, edges } = useStore.getState();
    setNodeExecutionState(id, { status: 'running' });
    try {
      const { sql } = buildUpToSQL(nodes, edges, id);
      addChatMessage('system', `▶️ Executing up to node: ${nodes.find((n) => n.id === id)?.data.label || id}`);
      const geojson = await duckdbService.getGeoJSON(sql);
      if (!geojson || geojson.features.length === 0) {
        addChatMessage('system', '⚠️ Execution produced no features.');
        setNodeExecutionState(id, { status: 'done', featureCount: 0 });
        return;
      }
      addMapLayer({
        id: `exec-${id}`,
        name: `Step: ${nodes.find((n) => n.id === id)?.data.label || id}`,
        geojson,
        sourceNodeId: id,
        sourceKind: 'step',
      });
      setNodeExecutionState(id, { status: 'done', featureCount: geojson.features.length });
      addChatMessage('system', `✅ Step executed: ${geojson.features.length.toLocaleString()} features`);
    } catch (err: any) {
      setNodeExecutionState(id, { status: 'error', error: err.message });
      addChatMessage('system', `❌ Step error: ${err.message}`);
    }
  };

  const handleExport = async (format: 'geojson' | 'csv' = 'geojson') => {
    const { nodes, edges } = useStore.getState();
    setExporting(true);
    try {
      const { sql } = buildUpToSQL(nodes, edges, id);
      if (format === 'geojson') {
        const geojson = await duckdbService.getGeoJSON(sql);
        if (!geojson || geojson.features.length === 0) {
          addChatMessage('system', '⚠️ Nothing to export.');
          return;
        }
        const text = JSON.stringify(geojson, null, 2);
        const blob = new Blob([text], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `node-${id}.geojson`;
        a.click();
        URL.revokeObjectURL(url);
        addChatMessage('system', `📦 Exported ${geojson.features.length} features as GeoJSON`);
      } else {
        const { buffer, fileName } = await duckdbService.exportTable(sql, 'csv');
        const blob = new Blob([buffer as BlobPart], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
        addChatMessage('system', `📦 Exported as CSV`);
      }
    } catch (err: any) {
      addChatMessage('system', `❌ Export error: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  const resetExecution = () => {
    setNodeExecutionState(id, { status: 'idle' });
  };

  // Close popover when clicking outside
  useEffect(() => {
    if (!showHelper) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowHelper(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showHelper]);

  return (
    <div className="absolute top-3 right-3 flex items-center gap-1">
      {/* Execution status badge */}
      {execState && execState.status !== 'idle' && (
        <div
          className={`
            flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider cursor-pointer
            ${execState.status === 'running' ? 'bg-amber-100 text-amber-700' : ''}
            ${execState.status === 'done' ? 'bg-emerald-100 text-emerald-700' : ''}
            ${execState.status === 'error' ? 'bg-red-100 text-red-700' : ''}
          `}
          onClick={resetExecution}
          title="Click to reset"
        >
          {execState.status === 'running' && <><Loader2 className="w-2.5 h-2.5 animate-spin" /> run</>}
          {execState.status === 'done' && <><CheckCircle className="w-2.5 h-2.5" /> {execState.featureCount?.toLocaleString()}</>}
          {execState.status === 'error' && <><AlertCircle className="w-2.5 h-2.5" /> err</>}
        </div>
      )}

      {/* Execute up to this node */}
      <button
        type="button"
        onClick={handleExecute}
        title="Execute up to this node"
        disabled={execState?.status === 'running'}
        className="rounded-md border border-slate-200 bg-white p-1 text-emerald-600 shadow-sm hover:bg-emerald-50 disabled:opacity-40"
      >
        <Play className="w-3.5 h-3.5" />
      </button>

      {/* Export node output */}
      <div className="relative group">
        <button
          type="button"
          onClick={() => handleExport('geojson')}
          disabled={exporting}
          title="Export node output as GeoJSON"
          className="rounded-md border border-slate-200 bg-white p-1 text-slate-500 shadow-sm hover:bg-slate-50 disabled:opacity-40"
        >
          <Download className={exporting ? 'w-3.5 h-3.5 animate-spin' : 'w-3.5 h-3.5'} />
        </button>
        <div className="absolute right-0 top-full mt-1 z-50 hidden group-hover:block">
          <button
            onClick={() => handleExport('csv')}
            className="whitespace-nowrap bg-white border border-slate-200 rounded-lg px-2 py-1 text-[9px] font-semibold text-slate-600 hover:bg-slate-50 shadow-lg"
          >
            Export CSV
          </button>
        </div>
      </div>

      {helperContent && (
        <div className="relative" ref={popoverRef}>
          <button
            type="button"
            onClick={() => setShowHelper((v) => !v)}
            title="Show info"
            className="rounded-md border border-slate-200 bg-white p-1 text-slate-400 shadow-sm hover:bg-blue-50 hover:text-blue-500 transition-colors"
          >
            <Info className="w-3.5 h-3.5" />
          </button>
          {showHelper && (
            <div className="absolute right-0 top-full mt-1 z-50 w-56 rounded-xl border border-slate-200 bg-white p-3 shadow-xl text-[10px] text-slate-600 space-y-1">
              {helperContent}
            </div>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={() => duplicateNode(id, `node-${Date.now()}`)}
        title="Duplicate node"
        className="rounded-md border border-slate-200 bg-white p-1 text-slate-500 shadow-sm hover:bg-slate-50"
      >
        <Copy className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => removeNode(id)}
        title="Delete node"
        className="rounded-md border border-slate-200 bg-white p-1 text-rose-500 shadow-sm hover:bg-rose-50"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
