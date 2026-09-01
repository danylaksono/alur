import { useMemo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Filter, X } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { cn } from '../../utils/cn';
import {
  DEFAULT_EXCLUSION_FIELD,
  exclusionColumns,
  filterPredicateErrors,
  type FilterOutcome,
  type FilterPredicate,
} from '../../utils/filterPredicates';
import { ConstraintFunnelStrip } from './ConstraintFunnelStrip';
import { FlowNodeShell, fieldLabelClass, inputClass, nodeHandleClass, selectClass } from './FlowNodeShell';

const EXCLUDED_COLUMNS = new Set(['geometry', 'geom', 'geojson', 'geom_agg']);

type FilterMode = 'condition' | 'top-n' | 'criteria';

export const FilterNode = ({ data, id, selected }: any) => {
  const updateNode = useStore((s) => s.updateNode);
  const edges = useStore((s) => s.edges);
  const nodeSchemas = useStore((s) => s.nodeSchemas);
  const config = data.config || {};
  const mode: FilterMode = config.mode === 'top-n' || config.mode === 'criteria' ? config.mode : 'condition';
  const condition = config.condition || '';
  const field = config.field || '';
  const count = config.count ?? 20;
  const direction: 'desc' | 'asc' = config.direction === 'asc' ? 'asc' : 'desc';
  const selectionCount = Array.isArray(config.selectionIds) ? config.selectionIds.length : 0;
  const predicates: FilterPredicate[] = Array.isArray(config.predicates) ? config.predicates : [];
  const outcome: FilterOutcome = config.outcome === 'tag' ? 'tag' : 'drop';
  const columns = exclusionColumns(config.exclusionField || DEFAULT_EXCLUSION_FIELD);

  const error = useMemo(() => {
    if (mode === 'top-n') {
      if (!field) return 'Choose a column to rank by';
      if (!Number.isFinite(Number(count)) || Number(count) < 1) return 'Keep at least one row';
      return null;
    }
    if (mode === 'criteria') return filterPredicateErrors(predicates)[0] || null;
    if (!condition.trim() && !selectionCount) return 'Condition is required';
    return null;
  }, [mode, field, count, condition, selectionCount, predicates]);

  const updateConfig = (payload: any) => updateNode(id, { ...config, ...payload });
  const updatePredicates = (next: FilterPredicate[]) => updateConfig({ predicates: next });
  const updatePredicate = (index: number, patch: Partial<FilterPredicate>) =>
    updatePredicates(predicates.map((item, position) => (position === index ? { ...item, ...patch } : item)));

  const changeMode = (next: FilterMode) => {
    // Switching to named conditions carries the existing WHERE clause across as
    // the first one, so nothing the user typed is lost to a dropdown.
    const seeded = next === 'criteria' && !predicates.length && condition.trim()
      ? [{ id: `p-${Date.now()}`, expression: condition.trim(), severity: 'hard' as const }]
      : undefined;
    updateConfig({ mode: next, selectionIds: undefined, ...(seeded ? { predicates: seeded } : {}) });
  };

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
    : mode === 'criteria'
      ? predicates.length
        ? `${predicates.length} condition${predicates.length === 1 ? '' : 's'} · ${outcome === 'tag' ? 'tag only' : 'drop failures'}`
        : 'Named conditions'
      : condition || 'WHERE condition';

  const helperContent = mode === 'top-n' ? (
    <div>
      <div className="font-semibold text-slate-800">Top N rows</div>
      <div>Keeps the highest or lowest rows by a column.</div>
      <div className="mt-2 text-[11px] text-slate-500">
        Ties are kept together, so asking for 20 can return more than 20 if several rows share the boundary value.
      </div>
    </div>
  ) : mode === 'criteria' ? (
    <div>
      <div className="font-semibold text-slate-800">Named conditions</div>
      <div>Records why each row is where it is, instead of letting excluded rows simply vanish.</div>
      <div className="mt-2 text-[11px] text-slate-500">
        Writes <code>{columns.excluded}</code> (would a hard condition have removed it),
        {' '}<code>{columns.reasons}</code> (which conditions it fails) and
        {' '}<code>{columns.count}</code>. Soft conditions never remove a row — they only annotate it,
        so you can style near-misses rather than lose them.
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
  );

  return (
    <FlowNodeShell
      id={id}
      selected={selected}
      tone="amber"
      icon={Filter}
      label="Filter"
      title={title}
      widthClassName={mode === 'criteria' ? 'w-72' : 'w-60'}
      helperContent={helperContent}
    >
      <div>
        <label className={cn(fieldLabelClass, 'mb-1')}>Mode</label>
        <select className={selectClass} value={mode} onChange={(e) => changeMode(e.target.value as FilterMode)}>
          <option value="condition">WHERE condition</option>
          <option value="top-n">Top N by column</option>
          <option value="criteria">Named conditions</option>
        </select>
      </div>

      {mode === 'top-n' && (
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
      )}

      {mode === 'criteria' && (
        <>
          <div>
            <label className={cn(fieldLabelClass, 'mb-1')}>Rows failing a hard condition</label>
            <select className={selectClass} value={outcome} onChange={(e) => updateConfig({ outcome: e.target.value })}>
              <option value="drop">Remove them</option>
              <option value="tag">Keep them, marked</option>
            </select>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className={fieldLabelClass}>Conditions</label>
              <button
                type="button"
                onClick={() => updatePredicates([...predicates, { id: `p-${Date.now()}`, expression: '', severity: 'hard' }])}
                className="pressable rounded px-1 text-[10px] font-bold text-amber-700 hover:bg-amber-50"
              >
                + Add
              </button>
            </div>

            <div className="space-y-2">
              {predicates.map((predicate, index) => (
                <div key={predicate.id || index} className="rounded-md border border-slate-200 bg-slate-50/60 p-1.5">
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      className={cn(inputClass, 'flex-1')}
                      value={predicate.label || ''}
                      onChange={(e) => updatePredicate(index, { label: e.target.value })}
                      placeholder="Name, e.g. Large enough site"
                      aria-label={`Condition ${index + 1} name`}
                    />
                    <button
                      type="button"
                      onClick={() => updatePredicates(predicates.filter((_, position) => position !== index))}
                      className="pressable rounded p-1 text-slate-400 hover:bg-white hover:text-rose-600"
                      aria-label={`Remove condition ${index + 1}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <textarea
                    rows={2}
                    className={cn(inputClass, 'mt-1 font-mono')}
                    value={predicate.expression}
                    onChange={(e) => updatePredicate(index, { expression: e.target.value })}
                    placeholder="e.g. area_m2 >= 500"
                    aria-label={`Condition ${index + 1} expression`}
                  />
                  <select
                    className={cn(selectClass, 'mt-1 text-[10px]')}
                    value={predicate.severity}
                    onChange={(e) => updatePredicate(index, { severity: e.target.value as FilterPredicate['severity'] })}
                    aria-label={`Condition ${index + 1} severity`}
                  >
                    <option value="hard">Hard — can remove the row</option>
                    <option value="soft">Soft — only marks the row</option>
                  </select>
                </div>
              ))}
            </div>

            {!predicates.length && (
              <p className="text-[10px] leading-4 text-slate-500">
                Name each condition so an excluded row can say what excluded it.
              </p>
            )}
          </div>

          {columnNames.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {columnNames.slice(0, 8).map((col) => (
                <span key={col} className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                  {col}
                </span>
              ))}
              {columnNames.length > 8 && <span className="text-[10px] text-slate-400">+{columnNames.length - 8}</span>}
            </div>
          )}

          {predicates.length > 0 && <ConstraintFunnelStrip nodeId={id} predicates={predicates} />}
        </>
      )}

      {mode === 'condition' && (
        <>
          {columnNames.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {columnNames.slice(0, 8).map((col) => (
                <button
                  key={col}
                  className="pressable rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] text-amber-700 transition-colors hover:bg-amber-100"
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
