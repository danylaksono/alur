import { useMemo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Layers, Plus, X } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { spatialFunctions } from '../../utils/spatialFunctions';
import { SUMMARY_FUNCTIONS, measureAlias, summaryMeasureErrors, type SummaryMeasure } from '../../utils/aggregationSql';
import { cn } from '../../utils/cn';
import { FlowNodeShell, fieldLabelClass, inputClass, nodeHandleClass, selectClass } from './FlowNodeShell';
import { TypeaheadSelect } from './TypeaheadSelect';

const EXCLUDED_COLUMNS = new Set(['geometry', 'geom', 'geojson', 'geom_agg']);
const NEEDS_FIELD = new Set(SUMMARY_FUNCTIONS.filter((item) => item.needsField).map((item) => item.value));

export const AggregateNode = ({ data, id, selected }: any) => {
  const updateNode = useStore((s) => s.updateNode);
  const edges = useStore((s) => s.edges);
  const nodeSchemas = useStore((s) => s.nodeSchemas);
  const config = data.config || {};
  const mode: 'spatial' | 'summary' = config.mode === 'summary' ? 'summary' : 'spatial';
  const operation = config.operation || 'ST_Union_Agg';
  const includeGeometry = Boolean(config.includeGeometry);

  // Spatial mode groups by a single column; summary mode by several. Both read
  // from the same config key, so switching modes keeps the user's choice.
  const groupFields: string[] = useMemo(
    () => (Array.isArray(config.groupBy) ? config.groupBy : [config.groupBy]).filter(Boolean),
    [config.groupBy],
  );
  const measures: SummaryMeasure[] = useMemo(() => Array.isArray(config.measures) ? config.measures : [], [config.measures]);

  const aggregateFunctions = spatialFunctions.filter((fn) => fn.category === 'Aggregate');
  const selectedFunction = aggregateFunctions.find((fn) => fn.name === operation) || aggregateFunctions[0];
  const aggregateOptions = useMemo(
    () => aggregateFunctions.map((op) => ({ value: op.name, label: op.name, description: op.summary, group: op.category })),
    [aggregateFunctions],
  );

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

  const errors = mode === 'summary' ? summaryMeasureErrors(measures) : [];

  const updateMeasure = (index: number, patch: Partial<SummaryMeasure>) =>
    updateConfig({ measures: measures.map((measure, position) => position === index ? { ...measure, ...patch } : measure) });

  const addMeasure = () => updateConfig({
    measures: [...measures, { id: `measure-${Date.now()}`, fn: measures.length ? 'sum' : 'count', field: measures.length ? columnNames[0] : undefined }],
  });

  const toggleGroupField = (field: string) => updateConfig({
    groupBy: mode === 'summary'
      ? groupFields.includes(field) ? groupFields.filter((item) => item !== field) : [...groupFields, field]
      : groupFields[0] === field ? '' : field,
  });

  const title = mode === 'summary'
    ? measures.length ? `${measures.length} measure${measures.length === 1 ? '' : 's'}${groupFields.length ? ` by ${groupFields.join(', ')}` : ''}` : 'Summarise'
    : operation;

  const helperContent = mode === 'summary' ? (
    <>
      <div className="font-semibold text-slate-800">Summarise</div>
      <div>One row per group, with the measures you choose.</div>
      <div className="mt-2 text-[11px] text-slate-500">
        Sum, average and median cast their column to a number; min and max do not, so they still work on dates and text.
        Without a group column the whole table collapses to a single row.
      </div>
    </>
  ) : (
    <>
      <div className="font-semibold text-slate-800">{selectedFunction?.name}</div>
      <div>{selectedFunction?.summary}</div>
      <div className="mt-2 text-[11px] text-slate-500">
        Grouping returns one geometry per unique value; leaving it empty dissolves everything into one.
        Attributes are not carried through — switch to Summarise to keep numbers.
      </div>
    </>
  );

  return (
    <FlowNodeShell
      id={id}
      selected={selected}
      tone="orange"
      icon={Layers}
      label={mode === 'summary' ? 'Summarise' : 'Spatial Aggregate'}
      title={title}
      helperContent={helperContent}
    >
      <div>
        <label className={cn(fieldLabelClass, 'mb-1')}>Mode</label>
        <select className={selectClass} value={mode} onChange={(e) => updateConfig({ mode: e.target.value })}>
          <option value="summary">Summarise (numbers)</option>
          <option value="spatial">Dissolve (geometry)</option>
        </select>
      </div>

      {mode === 'spatial' && (
        <div>
          <label className={cn(fieldLabelClass, 'mb-1')}>Aggregate function</label>
          <TypeaheadSelect
            value={operation}
            options={aggregateOptions}
            onChange={(nextOperation) => updateConfig({ operation: nextOperation })}
            placeholder="Search aggregate functions..."
          />
        </div>
      )}

      <div>
        <label className={cn(fieldLabelClass, 'mb-1')}>
          Group by <span className="normal-case text-slate-500">{mode === 'summary' ? '(optional, several allowed)' : '(optional)'}</span>
        </label>
        {columnNames.length > 0 ? (
          <div className="mb-1.5 flex flex-wrap gap-1">
            {columnNames.slice(0, 12).map((col) => (
              <button
                key={col}
                type="button"
                className={cn(
                  'pressable rounded border px-1.5 py-0.5 font-mono text-[11px] transition-colors',
                  groupFields.includes(col)
                    ? 'border-orange-300 bg-orange-200 text-orange-800'
                    : 'border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100',
                )}
                onClick={() => toggleGroupField(col)}
              >
                {col}
              </button>
            ))}
          </div>
        ) : (
          <input
            type="text"
            className={inputClass}
            value={groupFields.join(', ')}
            onChange={(e) => updateConfig({
              groupBy: mode === 'summary'
                ? e.target.value.split(',').map((item) => item.trim()).filter(Boolean)
                : e.target.value.trim(),
            })}
            placeholder="e.g. ward_code"
          />
        )}
      </div>

      {mode === 'summary' && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className={fieldLabelClass}>Measures</label>
            <button type="button" onClick={addMeasure} className="pressable flex items-center gap-1 rounded px-1 text-[11px] font-bold text-orange-700 hover:bg-orange-50">
              <Plus className="h-3 w-3" /> Add
            </button>
          </div>

          <div className="space-y-1.5">
            {measures.map((measure, index) => (
              <div key={measure.id} className="flex items-center gap-1">
                <select
                  className={cn(selectClass, 'flex-1')}
                  value={measure.fn}
                  onChange={(e) => updateMeasure(index, { fn: e.target.value as SummaryMeasure['fn'] })}
                  aria-label={`Measure ${index + 1} function`}
                >
                  {SUMMARY_FUNCTIONS.map((fn) => <option key={fn.value} value={fn.value}>{fn.label}</option>)}
                </select>
                {NEEDS_FIELD.has(measure.fn) && (
                  columnNames.length ? (
                    <select
                      className={cn(selectClass, 'flex-1')}
                      value={measure.field || ''}
                      onChange={(e) => updateMeasure(index, { field: e.target.value })}
                      aria-label={`Measure ${index + 1} column`}
                    >
                      <option value="">Column…</option>
                      {columnNames.map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                  ) : (
                    <input
                      type="text"
                      className={cn(inputClass, 'flex-1')}
                      value={measure.field || ''}
                      onChange={(e) => updateMeasure(index, { field: e.target.value })}
                      placeholder="column"
                      aria-label={`Measure ${index + 1} column`}
                    />
                  )
                )}
                <button
                  type="button"
                  onClick={() => updateConfig({ measures: measures.filter((_, position) => position !== index) })}
                  className="pressable rounded p-1 text-slate-500 hover:bg-slate-50 hover:text-rose-600"
                  aria-label={`Remove measure ${index + 1}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>

          {measures.length > 0 && (
            <p className="mt-1.5 font-mono text-[11px] leading-4 text-slate-500">
              → {measures.map(measureAlias).join(', ')}
            </p>
          )}

          {groupFields.length > 0 && (
            <label className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-600">
              <input type="checkbox" checked={includeGeometry} onChange={(e) => updateConfig({ includeGeometry: e.target.checked })} />
              Merge each group's geometry, so the result can be mapped
            </label>
          )}

          {errors.length > 0 && <p className="mt-1.5 text-[11px] leading-4 text-amber-700">{errors[0]}</p>}
        </div>
      )}

      <Handle type="target" position={Position.Left} className={nodeHandleClass('orange')} />
      <Handle type="source" position={Position.Right} className={nodeHandleClass('orange')} />
    </FlowNodeShell>
  );
};
