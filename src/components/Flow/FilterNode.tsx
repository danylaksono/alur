import { useMemo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Filter } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { cn } from '../../utils/cn';
import { FlowNodeShell, fieldLabelClass, inputClass, nodeHandleClass } from './FlowNodeShell';

export const FilterNode = ({ data, id, selected }: any) => {
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
    <FlowNodeShell
        id={id}
        selected={selected}
        tone="amber"
        icon={Filter}
        label="Filter"
        title={condition || 'WHERE condition'}
        helperContent={
          <div>
            <div className="font-semibold text-slate-800">Filter Rows</div>
            <div>Filter the dataset using a SQL WHERE clause.</div>
            <div className="text-[11px] text-slate-500 mt-2">
              Example: <code>price &gt; 100 AND category = 'urban'</code>
            </div>
          </div>
        }
      >
        {columnNames.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {columnNames.slice(0, 8).map((col) => (
              <button
                key={col}
                className="text-[10px] font-mono bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded border border-amber-200 hover:bg-amber-100 transition-colors"
                onClick={() => updateConfig({ condition: condition ? `${condition} ${col}` : col })}
                title={`Insert "${col}" into condition`}
              >
                {col}
              </button>
            ))}
            {columnNames.length > 8 && (
              <span className="text-[10px] text-slate-400">+{columnNames.length - 8}</span>
            )}
          </div>
        )}
        <div>
          <label className={cn(fieldLabelClass, 'mb-1')}>
            WHERE Condition
          </label>
          <textarea
            rows={3}
            className={cn(
              inputClass,
              'font-mono',
              error && 'border-red-300 bg-red-50 text-red-800 focus:border-red-400 focus:ring-red-200'
            )}
            value={condition}
            onChange={(e) => updateConfig({ condition: e.target.value })}
            placeholder="e.g. need > 10"
          />
          {error && <div className="text-[11px] text-red-500 mt-1 font-medium">{error}</div>}
        </div>
      <Handle type="target" position={Position.Left} className={nodeHandleClass('amber')} />
      <Handle type="source" position={Position.Right} className={nodeHandleClass('amber')} />
    </FlowNodeShell>
  );
};
