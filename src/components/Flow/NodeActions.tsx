import { useState, useRef, useEffect, type ReactNode } from 'react';
import { Copy, Trash2, Info, Play, Download, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { buildUpToSQL } from '../../utils/workflowEngine';
import { duckdbService } from '../../services/duckdb';
import { materializeWorkflowOutput } from '../../services/layerMaterialization';
import { registerWorkflowResult } from '../../services/workflowRun';
import { cn } from '../../utils/cn';

interface NodeActionsProps {
  id: string;
  selected?: boolean;
  helperContent?: ReactNode;
}

const actionButtonClass = 'rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40';

export const NodeActions = ({ id, selected = false, helperContent }: NodeActionsProps) => {
  const removeNode = useStore((s) => s.removeNode);
  const duplicateNode = useStore((s) => s.duplicateNode);
  const nodeExecutionStates = useStore((s) => s.nodeExecutionStates);
  const setNodeExecutionState = useStore((s) => s.setNodeExecutionState);
  const addToast = useStore((s) => s.addToast);
  const [showHelper, setShowHelper] = useState(false);
  const [exporting, setExporting] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const execState = nodeExecutionStates[id];

  const handleExecute = async () => {
    const { nodes, edges, fragments } = useStore.getState();
    setNodeExecutionState(id, { status: 'running' });
    try {
      const workflow = buildUpToSQL(nodes, edges, id, { fragments });
      const result = await materializeWorkflowOutput({
        workflow,
        layerId: `exec-${id}`,
        name: `Step: ${nodes.find((n) => n.id === id)?.data.label || id}`,
        sourceNodeId: id,
        sourceKind: 'step',
        visualisationConfig: workflow.visualisationConfig,
      });
      if (!result.featureCount) {
        addToast({ type: 'warning', message: 'Execution produced no rows.' });
        setNodeExecutionState(id, { status: 'done', featureCount: 0 });
        return;
      }
      registerWorkflowResult(result, { nodeId: id });
      if (result.kind === 'table') {
        addToast({ type: 'success', message: `Step produced ${result.featureCount.toLocaleString()} rows with no geometry — available to charts, comparison and the report.` });
      }
      setNodeExecutionState(id, { status: 'done', featureCount: result.featureCount });
    } catch (err: any) {
      setNodeExecutionState(id, { status: 'error', error: err.message });
      addToast({ type: 'error', message: `Step error: ${err.message}` });
    }
  };

  const handleExport = async (format: 'geojson' | 'csv' = 'geojson') => {
    const { nodes, edges, fragments } = useStore.getState();
    setExporting(true);
    try {
      const workflow = buildUpToSQL(nodes, edges, id, { fragments });
      if (format === 'geojson') {
        const tableName = `alur_export_${id.replace(/[^a-zA-Z0-9_]/g, '_')}_${Date.now()}`;
        await duckdbService.materializeQueryAsTable(workflow.resultSql, tableName);
        const geojson = await duckdbService.getGeoJSONFromTable(tableName, 100000);
        if (!geojson || geojson.features.length === 0) {
          addToast({ type: 'warning', message: 'Nothing to export.' });
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
        addToast({ type: 'success', message: `Exported ${geojson.features.length.toLocaleString()} features as GeoJSON` });
      } else {
        const { buffer, fileName } = await duckdbService.exportTable(workflow.resultSql, 'csv');
        const blob = new Blob([buffer as BlobPart], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
        addToast({ type: 'success', message: 'Exported as CSV' });
      }
    } catch (err: any) {
      addToast({ type: 'error', message: `Export error: ${err.message}` });
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
    <>
      {/* Persistent execution status — stays visible when the toolbar is hidden. */}
      {execState && execState.status !== 'idle' && (
        <button
          type="button"
          className={cn(
            'nodrag absolute right-2 top-3 z-10 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            execState.status === 'running' && 'bg-amber-100 text-amber-700',
            execState.status === 'done' && 'bg-emerald-100 text-emerald-700',
            execState.status === 'error' && 'bg-red-100 text-red-700',
          )}
          onClick={resetExecution}
          title={execState.status === 'error' ? `${execState.error} (click to reset)` : 'Click to reset'}
        >
          {execState.status === 'running' && <><Loader2 className="h-2.5 w-2.5 animate-spin" /> run</>}
          {execState.status === 'done' && <><CheckCircle className="h-2.5 w-2.5" /> {execState.featureCount?.toLocaleString()}</>}
          {execState.status === 'error' && <><AlertCircle className="h-2.5 w-2.5" /> err</>}
        </button>
      )}

      {/* Action toolbar — floats above the card, appears on hover or selection. */}
      <div
        className={cn(
          'nodrag absolute bottom-full right-0 z-20 pb-1 transition-opacity',
          selected ? 'opacity-100' : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100'
        )}
      >
        <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5 shadow-md">
          <button
            type="button"
            onClick={handleExecute}
            title="Run up to this node"
            disabled={execState?.status === 'running'}
            className={cn(actionButtonClass, 'text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700')}
          >
            <Play className="h-3.5 w-3.5" />
          </button>

          <div className="group/export relative">
            <button
              type="button"
              onClick={() => handleExport('geojson')}
              disabled={exporting}
              title="Export node output as GeoJSON"
              className={actionButtonClass}
            >
              <Download className={exporting ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
            </button>
            <div className="absolute right-0 top-full z-50 hidden pt-1 group-hover/export:block">
              <button
                onClick={() => handleExport('csv')}
                className="whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 shadow-lg hover:bg-slate-50"
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
                className={actionButtonClass}
              >
                <Info className="h-3.5 w-3.5" />
              </button>
              {showHelper && (
                <div className="absolute right-0 top-full z-50 mt-1 w-56 space-y-1 rounded-lg border border-slate-200 bg-white p-3 text-[11px] text-slate-600 shadow-xl">
                  {helperContent}
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => duplicateNode(id, `node-${Date.now()}`)}
            title="Duplicate node"
            className={actionButtonClass}
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => removeNode(id)}
            title="Delete node"
            className={cn(actionButtonClass, 'text-rose-500 hover:bg-rose-50 hover:text-rose-600')}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </>
  );
};
