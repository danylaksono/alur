import { useEffect, useMemo, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { AlertTriangle, Boxes, Check, Loader2, Play, Settings2 } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { cn } from '../../utils/cn';
import { FlowNodeShell, nodeHandleClass } from './FlowNodeShell';
import { optionLabel, optionValue } from '../../types/operations';
import type { OperationManifest } from '../../types/operations';
import {
  calculationInputHandle,
  calculationSources,
  calculationStaleness,
  resolveCalculation,
  runCalculationNode,
  type CalculationNodeConfig,
} from '../../services/calculationNodeService';

/**
 * A calculation as a node on the canvas.
 *
 * Nothing here names a calculation. Every handle, role and setting is read from
 * whatever the chosen algorithm declared — which is what makes this one
 * component rather than one per plugin, and what lets a plugin installed after
 * this file was written appear on the canvas without changing it.
 *
 * The node deliberately shows less than the toolbox dialog does. What belongs on
 * a canvas is what the step is, what feeds it, and whether its answer is current;
 * the long generated form belongs in a dialog where it has room.
 */

const EXCLUDED = new Set(['geometry', 'geom', 'wkb_geometry', 'geojson']);

const columnsOf = (schema: any[] | undefined) =>
  (schema || [])
    .map((column: any) => String(column.name ?? column.column_name ?? ''))
    .filter((name) => name && !EXCLUDED.has(name.toLowerCase()) && !name.startsWith('__alur_'));

export const CalculationNode = ({ data, id, selected }: any) => {
  const config = (data.config || {}) as CalculationNodeConfig;
  const nodes = useStore((state) => state.nodes);
  const edges = useStore((state) => state.edges);
  const fragments = useStore((state) => state.fragments);
  const nodeSchemas = useStore((state) => state.nodeSchemas);
  const variants = useStore((state) => state.visualAnalytics.variants);
  const activeSessionId = useStore((state) => state.visualAnalytics.activeSessionId);
  const updateNode = useStore((state) => state.updateNode);
  const addToast = useStore((state) => state.addToast);

  const [manifest, setManifest] = useState<OperationManifest | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Resolved rather than stored. A provider is code, not project data — a node
  // that carried its own copy of the manifest would keep answering for a plugin
  // that has since changed or been removed.
  useEffect(() => {
    let cancelled = false;
    if (!config.calculationId) return;
    resolveCalculation(config)
      .then((found) => { if (!cancelled) { setManifest(found); setProblem(null); } })
      .catch((error) => { if (!cancelled) setProblem(error instanceof Error ? error.message : String(error)); });
    return () => { cancelled = true; };
  }, [config.calculationId, config.pluginUrl]);

  const variant = useMemo(() => {
    const scoped = activeSessionId ? variants.filter((item) => item.sessionId === activeSessionId) : variants;
    return scoped[0];
  }, [variants, activeSessionId]);

  const staleness = useMemo(
    () => calculationStaleness({
      nodeId: id,
      nodes,
      edges,
      fragments,
      manifest,
      operations: variant?.operations ?? [],
      variantId: variant?.id ?? '',
    }),
    [id, nodes, edges, fragments, manifest, variant],
  );

  const updateConfig = (patch: Partial<CalculationNodeConfig>) => updateNode(id, { ...config, ...patch });

  const setField = (inputId: string, sourceNodeId: string, roleId: string, column: string) =>
    updateConfig({
      fields: {
        ...(config.fields ?? {}),
        [inputId]: {
          ...(config.fields?.[inputId] ?? {}),
          [sourceNodeId]: { ...(config.fields?.[inputId]?.[sourceNodeId] ?? {}), [roleId]: column },
        },
      },
    });

  const run = async () => {
    setRunning(true);
    try {
      const outcome = await runCalculationNode(id);
      addToast({
        type: outcome.report.warnings.length ? 'warning' : 'success',
        message: `${data.label} produced ${outcome.rowCount.toLocaleString()} rows.`,
      });
      for (const warning of outcome.report.warnings) addToast({ type: 'warning', message: warning });
    } catch (error) {
      addToast({ type: 'error', message: `${data.label} failed: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setRunning(false);
    }
  };

  const ran = Boolean(config.tableName);
  const stale = staleness?.stale ?? false;

  return (
    <FlowNodeShell
      id={id}
      selected={selected}
      tone="violet"
      icon={Boxes}
      label="Calculation"
      title={config.label || data.label}
    >
      {/* One target handle per declared input, so which data feeds which role is
          a property of the graph rather than a choice buried in a form. */}
      {(manifest?.inputs ?? [{ id: 'in', label: 'Input' } as any]).map((input: any, index: number) => (
        <Handle
          key={input.id}
          id={calculationInputHandle(input.id)}
          type="target"
          position={Position.Left}
          style={{ top: 62 + index * 30 }}
          title={input.label}
          className={nodeHandleClass('violet')}
        />
      ))}

      <div className="space-y-2">
        {problem && (
          <p className="rounded-md bg-rose-50 px-2 py-1.5 text-[11px] leading-relaxed text-rose-700">{problem}</p>
        )}

        {manifest && (
          <div className="space-y-1.5">
            {manifest.inputs.map((input) => {
              const sources = calculationSources(id, input.id, edges);
              return (
                <div key={input.id} className="rounded-md bg-slate-50 px-1.5 py-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] font-bold text-slate-600">{input.label}</span>
                    <span className={cn('shrink-0 text-[11px]', sources.length ? 'text-slate-500' : 'text-amber-600')}>
                      {sources.length ? `${sources.length} connected` : 'not connected'}
                    </span>
                  </div>

                  {expanded && sources.map((sourceNodeId) => {
                    const columns = columnsOf(nodeSchemas[sourceNodeId]);
                    const label = nodes.find((node) => node.id === sourceNodeId)?.data.label || sourceNodeId;
                    return (
                      <div key={sourceNodeId} className="mt-1 border-t border-slate-200 pt-1">
                        <p className="truncate text-[11px] italic text-slate-500">{label}</p>
                        {input.fields.map((role) => (
                          <div key={role.id} className="mt-0.5 flex items-center gap-1">
                            <span className="w-16 shrink-0 truncate text-[11px] text-slate-500" title={role.description}>
                              {role.label}{role.required && <span className="text-rose-400">*</span>}
                            </span>
                            <select
                              value={config.fields?.[input.id]?.[sourceNodeId]?.[role.id] || ''}
                              onChange={(event) => setField(input.id, sourceNodeId, role.id, event.target.value)}
                              aria-label={`${input.label} ${label} ${role.label}`}
                              className="min-w-0 flex-1 rounded border border-slate-200 px-1 py-0.5 text-[11px]"
                            >
                              {/* Named rather than blank. An identifier falls back
                                  to the row number, and a control that showed a
                                  dash would leave the analyst thinking nothing
                                  had been chosen. */}
                              <option value="">
                                {role.required && role.semanticType === 'identifier' ? 'Row number' : '—'}
                              </option>
                              {columns.map((column) => <option key={column} value={column}>{column}</option>)}
                            </select>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {expanded && manifest.parameters.length > 0 && (
              <div className="border-t border-slate-100 pt-1.5">
                <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Settings</p>
                {manifest.parameters.map((parameter) => {
                  const value = config.parameters?.[parameter.id] ?? parameter.defaultValue ?? '';
                  const set = (next: unknown) =>
                    updateConfig({ parameters: { ...(config.parameters ?? {}), [parameter.id]: next } });
                  return (
                    <div key={parameter.id} className="mb-1 flex items-center gap-1">
                      <span className="w-20 shrink-0 truncate text-[11px] text-slate-500" title={parameter.description}>
                        {parameter.label}
                      </span>
                      {parameter.type === 'choice' ? (
                        <select
                          value={String(value)}
                          onChange={(event) => set(event.target.value)}
                          aria-label={parameter.label}
                          className="min-w-0 flex-1 rounded border border-slate-200 px-1 py-0.5 text-[11px]"
                        >
                          <option value="">Choose…</option>
                          {(parameter.options || []).map((option) => (
                            <option key={optionValue(option)} value={optionValue(option)}>{optionLabel(option)}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="number"
                          value={String(value)}
                          onChange={(event) => set(event.target.value === '' ? '' : Number(event.target.value))}
                          aria-label={parameter.label}
                          className="min-w-0 flex-1 rounded border border-slate-200 px-1 py-0.5 text-[11px]"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {expanded && manifest.outputs.length > 1 && (
              <div className="flex items-center gap-1 border-t border-slate-100 pt-1.5">
                <span className="w-20 shrink-0 text-[11px] text-slate-500">Passes on</span>
                <select
                  value={config.outputId || manifest.outputs[0].id}
                  onChange={(event) => updateConfig({ outputId: event.target.value })}
                  aria-label="Output passed downstream"
                  className="min-w-0 flex-1 rounded border border-slate-200 px-1 py-0.5 text-[11px]"
                >
                  {manifest.outputs.map((output) => (
                    <option key={output.id} value={output.id}>{output.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {/* Staleness is stated, never acted on. Re-running silently would mean a
            map could change because something upstream moved, with no moment at
            which anybody decided that was the answer they wanted. */}
        {ran && (
          <div
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold',
              stale ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800',
            )}
          >
            {stale ? <AlertTriangle className="h-3 w-3 shrink-0" /> : <Check className="h-3 w-3 shrink-0" />}
            <span className="truncate">
              {stale
                ? 'Out of date — what feeds this has changed'
                : `${(config.rowCount ?? 0).toLocaleString()} rows`}
            </span>
          </div>
        )}

        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => void run()}
            disabled={running || !manifest}
            className="pressable flex flex-1 items-center justify-center gap-1.5 rounded-md bg-violet-600 px-2 py-1.5 text-[11px] font-bold text-white disabled:bg-slate-300"
          >
            {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            {ran ? 'Run again' : 'Run'}
          </button>
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            aria-expanded={expanded}
            aria-label="Configure this calculation"
            className="pressable rounded-md border border-slate-200 px-2 text-slate-500 hover:bg-slate-50"
          >
            <Settings2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      <Handle type="source" position={Position.Right} className={nodeHandleClass('violet')} />
    </FlowNodeShell>
  );
};
