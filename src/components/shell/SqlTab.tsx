import { useState } from 'react';
import { Play, Workflow } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { duckdbService } from '../../services/duckdb';
import { cn } from '../../utils/cn';

export const SqlTab = ({
  setManualPreview,
}: {
  setManualPreview: (rows: Record<string, any>[] | null) => void;
}) => {
  const manualSQL = useStore((s) => s.manualSQL);
  const setManualSQL = useStore((s) => s.setManualSQL);
  const isManualSQL = useStore((s) => s.isManualSQL);
  const setIsManualSQL = useStore((s) => s.setIsManualSQL);
  const addMapLayer = useStore((s) => s.addMapLayer);
  const addNode = useStore((s) => s.addNode);
  const addToast = useStore((s) => s.addToast);
  const openDrawerTab = useStore((s) => s.openDrawerTab);
  const setSelectedNodeId = useStore((s) => s.setSelectedNodeId);
  const setSelectedLayerId = useStore((s) => s.setSelectedLayerId);
  const [lastManualSql, setLastManualSql] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const handleRunSQL = async () => {
    if (!manualSQL || isRunning) return;
    try {
      setIsRunning(true);
      const layerId = `manual-query-${Date.now()}`;
      const tableName = `ymn_manual_${Date.now()}`;
      await duckdbService.materializeQueryAsTable(manualSQL, tableName);
      const source = await duckdbService.prepareLayerSource(tableName, { kind: 'duckdb-query' });
      const featureCount = await duckdbService.getTableFeatureCount(tableName);
      if (source) {
        addMapLayer({
          id: layerId,
          name: 'Query Result',
          source,
          tileSource: source.tileSource,
          featureCount,
          sourceKind: 'manual',
        });
      } else {
        // No geometry — show raw rows in the table tab instead of a map layer.
        setSelectedNodeId(null);
        setSelectedLayerId(null);
        const result = await duckdbService.query(manualSQL);
        setManualPreview(result.toArray().map((r: any) => (typeof r.toJSON === 'function' ? r.toJSON() : r)));
      }
      setLastManualSql(manualSQL);
      openDrawerTab('table');
    } catch (err: any) {
      addToast({ type: 'error', message: `SQL Error: ${err.message}` });
    } finally {
      setIsRunning(false);
    }
  };

  const handlePromoteToNode = () => {
    if (!lastManualSql) return;
    addNode({
      id: `sql-node-${Date.now()}`,
      type: 'analysis',
      position: { x: 350, y: 250 },
      data: {
        label: 'Custom SQL',
        type: 'analysis',
        config: { operation: 'ST_Buffer', customSql: lastManualSql },
      },
    });
    addToast({ type: 'success', message: 'Created node from SQL' });
    setLastManualSql(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50">
      <div className="flex h-9 shrink-0 items-center justify-between border-b bg-slate-50 px-3">
        <h3 className="text-xs font-semibold text-slate-600">
          {isManualSQL ? 'SQL Editor' : 'Workflow SQL Preview'}
        </h3>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2">
            <span className="text-[11px] font-semibold text-slate-500">Manual mode</span>
            <div className="relative">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={isManualSQL}
                onChange={(e) => setIsManualSQL(e.target.checked)}
              />
              <div className="h-4 w-8 rounded-full bg-slate-200 transition-colors peer-checked:bg-primary"></div>
              <div className="absolute left-1 top-1 h-2 w-2 rounded-full bg-white transition-transform peer-checked:translate-x-4"></div>
            </div>
          </label>
          {isManualSQL && (
            <>
              <button
                onClick={handleRunSQL}
                disabled={isRunning || !manualSQL}
                className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white shadow transition-all hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Play className="h-3 w-3 fill-current" /> {isRunning ? 'Running…' : 'Run query'}
              </button>
              {lastManualSql && (
                <button
                  onClick={handlePromoteToNode}
                  className="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-700 transition-all hover:bg-indigo-100"
                >
                  <Workflow className="h-3 w-3" /> Promote to node
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 p-3">
        <textarea
          value={manualSQL}
          onChange={(e) => isManualSQL && setManualSQL(e.target.value)}
          readOnly={!isManualSQL}
          className={cn(
            'h-full w-full resize-none rounded-lg border bg-white p-3 font-mono text-xs leading-relaxed shadow-inner outline-none transition-all',
            isManualSQL ? 'border-primary text-slate-800 ring-2 ring-primary/5' : 'border-slate-200 bg-slate-100/50 text-slate-500'
          )}
          placeholder={isManualSQL ? 'Write your spatial SQL here…' : 'Build a workflow to see its generated SQL, or switch to manual mode.'}
        />
      </div>
    </div>
  );
};
