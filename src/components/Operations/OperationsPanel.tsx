import { useMemo, useState } from 'react';
import { Crosshair, Download, Loader2, MousePointerClick, Play, Plug, Trash2, X } from 'lucide-react';
import { useStore } from '../../store/useStore';
import type { OperationInputBinding, OperationManifest } from '../../types/operations';
import type { FragmentParameter } from '../../utils/workflowFragments';
import { operationHost } from '../../services/operationHost';
import { operationBindingErrors } from '../../services/operationRegistry';
import { runOperation, type OperationRunReport } from '../../services/operationRunner';
import { operationsForProvider, summariseOperation } from '../../utils/operationRecords';

/**
 * Where a calculation from outside ALUR is loaded, pointed at data, and run.
 *
 * A panel rather than a workflow node, and the reasoning is worth recording. The
 * DAG is a batch compile: it builds one SQL statement and runs it. A provider is
 * a live session — expensive to load, cheap to re-run — and the whole reason its
 * contract has a lifecycle is that an analyst places a change and looks at what
 * happened, repeatedly. Compiling that into the graph would rebuild the engine on
 * every placement and throw the advantage away. Outputs still become ordinary
 * datasets, so the DAG, charts, comparison and map styling all reach them; the
 * graph consumes the result rather than containing the calculation.
 *
 * Nothing in this file names a calculation. Every label, field and control below
 * is read from whatever the loaded provider declared.
 */

