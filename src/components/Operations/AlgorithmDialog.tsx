import { useMemo, useState } from 'react';
import { Crosshair, Loader2, MousePointerClick, Play, Plus, Trash2, X } from 'lucide-react';
import { useStore } from '../../store/useStore';
import type {
  OperationInputBinding,
  OperationManifest,
  OperationParameter,
} from '../../types/operations';
import { optionLabel, optionValue } from '../../types/operations';
import { operationBindingErrors } from '../../services/operationRegistry';
import { runOperation, type OperationRunReport } from '../../services/operationRunner';
import { operationsForProvider, summariseOperation } from '../../utils/operationRecords';

/**
 * One algorithm, configured and run.
 *
 * A dialog rather than a strip in the rail, because the form is generated and
 * its size is not ours to choose: a calculation with two inputs, five roles each
 * and seven settings is a legitimate calculation, and the panel is 280px wide.
 * The toolbox stays visible behind it, which is the arrangement anyone who has
 * used a processing toolbox already expects.
 *
 * Nothing in this file names a calculation. Every label, field and control is
 * read from whatever the chosen algorithm declared.
 */

const parameterInput = (
  parameter: OperationParameter,
  value: unknown,
  columns: string[],
  onChange: (next: unknown) => void,
) => {
  const shared = 'w-full rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-700 focus:border-slate-400 focus:outline-none';
  const current = value ?? parameter.defaultValue ?? '';

  if (parameter.type === 'choice') {
    return (
      <select className={shared} value={String(current)} onChange={(event) => onChange(event.target.value)}>
        <option value="">Choose…</option>
        {(parameter.options || []).map((option) => (
          <option key={optionValue(option)} value={optionValue(option)}>{optionLabel(option)}</option>
        ))}
      </select>
    );
  }
  if (parameter.type === 'field') {
    return (
      <select className={shared} value={String(current)} onChange={(event) => onChange(event.target.value)}>
        <option value="">Choose a column…</option>
        {columns.map((column) => <option key={column} value={column}>{column}</option>)}
      </select>
    );
  }
  return (
    <input
      type="number"
      className={shared}
      value={String(current)}
      onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
    />
  );
};

const Block = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
  <section className="mb-4">
    <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{title}</h3>
    {hint && <p className="mb-1.5 mt-0.5 text-[11px] leading-relaxed text-slate-500">{hint}</p>}
    <div className={hint ? undefined : 'mt-1.5'}>{children}</div>
  </section>
);

