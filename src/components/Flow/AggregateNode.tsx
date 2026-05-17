import { useMemo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Layers } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { spatialFunctions } from '../../utils/spatialFunctions';
import { cn } from '../../utils/cn';
import { FlowNodeShell, fieldLabelClass, inputClass, nodeHandleClass, selectClass } from './FlowNodeShell';

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
    <FlowNodeShell
      id={id}
      tone="orange"
      icon={Layers}
      label="Spatial Aggregate"
      title={operation}
      helperContent={helperContent}
    >
        <div>
          <label className={cn(fieldLabelClass, 'mb-1')}>
            Aggregate Function
          </label>
          <select
            className={selectClass}
            value={operation}
            onChange={(e) => updateConfig({ operation: e.target.value })}
          >
            {aggregateFunctions.map((op) => (
              <option key={op.name} value={op.name}>{op.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={cn(fieldLabelClass, 'mb-1')}>
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
            className={inputClass}
            value={groupBy}
            onChange={(e) => updateConfig({ groupBy: e.target.value })}
            placeholder="e.g. city_name"
          />
        </div>
      <Handle type="target" position={Position.Left} className={nodeHandleClass('orange')} />
      <Handle type="source" position={Position.Right} className={nodeHandleClass('orange')} />
    </FlowNodeShell>
  );
};
