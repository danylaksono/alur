import { useMemo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Filter } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { cn } from '../../utils/cn';
import { FlowNodeShell, fieldLabelClass, inputClass, nodeHandleClass, selectClass } from './FlowNodeShell';

const EXCLUDED_COLUMNS = new Set(['geometry', 'geom', 'geojson', 'geom_agg']);

export const FilterNode = ({ data, id, selected }: any) => {
  const updateNode = useStore((s) => s.updateNode);
  const edges = useStore((s) => s.edges);
  const nodeSchemas = useStore((s) => s.nodeSchemas);
  const config = data.config || {};
  const mode: 'condition' | 'top-n' = config.mode === 'top-n' ? 'top-n' : 'condition';
  const condition = config.condition || '';
  const field = config.field || '';
  const count = config.count ?? 20;
  const direction: 'desc' | 'asc' = config.direction === 'asc' ? 'asc' : 'desc';
  const selectionCount = Array.isArray(config.selectionIds) ? config.selectionIds.length : 0;

  const error = useMemo(() => {
    if (mode === 'top-n') {
      if (!field) return 'Choose a column to rank by';
      if (!Number.isFinite(Number(count)) || Number(count) < 1) return 'Keep at least one row';
      return null;
    }
    if (!condition.trim() && !selectionCount) return 'Condition is required';
    return null;
  }, [mode, field, count, condition, selectionCount]);

  const updateConfig = (payload: any) => updateNode(id, { ...config, ...payload });

  const incomingEdge = edges.find((e) => e.target === id);
  const upstreamSchema = incomingEdge?.source ? nodeSchemas[incomingEdge.source] : null;
  const columnNames: string[] = useMemo(
    () => (upstreamSchema || [])
      .map((col: any) => col.name || col.column_name)
      .filter((name: unknown): name is string =>
        typeof name === 'string' && !EXCLUDED_COLUMNS.has(name.toLowerCase()) && !name.toLowerCase().startsWith('__alur_')),
    [upstreamSchema],
  );

  const title = mode === 'top-n'
    ? field ? `${direction === 'desc' ? 'Top' : 'Bottom'} ${count} by ${field}` : 'Top N'
    : condition || 'WHERE condition';

  return (
    <FlowNodeShell
      id={id}
      selected={selected}
      tone="amber"
      icon={Filter}
      label="Filter"
      title={title}
      helperContent={mode === 'top-n' ? (
        <div>
          <div className="font-semibold text-slate-800">Top N rows</div>
          <div>Keeps the highest or lowest rows by a column.</div>
          <div className="mt-2 text-[11px] text-slate-500">
            Ties are kept together, so asking for 20 can return more than 20 if several rows share the boundary value.
          </div>
        </div>
      ) : (
        <div>
          <div className="font-semibold text-slate-800">Filter Rows</div>
          <div>Filter the dataset using a SQL WHERE clause.</div>
          <div className="mt-2 text-[11px] text-slate-500">
            Example: <code>price &gt; 100 AND category = 'urban'</code>
          </div>
        </div>
      )}
    >
      <div>
        <label className={cn(fieldLabelClass, 'mb-1')}>Mode</label>
        <select
          className={selectClass}
          value={mode}
          onChange={(e) => updateConfig({ mode: e.target.value, selectionIds: undefined })}
        >
          <option value="condition">WHERE condition</option>
          <option value="top-n">Top N by column</option>
        </select>
      </div>

      {mode === 'top-n' ? (
        <>
          <div>
            <label className={cn(fieldLabelClass, 'mb-1')}>Rank by</label>
            {columnNames.length ? (
              <select className={selectClass} value={field} onChange={(e) => updateConfig({ field: e.target.value })}>
                <option value="">Choose a column…</option>
                {columnNames.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            ) : (
              <input
                type="text"
                className={inputClass}
                value={field}
                onChange={(e) => updateConfig({ field: e.target.value })}
                placeholder="e.g. alur_priority_score"
              />
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={cn(fieldLabelClass, 'mb-1')}>Keep</label>
              <input
                type="number"
                min={1}
                className={inputClass}
                value={count}
                onChange={(e) => updateConfig({ count: Number(e.target.value) })}
              />
            </div>
            <div>
              <label className={cn(fieldLabelClass, 'mb-1')}>Order</label>
              <select className={selectClass} value={direction} onChange={(e) => updateConfig({ direction: e.target.value })}>
                <option value="desc">Highest first</option>
                <option value="asc">Lowest first</option>
              </select>
            </div>
          </div>
        </>
      ) : (
        <>
          {columnNames.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {columnNames.slice(0, 8).map((col) => (
                <button
                  key={col}
                  className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] text-amber-700 transition-colors hover:bg-amber-100"
                  onClick={() => updateConfig({ condition: selectionCount ? col : condition ? `${condition} ${col}` : col, selectionIds: undefined })}
                  title={`Insert "${col}" into condition`}
                >
                  {col}
                </button>
              ))}
              {columnNames.length > 8 && <span className="text-[10px] text-slate-400">+{columnNames.length - 8}</span>}
            </div>
          )}
          <div>
            {selectionCount > 0 && (
              <div className="mb-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] font-semibold text-amber-700">
                Snapshot of {selectionCount.toLocaleString()} selected rows. Editing the condition converts this to a regular SQL filter.
              </div>
            )}
            <label className={cn(fieldLabelClass, 'mb-1')}>WHERE Condition</label>
            <textarea
              rows={3}
              className={cn(
                inputClass,
                'font-mono',
                error && 'border-red-300 bg-red-50 text-red-800 focus:border-red-400 focus:ring-red-200',
              )}
              value={condition}
              onChange={(e) => updateConfig({ condition: e.target.value, selectionIds: undefined })}
              placeholder="e.g. need > 10"
            />
          </div>
        </>
      )}

      {error && <div className="mt-1 text-[11px] font-medium text-red-500">{error}</div>}
      <Handle type="target" position={Position.Left} className={nodeHandleClass('amber')} />
      <Handle type="source" position={Position.Right} className={nodeHandleClass('amber')} />
    </FlowNodeShell>
  );
};
