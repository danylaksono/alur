import { useMemo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Gauge } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { allocationColumns, allocationErrors, type AllocationConfig, type AllocationMode } from '../../utils/aggregationSql';
import { cn } from '../../utils/cn';
import { FlowNodeShell, fieldLabelClass, inputClass, nodeHandleClass, selectClass } from './FlowNodeShell';

const EXCLUDED_COLUMNS = new Set(['geometry', 'geom', 'geojson', 'geom_agg']);

const MODE_OPTIONS: Array<{ value: AllocationMode; label: string; detail: string }> = [
  { value: 'flag', label: 'Flag within / over', detail: 'Keeps every row and marks where the limit was reached.' },
  { value: 'cut', label: 'Keep only what fits', detail: 'Drops every row past the limit.' },
  { value: 'scale', label: 'Scale the last one', detail: 'Keeps every row that fits and gives the one straddling the limit a partial share.' },
];

export const AllocateNode = ({ data, id, selected }: any) => {
  const updateNode = useStore((s) => s.updateNode);
  const edges = useStore((s) => s.edges);
  const nodeSchemas = useStore((s) => s.nodeSchemas);
  const config = data.config || {};
  const mode: AllocationMode = MODE_OPTIONS.some((option) => option.value === config.mode) ? config.mode : 'flag';
  const orderBy = config.orderBy || '';
  const amountField = config.amountField || '';
  const partitionBy = config.partitionBy || '';
  const limit = config.limit ?? '';
  const direction: 'desc' | 'asc' = config.direction === 'asc' ? 'asc' : 'desc';

  const updateConfig = (payload: Record<string, unknown>) => updateNode(id, { ...config, ...payload });

  const incomingEdge = edges.find((e) => e.target === id);
  const upstreamSchema = incomingEdge?.source ? nodeSchemas[incomingEdge.source] : null;
  const columnNames: string[] = useMemo(
    () => (upstreamSchema || [])
      .map((col: any) => col.name || col.column_name)
      .filter((name: unknown): name is string =>
        typeof name === 'string' && !EXCLUDED_COLUMNS.has(name.toLowerCase()) && !name.toLowerCase().startsWith('__alur_')),
    [upstreamSchema],
  );

  const errors = allocationErrors({ orderBy, amountField, limit: Number(limit), mode });
  const columns = allocationColumns({ orderBy, amountField, limit: Number(limit) } as AllocationConfig);
  const activeMode = MODE_OPTIONS.find((option) => option.value === mode)!;

  const columnField = (label: string, value: string, key: string, placeholder: string, optional = false) => (
    <div>
      <label className={cn(fieldLabelClass, 'mb-1')}>
        {label}{optional && <span className="normal-case text-slate-400"> (optional)</span>}
      </label>
      {columnNames.length ? (
        <select className={selectClass} value={value} onChange={(e) => updateConfig({ [key]: e.target.value })} aria-label={label}>
          <option value="">{optional ? 'None' : 'Choose a column…'}</option>
          {columnNames.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      ) : (
        <input
          type="text"
          className={inputClass}
          value={value}
          onChange={(e) => updateConfig({ [key]: e.target.value })}
          placeholder={placeholder}
          aria-label={label}
        />
      )}
    </div>
  );

  return (
    <FlowNodeShell
      id={id}
      selected={selected}
      tone="amber"
      icon={Gauge}
      label="Allocate"
      title={amountField && limit !== '' ? `${amountField} up to ${Number(limit).toLocaleString()}` : 'Allocate under a limit'}
      helperContent={
        <div>
          <div className="font-semibold text-slate-800">Allocate under a limit</div>
          <div>Works down the rows in priority order, adding up one column until the limit is reached.</div>
          <div className="mt-2 text-[11px] text-slate-500">
            A budget, a grid capacity, a delivery quota — anything finite that candidates compete for.
            Group by a column to give each group its own limit rather than sharing one.
          </div>
        </div>
      }
    >
      {columnField('Priority order', orderBy, 'orderBy', 'e.g. alur_priority_score')}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={cn(fieldLabelClass, 'mb-1')}>Serve</label>
          <select className={selectClass} value={direction} onChange={(e) => updateConfig({ direction: e.target.value })}>
            <option value="desc">Highest first</option>
            <option value="asc">Lowest first</option>
          </select>
        </div>
        <div>
          <label className={cn(fieldLabelClass, 'mb-1')}>Limit</label>
          <input
            type="number"
            min={0}
            className={inputClass}
            value={limit}
            onChange={(e) => updateConfig({ limit: e.target.value === '' ? undefined : Number(e.target.value) })}
            placeholder="e.g. 10000000"
          />
        </div>
      </div>

      {columnField('Amount consumed', amountField, 'amountField', 'e.g. capital_cost')}
      {columnField('Separate limit per', partitionBy, 'partitionBy', 'e.g. ward_code', true)}

      <div>
        <label className={cn(fieldLabelClass, 'mb-1')}>When the limit is reached</label>
        <select className={selectClass} value={mode} onChange={(e) => updateConfig({ mode: e.target.value })}>
          {MODE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <p className="mt-1 text-[10px] leading-4 text-slate-500">{activeMode.detail}</p>
      </div>

      {amountField && (
        <p className="font-mono text-[9px] leading-4 text-slate-400">
          → {columns.cumulative}, {columns.status}{mode === 'scale' ? `, ${columns.allocated}` : ''}
        </p>
      )}

      {errors.length > 0 && <p className="text-[10px] leading-4 text-amber-700">{errors[0]}</p>}

      <Handle type="target" position={Position.Left} className={nodeHandleClass('amber')} />
      <Handle type="source" position={Position.Right} className={nodeHandleClass('amber')} />
    </FlowNodeShell>
  );
};
