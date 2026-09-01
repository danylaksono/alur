import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Plus, SlidersHorizontal, X } from 'lucide-react';
import { useStore, type WorkflowNode } from '../../store/useStore';
import type { ScoreCriterion, ScoreModelSpec, VariantOperation } from '../../types/visualAnalytics';
import { AddToScenario, scenarioBaseName } from '../Scenarios/AddToScenario';
import {
  equalWeightedScoreModel,
  normalisedWeights,
  scoreModelErrors,
} from '../../utils/scoreModel';
import { queryScorePreview, queryScoreSensitivity, type ScorePreview, type ScoreSensitivity } from '../../services/scoreService';
import { compileVisualFiltersWhereClause } from '../../utils/visualFilterSql';
import { nextNodePosition } from '../../utils/nodePlacement';

const CRITERION_COLOURS = ['#7c3aed', '#0891b2', '#f97316', '#16a34a', '#db2777', '#ca8a04', '#2563eb', '#dc2626'];
const NUMERIC = /INT|DOUBLE|FLOAT|DECIMAL|NUMERIC|REAL|BIGINT|HUGEINT/i;
const EMPTY_MODEL: ScoreModelSpec = { criteria: [], missingValueTreatment: 'zero' };

const format = (value: number | null, digits = 3) =>
  value === null || !Number.isFinite(value) ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: digits });

/**
 * Interactive weighting.
 *
 * The point of this panel over the workflow node is immediacy: moving a weight
 * re-ranks the list underneath it, so the user sees what their priorities do
 * rather than declaring them and waiting for a pipeline run. The stacked bar on
 * each row is the criterion contributions, which sum exactly to the score — so
 * "why is this above that" is answerable by looking rather than by trusting.
 */