export const AlgorithmDialog = ({
  manifest,
  entryUrl,
  onClose,
}: {
  manifest: OperationManifest;
  /** Empty for a plugin compiled into the app, which needs no fetching. */
  entryUrl: string;
  onClose: () => void;
}) => {
  const datasets = useStore((state) => state.datasetRegistry);
  const variants = useStore((state) => state.visualAnalytics.variants);
  const activeSessionId = useStore((state) => state.visualAnalytics.activeSessionId);
  const interactions = useStore((state) => state.visualAnalytics.datasets);
  const placement = useStore((state) => state.ui.placement);
  const startPlacement = useStore((state) => state.startPlacement);
  const cancelPlacement = useStore((state) => state.cancelPlacement);
  const recordRowChange = useStore((state) => state.recordRowChange);
  const savedSetups = useStore((state) => state.visualAnalytics.calculations);
  const saveCalculationSetup = useStore((state) => state.saveCalculationSetup);
  const removeVariantOperation = useStore((state) => state.removeVariantOperation);
  const addToast = useStore((state) => state.addToast);

  /**
   * What this calculation was configured with last time, if anything.
   *
   * Read once, when the dialog opens. Binding every role by hand on every visit
   * was the single most tedious part of using a calculation, and worse, it meant
   * a saved project could not repeat one — the configuration lived here and was
   * gone when the dialog closed.
   */
  const saved = (savedSetups || []).find(
    (setup) => setup.calculationId === manifest.id
      && (!activeSessionId || !setup.sessionId || setup.sessionId === activeSessionId),
  );

  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<OperationRunReport | null>(null);
  const [bindings, setBindings] = useState<OperationInputBinding[]>(() =>
    manifest.inputs.map((input) =>
      saved?.inputs.find((binding) => binding.inputId === input.id)
        ?? { inputId: input.id, sources: [{ datasetId: '', fields: {} }] },
    ),
  );
  const [parameters, setParameters] = useState<Record<string, unknown>>(() => ({
    ...Object.fromEntries(manifest.parameters.map((parameter) => [parameter.id, parameter.defaultValue])),
    ...(saved?.parameters ?? {}),
  }));
  const [variantId, setVariantId] = useState('');
  const [changeValues, setChangeValues] = useState<Record<string, Record<string, unknown>>>({});

  const datasetList = useMemo(() => Object.values(datasets), [datasets]);
  const scoped = useMemo(
    () => (activeSessionId ? variants.filter((variant) => variant.sessionId === activeSessionId) : variants),
    [variants, activeSessionId],
  );
  const variant = scoped.find((candidate) => candidate.id === variantId) || scoped[0];
  const records = useMemo(
    () => (variant ? operationsForProvider(variant.operations, manifest.id) : []),
    [variant, manifest.id],
  );
  const bindingErrors = useMemo(
    () => operationBindingErrors(manifest, bindings, datasets),
    [manifest, bindings, datasets],
  );

  const bindingFor = (inputId: string) => bindings.find((binding) => binding.inputId === inputId);

  const patchSource = (inputId: string, index: number, patch: Partial<OperationInputBinding['sources'][number]>) =>
    setBindings((current) => current.map((binding) => (binding.inputId === inputId
      ? { ...binding, sources: binding.sources.map((source, at) => (at === index ? { ...source, ...patch } : source)) }
      : binding)));

  const addSource = (inputId: string) =>
    setBindings((current) => current.map((binding) => (binding.inputId === inputId
      ? { ...binding, sources: [...binding.sources, { datasetId: '', fields: {} }] }
      : binding)));

  const removeSource = (inputId: string, index: number) =>
    setBindings((current) => current.map((binding) => (binding.inputId === inputId
      ? { ...binding, sources: binding.sources.filter((_, at) => at !== index) }
      : binding)));

  const addChange = (changeId: string) => {
    if (!variant) return;
    const spec = manifest.accepts.find((accepted) => accepted.id === changeId)!;
    const values = {
      ...Object.fromEntries(spec.parameters.map((parameter) => [parameter.id, parameter.defaultValue])),
      ...(changeValues[changeId] || {}),
    };

    if (spec.referent === 'rows') {
      const bound = (bindingFor(spec.inputId)?.sources ?? []).filter((source) => source.datasetId);
      if (!bound.length) {
        addToast({ type: 'warning', message: `Bind a dataset to ${spec.inputId} before recording a change.` });
        return;
      }

      // One record per bound dataset that has a selection. A change record names
      // a single dataset, and a selection spanning two of them is two
      // assertions, not one — collapsing them would lose which rows of which.
      const selections = bound
        .map((source) => ({ datasetId: source.datasetId, rowIds: interactions[source.datasetId]?.selectedFeatureIds || [] }))
        .filter((selection) => selection.rowIds.length);

      if (!selections.length) {
        addToast({ type: 'warning', message: 'Select the units this change applies to first.' });
        return;
      }
      for (const selection of selections) {
        recordRowChange({ variantId: variant.id, providerId: manifest.id, changeId, datasetId: selection.datasetId, rowIds: selection.rowIds, values });
      }
      const total = selections.reduce((sum, selection) => sum + selection.rowIds.length, 0);
      addToast({ type: 'success', message: `Recorded ${spec.label} on ${total} units.` });
      return;
    }

    startPlacement({ providerId: manifest.id, changeId, label: spec.label, values, variantId: variant.id });
  };

  const run = async () => {
    if (!variant) return;
    setRunning(true);
    setReport(null);
    try {
      const outcome = await runOperation({
        providerUrl: entryUrl,
        manifest,
        bindings,
        datasets,
        parameters,
        operations: variant.operations,
      }, { runLabel: `${manifest.label} · ${variant.name}` });
      setReport(outcome);
      // Recorded on success rather than on open: what is worth repeating is a
      // run that produced something, not a form somebody half filled in.
      saveCalculationSetup({
        pluginUrl: entryUrl,
        calculationId: manifest.id,
        calculationVersion: manifest.version,
        label: manifest.label,
        inputs: bindings,
        parameters,
        lastRunAt: Date.now(),
      });
      addToast({
        type: outcome.warnings.length ? 'warning' : 'success',
        message: `${manifest.label} produced ${outcome.created.length} dataset${outcome.created.length === 1 ? '' : 's'}.`,
      });
    } catch (error) {
      addToast({ type: 'error', message: `${manifest.label} failed: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-6" role="dialog" aria-modal="true" aria-label={manifest.label}>
      <div className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-bold text-slate-900">{manifest.label}</h2>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{manifest.description}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="pressable shrink-0 rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-2 gap-6 overflow-y-auto px-5 py-4">
          <div>
            <Block title="Data">
              <div className="space-y-2.5">
                {manifest.inputs.map((input) => {
                  const sources = bindingFor(input.id)?.sources ?? [];
                  return (
                    <div key={input.id}>
                      <p className="text-[11px] font-bold text-slate-600">{input.label}</p>
                      {input.description && <p className="mb-1 text-[11px] leading-relaxed text-slate-500">{input.description}</p>}

                      {sources.map((source, index) => {
                        const bound = datasets[source.datasetId || ''];
                        return (
                          <div key={index} className={index ? 'mt-1.5 border-t border-slate-100 pt-1.5' : undefined}>
                            <div className="flex gap-1">
                              <select
                                value={source.datasetId}
                                onChange={(event) => patchSource(input.id, index, { datasetId: event.target.value, fields: {} })}
                                className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-700 focus:border-slate-400 focus:outline-none"
                                aria-label={`${input.label} dataset ${index + 1}`}
                              >
                                <option value="">Choose a dataset…</option>
                                {datasetList.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}
                              </select>
                              {sources.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => removeSource(input.id, index)}
                                  className="pressable rounded-md border border-slate-200 px-1.5 text-slate-500 hover:text-rose-500"
                                  aria-label={`Remove dataset ${index + 1} from ${input.label}`}
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                            {bound && input.fields.map((role) => (
                              <div key={role.id} className="mt-1 flex items-center gap-1.5 pl-2">
                                <span className="w-24 shrink-0 truncate text-[11px] text-slate-500" title={role.description}>
                                  {role.label}{role.required && <span className="text-rose-400">*</span>}
                                </span>
                                <select
                                  value={source.fields[role.id] || ''}
                                  onChange={(event) => patchSource(input.id, index, { fields: { ...source.fields, [role.id]: event.target.value } })}
                                  className="min-w-0 flex-1 rounded-md border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-700 focus:border-slate-400 focus:outline-none"
                                >
                                  <option value="">—</option>
                                  {bound.fields.map((field) => <option key={field.name} value={field.name}>{field.name}</option>)}
                                </select>
                              </div>
                            ))}
                          </div>
                        );
                      })}

                      {input.multiple && (
                        <button
                          type="button"
                          onClick={() => addSource(input.id)}
                          className="pressable mt-1 flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:text-blue-700"
                        >
                          <Plus className="h-3 w-3" /> Add another dataset
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {bindingErrors.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {bindingErrors.map((error) => <li key={error} className="text-[11px] text-amber-600">{error}</li>)}
                </ul>
              )}
            </Block>

            {manifest.parameters.length > 0 && (
              <Block
                title="Settings"
                hint="Assumptions with no location. Recorded apart from changes, because a value that applies everywhere is not a claim about a place."
              >
                <div className="space-y-1.5">
                  {manifest.parameters.map((parameter) => (
                    <div key={parameter.id}>
                      <div className="flex items-center gap-1.5">
                        <span className="w-32 shrink-0 truncate text-[11px] text-slate-500" title={parameter.label}>{parameter.label}</span>
                        <div className="min-w-0 flex-1">
                          {parameterInput(parameter, parameters[parameter.id], [], (next) =>
                            setParameters((current) => ({ ...current, [parameter.id]: next })))}
                        </div>
                      </div>
                      {parameter.description && <p className="ml-[8.5rem] mt-0.5 text-[11px] text-slate-500">{parameter.description}</p>}
                    </div>
                  ))}
                </div>
              </Block>
            )}
          </div>

          <div>
            <Block title="Scenario">
              {scoped.length ? (
                <select
                  value={variant?.id || ''}
                  onChange={(event) => setVariantId(event.target.value)}
                  className="w-full rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-700 focus:border-slate-400 focus:outline-none"
                  aria-label="Scenario"
                >
                  {scoped.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
                </select>
              ) : (
                <p className="text-[11px] text-amber-600">
                  Create a scenario first — a change has to belong to one, or there is no record of what was tried.
                </p>
              )}
            </Block>

            {manifest.accepts.length > 0 && (
              <Block title="Changes">
                {placement && (
                  <div className="mb-2 flex items-center justify-between gap-2 rounded-md bg-orange-50 px-2 py-1.5">
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-orange-800">
                      <Crosshair className="h-3 w-3" /> Click the map to place “{placement.label}”
                    </span>
                    <button type="button" onClick={cancelPlacement} aria-label="Cancel placement" className="pressable text-orange-700 hover:text-orange-900">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}

                <div className="space-y-1.5">
                  {manifest.accepts.map((spec) => (
                    <div key={spec.id} className="rounded-md border border-slate-200 p-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[11px] font-semibold text-slate-700" title={spec.description}>{spec.label}</span>
                        <button
                          type="button"
                          onClick={() => addChange(spec.id)}
                          disabled={!variant}
                          title={spec.referent === 'rows' ? 'Applies to the current selection' : 'Then click the map'}
                          className="pressable flex shrink-0 items-center gap-1 rounded-md border border-slate-200 px-1.5 py-0.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                        >
                          {spec.referent === 'rows' ? <MousePointerClick className="h-2.5 w-2.5" /> : <Crosshair className="h-2.5 w-2.5" />}
                          Record
                        </button>
                      </div>
                      {spec.parameters.length > 0 && (
                        <div className="mt-1 space-y-1">
                          {spec.parameters.map((parameter) => (
                            <div key={parameter.id} className="flex items-center gap-1.5">
                              <span className="w-20 shrink-0 truncate text-[11px] text-slate-500">{parameter.label}</span>
                              <div className="min-w-0 flex-1">
                                {parameterInput(
                                  parameter,
                                  changeValues[spec.id]?.[parameter.id],
                                  [],
                                  (next) => setChangeValues((current) => ({
                                    ...current,
                                    [spec.id]: { ...(current[spec.id] || {}), [parameter.id]: next },
                                  })),
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {records.length > 0 && (
                  <ul className="mt-2 space-y-0.5">
                    {records.map((record) => (
                      <li key={record.id} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-1.5 py-1">
                        <span className="truncate text-[11px] text-slate-600">{summariseOperation(record, manifest)}</span>
                        <button
                          type="button"
                          onClick={() => variant && removeVariantOperation(variant.id, record.id)}
                          aria-label="Remove this change"
                          className="pressable shrink-0 text-slate-500 hover:text-rose-500"
                        >
                          <Trash2 className="h-2.5 w-2.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Block>
            )}

            {report && (
              <Block title="Result">
                <ul className="space-y-0.5">
                  {report.created.map((created) => (
                    <li key={created.outputId} className="truncate text-[11px] text-slate-600">{created.label}</li>
                  ))}
                  {report.warnings.map((warning) => (
                    <li key={warning} className="text-[11px] leading-relaxed text-amber-600">{warning}</li>
                  ))}
                </ul>
              </Block>
            )}
          </div>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3">
          <span className="text-[11px] text-slate-500">{manifest.id} · {manifest.version}</span>
          <div className="flex items-center gap-2">
            {/* Dismissal is the header's X alone. A second control with the same
                name reads to a screen reader as two different ways out, and to
                the eye it competes with Run for the corner the primary action
                belongs in. */}
            <button
              type="button"
              onClick={() => void run()}
              disabled={running || !variant || bindingErrors.length > 0}
              className="pressable flex items-center gap-1.5 rounded-md bg-slate-800 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-slate-700 disabled:opacity-40"
            >
              {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Run
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};
