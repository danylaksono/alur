import { useMemo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { SlidersHorizontal, X } from 'lucide-react';
import { useStore } from '../../store/useStore';
import type { ScoreCriterion, ScoreModelSpec } from '../../types/visualAnalytics';
import { normalisedWeights, scoreModelErrors } from '../../utils/scoreModel';
import { cn } from '../../utils/cn';
import { FlowNodeShell, fieldLabelClass, inputClass, nodeHandleClass, selectClass } from './FlowNodeShell';

const EXCLUDED_COLUMNS = new Set(['geometry', 'geom', 'geojson', 'geom_agg']);
const EMPTY_MODEL: ScoreModelSpec = { criteria: [], missingValueTreatment: 'zero' };

export const ScoreNode = ({ data, id, selected }: any) => {
  const updateNode = useStore((s) => s.updateNode);
  const edges = useStore((s) => s.edges);
  const nodeSchemas = useStore((s) => s.nodeSchemas);
  const config = data.config || {};
  const spec: ScoreModelSpec = config.scoreModel || EMPTY_MODEL;
  const resultField = config.resultField || 'alur_score';

  const updateConfig = (patch: Record<string, unknown>) => updateNode(id, { ...config, ...patch });
  const updateModel = (patch: Partial<ScoreModelSpec>) => updateConfig({ scoreModel: { ...spec, ...patch } });
  const updateCriterion = (index: number, patch: Partial<ScoreCriterion>) =>
    updateModel({ criteria: spec.criteria.map((item, position) => position === index ? { ...item, ...patch } : item) });

  const incomingEdge = edges.find((e) => e.target === id);
  const upstreamSchema = incomingEdge?.source ? nodeSchemas[incomingEdge.source] : null;
  const columnNames: string[] = useMemo(
    () => (upstreamSchema || [])
      .map((col: any) => col.name || col.column_name)
      .filter((name: unknown): name is string =>
        typeof name === 'string' && !EXCLUDED_COLUMNS.has(name.toLowerCase()) && !name.toLowerCase().startsWith('__alur_')),
    [upstreamSchema],
  );

  const shares = normalisedWeights(spec);
  const errors = scoreModelErrors(spec);

  const addCriterion = () => {
    const used = new Set(spec.criteria.map((item) => item.field));
    const next = columnNames.find((name) => !used.has(name)) || '';
    updateModel({ criteria: [...spec.criteria, { field: next, weight: 1, direction: 'higher', normalisation: 'min-max' }] });
  };

  return (
    <FlowNodeShell
      id={id}
      selected={selected}
      tone="purple"
      icon={SlidersHorizontal}
      label="Score"
      title={spec.criteria.length ? `${spec.criteria.length} criteria → ${resultField}` : 'Composite score'}
      helperContent={
        <div>
          <div className="font-semibold text-slate-800">Composite score</div>
          <div>Combines several columns into one weighted score, and ranks by it.</div>
          <div className="mt-2 text-[11px] text-slate-500">
            Each column is normalised across the whole result before weighting, so columns on different
            scales can be compared. Weights are shares of their total, so they need not sum to 1.
            Emits <code>{resultField}</code>, <code>{resultField}_rank</code>, and one contribution column per criterion.
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={cn(fieldLabelClass, 'mb-1')}>Score column</label>
          <input
            type="text"
            className={inputClass}
            value={resultField}
            onChange={(e) => updateConfig({ resultField: e.target.value })}
          />
        </div>
        <div>
          <label className={cn(fieldLabelClass, 'mb-1')}>Missing values</label>
          <select
            className={selectClass}
            value={spec.missingValueTreatment}
            onChange={(e) => updateModel({ missingValueTreatment: e.target.value as ScoreModelSpec['missingValueTreatment'] })}
          >
            <option value="zero">Count as zero</option>
            <option value="mean">Use the column mean</option>
            <option value="exclude">Leave the row unscored</option>
          </select>
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className={fieldLabelClass}>Criteria</label>
          <button type="button" onClick={addCriterion} className="pressable rounded px-1 text-[10px] font-bold text-purple-700 hover:bg-purple-50">
            + Add
          </button>
        </div>

        <div className="space-y-2">
          {spec.criteria.map((criterion, index) => (
            <div key={index} className="rounded-md border border-slate-200 bg-slate-50/60 p-1.5">
              <div className="flex items-center gap-1">
                {columnNames.length ? (
                  <select
                    className={cn(selectClass, 'flex-1')}
                    value={criterion.field}
                    onChange={(e) => updateCriterion(index, { field: e.target.value })}
                    aria-label={`Criterion ${index + 1} column`}
                  >
                    <option value="">Column…</option>
                    {columnNames.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                ) : (
                  <input
                    type="text"
                    className={cn(inputClass, 'flex-1')}
                    value={criterion.field}
                    onChange={(e) => updateCriterion(index, { field: e.target.value })}
                    placeholder="column"
                    aria-label={`Criterion ${index + 1} column`}
                  />
                )}
                <button
                  type="button"
                  onClick={() => updateModel({ criteria: spec.criteria.filter((_, position) => position !== index) })}
                  className="pressable rounded p-1 text-slate-400 hover:bg-white hover:text-rose-600"
                  aria-label={`Remove criterion ${index + 1}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>

              <div className="mt-1.5 flex items-center gap-1.5">
                <input
                  type="range"
                  min={0}
                  max={5}
                  step={0.1}
                  value={criterion.weight}
                  onChange={(e) => updateCriterion(index, { weight: Number(e.target.value) })}
                  className="h-1 flex-1 accent-purple-600"
                  aria-label={`Criterion ${index + 1} weight`}
                />
                <span className="w-9 shrink-0 text-right text-[10px] font-bold tabular-nums text-purple-700">
                  {Math.round((shares.get(criterion.field) || 0) * 100)}%
                </span>
              </div>

              <div className="mt-1 grid grid-cols-2 gap-1">
                <select
                  className={cn(selectClass, 'text-[10px]')}
                  value={criterion.direction}
                  onChange={(e) => updateCriterion(index, { direction: e.target.value as ScoreCriterion['direction'] })}
                  aria-label={`Criterion ${index + 1} direction`}
                >
                  <option value="higher">Higher is better</option>
                  <option value="lower">Lower is better</option>
                </select>
                <select
                  className={cn(selectClass, 'text-[10px]')}
                  value={criterion.normalisation}
                  onChange={(e) => updateCriterion(index, { normalisation: e.target.value as ScoreCriterion['normalisation'] })}
                  aria-label={`Criterion ${index + 1} normalisation`}
                >
                  <option value="min-max">Min–max</option>
                  <option value="z-score">Z-score</option>
                  <option value="rank">Percentile rank</option>
                </select>
              </div>
            </div>
          ))}
        </div>

        {!spec.criteria.length && (
          <p className="text-[10px] leading-4 text-slate-500">Add the columns that should decide the ranking.</p>
        )}
      </div>

      <label className="flex items-center gap-1.5 text-[10px] text-slate-600">
        <input
          type="checkbox"
          checked={config.includeContributions !== false}
          onChange={(e) => updateConfig({ includeContributions: e.target.checked })}
        />
        Keep a column per criterion showing what it contributed
      </label>

      {errors.length > 0 && <p className="text-[10px] leading-4 text-amber-700">{errors[0]}</p>}

      <Handle type="target" position={Position.Left} className={nodeHandleClass('purple')} />
      <Handle type="source" position={Position.Right} className={nodeHandleClass('purple')} />
    </FlowNodeShell>
  );
};
