import { useMemo, type ChangeEvent } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Filter } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { NodeActions } from './NodeActions';
import { NodeSchema } from './NodeSchema';
import { cn } from '../../utils/cn';

export const FilterNode = ({ data, id }: any) => {
  const updateNode = useStore((s) => s.updateNode);
  const edges = useStore((s) => s.edges);
  const nodeSchemas = useStore((s) => s.nodeSchemas);
  const condition = data.config?.condition || '';

  const error = useMemo(() => {
    if (!condition.trim()) return 'Condition is required';
    return null;
  }, [condition]);

  const updateConfig = (payload: any) => updateNode(id, { ...data.config, ...payload });

  const incomingEdge = edges.find((e) => e.target === id);
  const upstreamSchema = incomingEdge?.source ? nodeSchemas[incomingEdge.source] : null;
  const columnNames: string[] = useMemo(
    () => (upstreamSchema || []).map((col: any) => col.name),
    [upstreamSchema]
  );

  return (
    <div className="relative px-4 py-3 min-w-[280px] bg-white border-l-4 border-l-amber-500 rounded-xl shadow-lg">
      <NodeActions
        id={id}
        helperContent={
          <div>
            <div className="font-semibold text-slate-800">Filter Rows</div>
            <div>Filter the dataset using a SQL WHERE clause.</div>
            <div className="text-[9px] text-slate-500 mt-2">
              Example: <code>price &gt; 100 AND category = 'urban'</code>
            </div>
          </div>
        }
      />
      <div className="text-[10px] font-bold text-muted-foreground uppercase mb-1 flex items-center gap-1">
        <Filter className="w-3 h-3 text-amber-500" /> Filter
      </div>

      <div className="space-y-2">
        {columnNames.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {columnNames.slice(0, 8).map((col) => (
              <button
                key={col}
                className="text-[8px] font-mono bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded border border-amber-200 hover:bg-amber-100 transition-colors"
                onClick={() => updateConfig({ condition: condition ? `${condition} ${col}` : col })}
                title={`Insert "${col}" into condition`}
              >
                {col}
              </button>
            ))}
            {columnNames.length > 8 && (
              <span className="text-[8px] text-slate-400">+{columnNames.length - 8}</span>
            )}
          </div>
        )}
        <div>
          <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
            WHERE Condition
          </label>
          <textarea
            rows={3}
            className={cn(
              'w-full rounded-lg border text-sm px-3 py-2 outline-none font-mono transition-colors',
              error ? 'border-red-300 bg-red-50 text-red-800 focus:border-red-400 focus:ring-red-200 focus:ring-2' : 'border-slate-200 bg-white text-slate-700 focus:border-amber-400 focus:ring-amber-200 focus:ring-2'
            )}
            value={condition}
            onChange={(e) => updateConfig({ condition: e.target.value })}
            placeholder="e.g. need > 10"
          />
          {error && <div className="text-[9px] text-red-500 mt-1 font-medium">{error}</div>}
        </div>
      </div>

      <div className="mt-3 text-[10px] font-mono bg-slate-50 p-2 rounded text-slate-500 border border-slate-100 break-words">
        SELECT * FROM source WHERE {condition || '...'};
      </div>

      <NodeSchema nodeId={id} />

      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-amber-400" />
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-amber-400" />
    </div>
  );
};
