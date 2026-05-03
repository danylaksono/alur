import { useMemo, type ChangeEvent } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Layers } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { spatialFunctions } from '../../utils/spatialFunctions';
import { NodeActions } from './NodeActions';
import { NodeSchema } from './NodeSchema';
import { cn } from '../../utils/cn';

export const AggregateNode = ({ data, id }: any) => {
  const updateNode = useStore((s) => s.updateNode);
  const edges = useStore((s) => s.edges);
  const nodeSchemas = useStore((s) => s.nodeSchemas);
  const operation = data.config?.operation || 'ST_Union_Agg';
  const groupBy = data.config?.groupBy || '';

  const aggregateFunctions = spatialFunctions.filter(fn => fn.category === 'Aggregate');
  const selectedFunction = aggregateFunctions.find(fn => fn.name === operation) || aggregateFunctions[0];

  const updateConfig = (payload: any) => updateNode(id, { ...data.config, ...payload });

  const incomingEdge = edges.find((e) => e.target === id);
  const upstreamSchema = incomingEdge?.source ? nodeSchemas[incomingEdge.source] : null;
  const columnNames: string[] = useMemo(
    () => (upstreamSchema || []).map((col: any) => col.name),
    [upstreamSchema]
  );

  const helperContent = (
    <>
      <div className="font-semibold text-slate-800">{selectedFunction?.name}</div>
      <div>{selectedFunction?.summary}</div>
      <div className="text-[9px] text-slate-500 mt-2">
        Grouping by a column will return one geometry per unique value.
        Leaving it empty will union/extent everything into a single geometry.
      </div>
    </>
  );

  return (
    <div className="relative px-4 py-3 min-w-[280px] bg-white border-l-4 border-l-orange-500 rounded-xl shadow-lg">
      <NodeActions id={id} helperContent={helperContent} />
      <div className="text-[10px] font-bold text-muted-foreground uppercase mb-1 flex items-center gap-1">
        <Layers className="w-3 h-3 text-orange-500" /> Spatial Aggregate
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
            Aggregate Function
          </label>
          <select
            className="w-full rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-700 px-3 py-2 focus:border-orange-400 focus:ring-orange-200 focus:ring-2 outline-none"
            value={operation}
            onChange={(e) => updateConfig({ operation: e.target.value })}
          >
            {aggregateFunctions.map((op) => (
              <option key={op.name} value={op.name}>{op.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
            Group By Column <span className="text-slate-400 normal-case">(optional)</span>
          </label>
          {columnNames.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-1.5">
              {columnNames.slice(0, 10).map((col) => (
                <button
                  key={col}
                  className={cn(
                    'text-[8px] font-mono px-1.5 py-0.5 rounded border transition-colors',
                    groupBy === col
                      ? 'bg-orange-200 text-orange-800 border-orange-300'
                      : 'bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100'
                  )}
                  onClick={() => updateConfig({ groupBy: groupBy === col ? '' : col })}
                >
                  {col}
                </button>
              ))}
            </div>
          )}
          <input
            type="text"
            className="w-full rounded-lg border border-slate-200 bg-white text-sm text-slate-700 px-3 py-2 focus:border-orange-400 focus:ring-orange-200 focus:ring-2 outline-none"
            value={groupBy}
            onChange={(e) => updateConfig({ groupBy: e.target.value })}
            placeholder="e.g. city_name"
          />
        </div>
      </div>

      <div className="mt-3 text-[10px] font-mono bg-slate-50 p-2 rounded text-slate-500 border border-slate-100 break-words">
        {`SELECT ${groupBy ? `${groupBy}, ` : ''}${operation}(geom) FROM source${groupBy ? ` GROUP BY ${groupBy}` : ''};`}
      </div>

      <NodeSchema nodeId={id} />

      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-orange-400" />
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-orange-400" />
    </div>
  );
};