const parameterInput = (
  parameter: FragmentParameter,
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
        {(parameter.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
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

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="border-b border-slate-100 px-3 py-3">
    <h3 className="mb-2 text-[9px] font-bold uppercase tracking-wider text-slate-400">{title}</h3>
    {children}
  </section>
);

export const OperationsPanel = () => {
  const datasets = useStore((state) => state.datasetRegistry);
  const variants = useStore((state) => state.visualAnalytics.variants);
  const activeSessionId = useStore((state) => state.visualAnalytics.activeSessionId);
  const interactions = useStore((state) => state.visualAnalytics.datasets);
  const placement = useStore((state) => state.ui.placement);
  const startPlacement = useStore((state) => state.startPlacement);
  const cancelPlacement = useStore((state) => state.cancelPlacement);
  const recordRowChange = useStore((state) => state.recordRowChange);
  const removeVariantOperation = useStore((state) => state.removeVariantOperation);
  const addToast = useStore((state) => state.addToast);

  const [url, setUrl] = useState('');
  const [manifest, setManifest] = useState<OperationManifest | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<OperationRunReport | null>(null);
  const [bindings, setBindings] = useState<OperationInputBinding[]>([]);
  const [parameters, setParameters] = useState<Record<string, unknown>>({});
  const [variantId, setVariantId] = useState('');
  const [changeValues, setChangeValues] = useState<Record<string, Record<string, unknown>>>({});

  const datasetList = useMemo(() => Object.values(datasets), [datasets]);
  const scoped = useMemo(
    () => (activeSessionId ? variants.filter((variant) => variant.sessionId === activeSessionId) : variants),
    [variants, activeSessionId],
  );
  const variant = scoped.find((candidate) => candidate.id === variantId) || scoped[0];
  const records = useMemo(
    () => (variant && manifest ? operationsForProvider(variant.operations, manifest.id) : []),
    [variant, manifest],
  );
  const bindingErrors = useMemo(
    () => (manifest ? operationBindingErrors(manifest, bindings, datasets) : []),
    [manifest, bindings, datasets],
  );

  const load = async () => {
    if (!url.trim()) return;
    setLoading(true);
    try {
      const loaded = await operationHost.load(url.trim());
      setManifest(loaded);
      setBindings(loaded.inputs.map((input) => ({ inputId: input.id, datasetId: '', fields: {} })));
      setParameters(Object.fromEntries(loaded.parameters.map((parameter) => [parameter.id, parameter.defaultValue])));
      setReport(null);
      addToast({ type: 'success', message: `Loaded ${loaded.label} (${loaded.version}).` });
    } catch (error) {
      addToast({ type: 'error', message: `Could not load the calculation: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setLoading(false);
    }
  };

  const bindingFor = (inputId: string) => bindings.find((binding) => binding.inputId === inputId);
  const patchBinding = (inputId: string, patch: Partial<OperationInputBinding>) =>
    setBindings((current) => current.map((binding) => (binding.inputId === inputId ? { ...binding, ...patch } : binding)));

  const addChange = (changeId: string) => {
    if (!manifest || !variant) return;
    const spec = manifest.accepts.find((accepted) => accepted.id === changeId)!;
    const values = {
      ...Object.fromEntries(spec.parameters.map((parameter) => [parameter.id, parameter.defaultValue])),
      ...(changeValues[changeId] || {}),
    };

    if (spec.referent === 'rows') {
      const binding = bindingFor(spec.inputId);
      const selected = binding ? interactions[binding.datasetId]?.selectedFeatureIds || [] : [];
      if (!binding?.datasetId) {
        addToast({ type: 'warning', message: `Bind a dataset to ${spec.inputId} before recording a change.` });
        return;
      }
      if (!selected.length) {
        addToast({ type: 'warning', message: 'Select the units this change applies to first.' });
        return;
      }
      recordRowChange({ variantId: variant.id, providerId: manifest.id, changeId, datasetId: binding.datasetId, rowIds: selected, values });
      addToast({ type: 'success', message: `Recorded ${spec.label} on ${selected.length} units.` });
      return;
    }

    startPlacement({ providerId: manifest.id, changeId, label: spec.label, values, variantId: variant.id });
  };

  const run = async () => {
    if (!manifest || !variant) return;
    setRunning(true);
    setReport(null);
    try {
      const outcome = await runOperation({
        providerUrl: url.trim(),
        manifest,
        bindings,
        datasets,
        parameters,
        operations: variant.operations,
      }, { runLabel: `${manifest.label} · ${variant.name}` });
      setReport(outcome);
      addToast({
        type: outcome.warnings.length ? 'warning' : 'success',
        message: `${manifest.label} produced ${outcome.created.length} dataset${outcome.created.length === 1 ? '' : 's'}.`,
      });
    } catch (error) {
      addToast({ type: 'error', message: `${manifest?.label || 'The calculation'} failed: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <Section title="Calculation">
        <div className="flex gap-1">
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void load(); }}
            placeholder="https://…/index.js"
            className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-700 focus:border-slate-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || !url.trim()}
            className="flex items-center gap-1 rounded-md bg-slate-800 px-2 py-1 text-[10px] font-bold text-white hover:bg-slate-700 disabled:opacity-40"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} Load
          </button>
        </div>
        {manifest ? (
          <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
            <span className="font-bold text-slate-700">{manifest.label}</span>{' '}
            <span className="text-slate-400">{manifest.version}</span>
            <br />
            {manifest.description}
          </p>
        ) : (
          <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-relaxed text-slate-400">
            <Plug className="mt-0.5 h-3 w-3 shrink-0" />
            ALUR ships no calculations of its own. Point this at one and it will build its interface from what the calculation declares.
          </p>
        )}
      </Section>

      {manifest && (
        <>
          <Section title="Scenario">
            {scoped.length ? (
              <select
                value={variant?.id || ''}
                onChange={(event) => setVariantId(event.target.value)}
                className="w-full rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-700 focus:border-slate-400 focus:outline-none"
              >
                {scoped.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
              </select>
            ) : (
              <p className="text-[10px] text-amber-600">
                Create a scenario first — a change has to belong to one, or there is no record of what was tried.
              </p>
            )}
          </Section>

          <Section title="Data">
            <div className="space-y-2.5">
              {manifest.inputs.map((input) => {
                const binding = bindingFor(input.id);
                const bound = datasets[binding?.datasetId || ''];
                return (
                  <div key={input.id}>
                    <p className="text-[10px] font-bold text-slate-600">{input.label}</p>
                    {input.description && <p className="mb-1 text-[9px] leading-relaxed text-slate-400">{input.description}</p>}
                    <select
                      value={binding?.datasetId || ''}
                      onChange={(event) => patchBinding(input.id, { datasetId: event.target.value, fields: {} })}
                      className="w-full rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-700 focus:border-slate-400 focus:outline-none"
                    >
                      <option value="">Choose a dataset…</option>
                      {datasetList.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}
                    </select>
                    {bound && input.fields.map((role) => (
                      <div key={role.id} className="mt-1 flex items-center gap-1.5 pl-2">
                        <span className="w-20 shrink-0 truncate text-[9px] text-slate-500" title={role.description}>
                          {role.label}{role.required && <span className="text-rose-400">*</span>}
                        </span>
                        <select
                          value={binding?.fields[role.id] || ''}
                          onChange={(event) => patchBinding(input.id, { fields: { ...binding!.fields, [role.id]: event.target.value } })}
                          className="min-w-0 flex-1 rounded-md border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-700 focus:border-slate-400 focus:outline-none"
                        >
                          <option value="">—</option>
                          {bound.fields.map((field) => <option key={field.name} value={field.name}>{field.name}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
            {bindingErrors.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {bindingErrors.map((error) => <li key={error} className="text-[9px] text-amber-600">{error}</li>)}
              </ul>
            )}
          </Section>

          {manifest.parameters.length > 0 && (
            <Section title="Settings">
              <p className="mb-2 text-[9px] leading-relaxed text-slate-400">
                Assumptions with no location. Recorded apart from changes, because a value that applies everywhere is not a claim about a place.
              </p>
              <div className="space-y-1.5">
                {manifest.parameters.map((parameter) => (
                  <div key={parameter.id} className="flex items-center gap-1.5">
                    <span className="w-28 shrink-0 truncate text-[9px] text-slate-500" title={parameter.label}>{parameter.label}</span>
                    <div className="min-w-0 flex-1">
                      {parameterInput(parameter, parameters[parameter.id], [], (next) =>
                        setParameters((current) => ({ ...current, [parameter.id]: next })))}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          <Section title="Changes">
            {placement && (
              <div className="mb-2 flex items-center justify-between gap-2 rounded-md bg-orange-50 px-2 py-1.5">
                <span className="flex items-center gap-1.5 text-[10px] font-semibold text-orange-800">
                  <Crosshair className="h-3 w-3" /> Click the map to place “{placement.label}”
                </span>
                <button type="button" onClick={cancelPlacement} aria-label="Cancel placement" className="text-orange-700 hover:text-orange-900">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}

            <div className="mb-2 space-y-1.5">
              {manifest.accepts.map((spec) => (
                <div key={spec.id} className="rounded-md border border-slate-200 p-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[10px] font-semibold text-slate-700" title={spec.description}>{spec.label}</span>
                    <button
                      type="button"
                      onClick={() => addChange(spec.id)}
                      disabled={!variant}
                      title={spec.referent === 'rows' ? 'Applies to the current selection' : 'Then click the map'}
                      className="flex shrink-0 items-center gap-1 rounded-md border border-slate-200 px-1.5 py-0.5 text-[9px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                    >
                      {spec.referent === 'rows' ? <MousePointerClick className="h-2.5 w-2.5" /> : <Crosshair className="h-2.5 w-2.5" />}
                      Record
                    </button>
                  </div>
                  {spec.parameters.map((parameter) => (
                    <div key={parameter.id} className="mt-1 flex items-center gap-1.5">
                      <span className="w-20 shrink-0 truncate text-[9px] text-slate-500">{parameter.label}</span>
                      <div className="min-w-0 flex-1">
                        {parameterInput(parameter, changeValues[spec.id]?.[parameter.id], [], (next) =>
                          setChangeValues((current) => ({ ...current, [spec.id]: { ...current[spec.id], [parameter.id]: next } })))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {records.length ? (
              <ol className="space-y-0.5">
                {records.map((record, index) => (
                  <li key={record.id} className="flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-slate-50">
                    <span className="w-4 shrink-0 text-[9px] font-bold text-slate-300">{index + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[10px] text-slate-600">{summariseOperation(record, manifest)}</span>
                    <button
                      type="button"
                      onClick={() => removeVariantOperation(variant!.id, record.id)}
                      aria-label={`Remove ${summariseOperation(record, manifest)}`}
                      className="shrink-0 text-slate-300 hover:text-rose-500"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[10px] text-slate-400">Nothing recorded yet. The baseline runs with no changes.</p>
            )}
          </Section>

          <div className="px-3 py-3">
            <button
              type="button"
              onClick={() => void run()}
              disabled={running || !variant || bindingErrors.length > 0}
              className="flex w-full items-center justify-center gap-1.5 rounded-md bg-slate-800 px-2 py-1.5 text-[11px] font-bold text-white hover:bg-slate-700 disabled:opacity-40"
            >
              {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              {running ? 'Running…' : 'Run'}
            </button>

            {report && (
              <div className="mt-2 space-y-1">
                {report.created.map((created) => (
                  <p key={created.outputId} className="text-[10px] text-emerald-700">Created “{created.label}”.</p>
                ))}
                {report.warnings.map((warning) => (
                  <p key={warning} className="text-[10px] leading-relaxed text-amber-600">{warning}</p>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