export const ScorePanel = () => {
  const datasets = useStore((state) => state.datasetRegistry);
  const selectedLayerId = useStore((state) => state.selectedLayerId);
  const visualAnalytics = useStore((state) => state.visualAnalytics);
  const addNode = useStore((state) => state.addNode);
  const onConnect = useStore((state) => state.onConnect);
  const addToast = useStore((state) => state.addToast);
  const mapLayers = useStore((state) => state.mapLayers);

  const datasetList = useMemo(() => Object.values(datasets), [datasets]);
  const [datasetId, setDatasetId] = useState('');
  const [spec, setSpec] = useState<ScoreModelSpec>(EMPTY_MODEL);
  const [preview, setPreview] = useState<ScorePreview | null>(null);
  const [sensitivity, setSensitivity] = useState<ScoreSensitivity | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [respectFilters, setRespectFilters] = useState(true);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const runToken = useRef(0);

  const dataset = datasets[datasetId] || datasets[selectedLayerId || ''] || datasetList[0];
  const numericFields = useMemo(
    () => (dataset?.fields || [])
      .filter((field) => NUMERIC.test(field.type) && !field.name.startsWith('__alur'))
      .map((field) => field.name),
    [dataset],
  );

  useEffect(() => {
    if (dataset && datasetId !== dataset.id) setDatasetId(dataset.id);
  }, [dataset, datasetId]);

  const errors = scoreModelErrors(spec);
  const shares = normalisedWeights(spec);
  const colourFor = (field: string) => CRITERION_COLOURS[spec.criteria.findIndex((item) => item.field === field) % CRITERION_COLOURS.length];

  const whereClause = useMemo(() => {
    if (!respectFilters || !dataset) return '';
    const filters = visualAnalytics.datasets[dataset.id]?.filters || [];
    return filters.length ? compileVisualFiltersWhereClause(filters) : '';
  }, [respectFilters, dataset, visualAnalytics.datasets]);

  // Re-rank as weights move. The token guards against an earlier, slower query
  // landing after a later one and showing a ranking the weights no longer imply.
  useEffect(() => {
    if (!dataset || errors.length) {
      setPreview(null);
      setSensitivity(null);
      return;
    }
    const token = ++runToken.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const [nextPreview, nextSensitivity] = await Promise.all([
          queryScorePreview({ dataset, spec, whereClause }),
          queryScoreSensitivity({ dataset, spec, whereClause }),
        ]);
        if (token !== runToken.current) return;
        setPreview(nextPreview);
        setSensitivity(nextSensitivity);
      } catch (caught: any) {
        if (token !== runToken.current) return;
        setError(caught?.message || 'Could not score this dataset.');
        setPreview(null);
        setSensitivity(null);
      } finally {
        if (token === runToken.current) setLoading(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [dataset, spec, whereClause, errors.length]);

  const updateCriterion = (index: number, patch: Partial<ScoreCriterion>) =>
    setSpec((current) => ({ ...current, criteria: current.criteria.map((item, position) => position === index ? { ...item, ...patch } : item) }));

  const addCriterion = () => {
    const used = new Set(spec.criteria.map((item) => item.field));
    const next = numericFields.find((name) => !used.has(name));
    if (!next) return;
    setSpec((current) => ({ ...current, criteria: [...current.criteria, { field: next, weight: 1, direction: 'higher', normalisation: 'min-max' }] }));
  };

  /**
   * Put this score on the canvas, scoped to a scenario.
   *
   * Returns the node id rather than toasting, because the caller owns the
   * account of what happened — the node is half of an "added to scenario X",
   * not an event in its own right.
   */
  const emitScoreNode = (variantId: string) => {
    if (!dataset || errors.length) return null;
    const nodeId = `score-${Date.now()}`;
    const node: WorkflowNode = {
      id: nodeId,
      type: 'score',
      position: nextNodePosition(useStore.getState().nodes),
      data: {
        label: 'Composite score',
        type: 'score',
        config: { scoreModel: structuredClone(spec), resultField: 'alur_score', includeContributions: true, variantId },
      },
    } as WorkflowNode;
    addNode(node);
    const sourceNodeId = dataset.source.kind === 'workflow-node'
      ? dataset.source.nodeId
      : mapLayers.find((layer) => layer.id === dataset.id)?.sourceNodeId;
    if (sourceNodeId) onConnect({ source: sourceNodeId, target: nodeId, sourceHandle: null, targetHandle: null });
    // A node with no upstream cannot run, and that is worth saying now rather
    // than at execution time.
    if (!sourceNodeId) {
      addToast({ type: 'warning', message: 'The score node could not find its source — connect it by hand.' });
    }
    return nodeId;
  };

  const scoreOperation = (): VariantOperation => ({
    id: `operation-${Date.now()}`,
    type: 'weighted-score',
    parameters: { scoreModel: structuredClone(spec), resultField: 'alur_score' },
    assumptions: [
      `Weighted across ${spec.criteria.length} ${spec.criteria.length === 1 ? 'criterion' : 'criteria'}.`,
      spec.missingValueTreatment === 'zero'
        ? 'Missing numeric values contribute zero.'
        : 'Missing numeric values are substituted with the column mean.',
    ],
  });

  if (!datasetList.length) {
    return <div className="p-4 text-xs leading-5 text-slate-500">Load a dataset to build a score.</div>;
  }

  const maxScore = Math.max(...(preview?.rows.map((row) => row.score ?? 0) || [0]), 0.0001);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="shrink-0 border-b bg-slate-50 px-4 py-3">
        <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <SlidersHorizontal className="h-3.5 w-3.5" /> Composite score
        </h3>
        <p className="mt-1 text-[10px] leading-4 text-slate-500">
          Combine columns into one weighted score. Move a weight to see the ranking change.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <select
          value={dataset?.id || ''}
          onChange={(event) => { setDatasetId(event.target.value); setSpec(EMPTY_MODEL); }}
          className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-[11px]"
          aria-label="Dataset to score"
        >
          {datasetList.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>

        {!numericFields.length && (
          <p className="mt-3 rounded-md bg-amber-50 px-2 py-1.5 text-[10px] leading-4 text-amber-800">
            This dataset has no numeric columns to score on.
          </p>
        )}

        {!spec.criteria.length && numericFields.length > 0 && (
          <button
            type="button"
            onClick={() => setSpec(equalWeightedScoreModel(numericFields.slice(0, 3)))}
            className="pressable mt-3 w-full rounded-lg bg-purple-600 px-3 py-2 text-[10px] font-bold text-white hover:bg-purple-700"
          >
            Start with {Math.min(3, numericFields.length)} equally weighted criteria
          </button>
        )}

        {spec.criteria.length > 0 && (
          <section className="mt-3 space-y-2">
            {spec.criteria.map((criterion, index) => (
              <div key={index} className="rounded-lg border border-slate-200 p-2">
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colourFor(criterion.field) }} />
                  <select
                    value={criterion.field}
                    onChange={(event) => updateCriterion(index, { field: event.target.value })}
                    className="min-w-0 flex-1 truncate rounded border border-slate-200 px-1.5 py-1 text-[10px]"
                    aria-label={`Criterion ${index + 1} column`}
                  >
                    {numericFields.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                  <button
                    type="button"
                    onClick={() => setSpec((current) => ({ ...current, criteria: current.criteria.filter((_, position) => position !== index) }))}
                    className="pressable rounded p-1 text-slate-400 hover:bg-slate-50 hover:text-rose-600"
                    aria-label={`Remove ${criterion.field}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>

                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={5}
                    step={0.1}
                    value={criterion.weight}
                    onChange={(event) => updateCriterion(index, { weight: Number(event.target.value) })}
                    className="h-1 flex-1"
                    style={{ accentColor: colourFor(criterion.field) }}
                    aria-label={`${criterion.field} weight`}
                  />
                  <span className="w-9 shrink-0 text-right text-[10px] font-bold tabular-nums text-slate-700">
                    {Math.round((shares.get(criterion.field) || 0) * 100)}%
                  </span>
                </div>

                <div className="mt-1 grid grid-cols-2 gap-1">
                  <select
                    value={criterion.direction}
                    onChange={(event) => updateCriterion(index, { direction: event.target.value as ScoreCriterion['direction'] })}
                    className="rounded border border-slate-200 px-1 py-0.5 text-[9px]"
                    aria-label={`${criterion.field} direction`}
                  >
                    <option value="higher">Higher is better</option>
                    <option value="lower">Lower is better</option>
                  </select>
                  <select
                    value={criterion.normalisation}
                    onChange={(event) => updateCriterion(index, { normalisation: event.target.value as ScoreCriterion['normalisation'] })}
                    className="rounded border border-slate-200 px-1 py-0.5 text-[9px]"
                    aria-label={`${criterion.field} normalisation`}
                  >
                    <option value="min-max">Min–max</option>
                    <option value="z-score">Z-score</option>
                    <option value="rank">Percentile</option>
                  </select>
                </div>
              </div>
            ))}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={addCriterion}
                disabled={spec.criteria.length >= numericFields.length}
                className="pressable flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-[10px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                <Plus className="h-3 w-3" /> Criterion
              </button>
              <select
                value={spec.missingValueTreatment}
                onChange={(event) => setSpec((current) => ({ ...current, missingValueTreatment: event.target.value as ScoreModelSpec['missingValueTreatment'] }))}
                className="min-w-0 flex-1 rounded-lg border border-slate-200 px-1.5 py-1.5 text-[9px]"
                aria-label="Missing value treatment"
              >
                <option value="zero">Missing counts as zero</option>
                <option value="mean">Missing uses the mean</option>
                <option value="exclude">Missing leaves the row unscored</option>
              </select>
            </div>

            <label className="flex items-center gap-1.5 text-[10px] text-slate-600">
              <input type="checkbox" checked={respectFilters} onChange={(event) => setRespectFilters(event.target.checked)} />
              Score only the rows passing active filters
            </label>
          </section>
        )}

        {errors.length > 0 && spec.criteria.length > 0 && (
          <p className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-[10px] leading-4 text-amber-800">{errors[0]}</p>
        )}
        {error && <p className="mt-2 rounded-md bg-rose-50 px-2 py-1.5 text-[10px] leading-4 text-rose-700">{error}</p>}

        {preview && (
          <section className="mt-4 border-t border-slate-100 pt-3">
            <div className="flex items-baseline justify-between gap-2">
              <h4 className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Ranked</h4>
              <span className="flex items-center gap-1 text-[9px] text-slate-500">
                {loading && <Loader2 className="h-3 w-3 animate-spin" />}
                {preview.scoredRows.toLocaleString()} of {preview.totalRows.toLocaleString()} scored
                {preview.labelField && <span className="text-slate-400">· by {preview.labelField}</span>}
              </span>
            </div>

            {preview.scoredRows < preview.totalRows && (
              <p className="mt-1 text-[9px] leading-4 text-amber-700">
                {(preview.totalRows - preview.scoredRows).toLocaleString()} rows are missing a value on at least one criterion and were left unscored.
              </p>
            )}

            <ol className="mt-2 space-y-1">
              {preview.rows.map((row, index) => {
                // Neither the label nor the rank is unique — labels repeat and
                // tied rows share a rank — so position is the stable key.
                const rowKey = `${index}`;
                const expanded = expandedRow === rowKey;
                return (
                  <li key={rowKey}>
                    <button
                      type="button"
                      onClick={() => setExpandedRow(expanded ? null : rowKey)}
                      className="pressable w-full rounded-md px-1.5 py-1 text-left hover:bg-slate-50"
                      aria-expanded={expanded}
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="w-5 shrink-0 text-right text-[10px] font-bold tabular-nums text-slate-400">{row.rank}</span>
                        <span className="min-w-0 flex-1 truncate text-[10px] text-slate-700">{row.key || '—'}</span>
                        <span className="shrink-0 text-[10px] font-bold tabular-nums text-slate-800">{format(row.score)}</span>
                      </div>
                      {/* Contributions sum to the score, so the bar is exact. */}
                      <div className="mt-1 ml-7 flex h-1.5 overflow-hidden rounded-full bg-slate-100">
                        {spec.criteria.map((criterion) => {
                          const value = row.contributions[criterion.field] ?? 0;
                          return (
                            <span
                              key={criterion.field}
                              title={`${criterion.field}: ${format(value)}`}
                              style={{ width: `${Math.max(0, (value / maxScore) * 100)}%`, backgroundColor: colourFor(criterion.field) }}
                            />
                          );
                        })}
                      </div>
                    </button>

                    {expanded && (
                      <dl className="ml-7 mt-1 space-y-0.5 rounded-md bg-slate-50 p-2">
                        {spec.criteria.map((criterion) => (
                          <div key={criterion.field} className="flex items-baseline justify-between gap-2 text-[9px]">
                            <dt className="flex min-w-0 items-center gap-1 truncate text-slate-600">
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: colourFor(criterion.field) }} />
                              {criterion.field}
                            </dt>
                            <dd className="shrink-0 tabular-nums text-slate-700">{format(row.contributions[criterion.field])}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {sensitivity && sensitivity.criteria.length > 0 && (
          <section className="mt-4 border-t border-slate-100 pt-3">
            <h4 className="text-[10px] font-bold uppercase tracking-wide text-slate-500">How much each weight matters</h4>
            <p className="mt-1 text-[9px] leading-4 text-slate-500">
              Raising one weight by {Math.round(sensitivity.delta * 100)}% and seeing how far the ranking moves.
              A criterion that barely disturbs the top {sensitivity.topN} is not worth arguing over.
            </p>
            <div className="mt-2 space-y-1.5">
              {[...sensitivity.criteria].sort((a, b) => b.topNChanged - a.topNChanged).map((item) => (
                <div key={item.field} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1 truncate text-[10px] text-slate-700">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: colourFor(item.field) }} />
                      {item.field}
                    </div>
                    <div className="mt-0.5 h-1 rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, (item.topNChanged / Math.max(1, sensitivity.topN)) * 100)}%`,
                          backgroundColor: colourFor(item.field),
                        }}
                      />
                    </div>
                  </div>
                  <span className="shrink-0 text-[9px] tabular-nums text-slate-600">
                    {item.topNChanged} of top {sensitivity.topN}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {sensitivity && !sensitivity.criteria.length && sensitivity.warnings.length > 0 && spec.criteria.length > 0 && (
          <p className="mt-3 text-[9px] leading-4 text-slate-500">{sensitivity.warnings[0]}</p>
        )}
      </div>

      <div className="shrink-0 border-t bg-slate-50 p-3">
        <AddToScenario
          disabled={Boolean(errors.length) || !dataset}
          baselineDatasetId={dataset?.id || ''}
          defaultName={dataset ? `${scenarioBaseName(dataset.name)} prioritisation` : 'Prioritisation'}
          buildOperation={scoreOperation}
          emitNode={emitScoreNode}
          hint="The panel previews; the scenario keeps the result."
        />
      </div>
    </div>
  );
};
