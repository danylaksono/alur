import { useMemo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Package } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { cn } from '../../utils/cn';
import { resolveArgument, type FragmentArguments } from '../../utils/workflowFragments';
import { FlowNodeShell, fieldLabelClass, inputClass, nodeHandleClass, selectClass } from './FlowNodeShell';

const EXCLUDED_COLUMNS = new Set(['geometry', 'geom', 'geojson', 'geom_agg']);

/**
 * One placement of a saved operation.
 *
 * The node shows only what the operation asks for, so a chain of fifteen steps
 * reads as `Retrofit(+30 EPC on Gcons2023)` on the canvas. The steps themselves
 * live in the fragment definition and are expanded at compile time.
 */
export const FragmentNode = ({ data, id, selected }: any) => {
  const updateNode = useStore((s) => s.updateNode);
  const fragments = useStore((s) => s.fragments);
  const edges = useStore((s) => s.edges);
  const nodeSchemas = useStore((s) => s.nodeSchemas);
  const config = data.config || {};
  const args: FragmentArguments = config.arguments || {};
  const fragment = fragments.find((item) => item.id === config.fragmentId);

  const incomingEdge = edges.find((e) => e.target === id);
  const upstreamSchema = incomingEdge?.source ? nodeSchemas[incomingEdge.source] : null;
  const columnNames: string[] = useMemo(
    () => (upstreamSchema || [])
      .map((col: any) => col.name || col.column_name)
      .filter((name: unknown): name is string =>
        typeof name === 'string' && !EXCLUDED_COLUMNS.has(name.toLowerCase()) && !name.toLowerCase().startsWith('__alur_')),
    [upstreamSchema],
  );

  const setArgument = (parameterId: string, value: string) =>
    updateNode(id, { ...config, arguments: { ...args, [parameterId]: value } });

  // Report the same validation the compiler will apply, so a bad value is
  // visible on the node rather than at run time.
  const error = useMemo(() => {
    if (!fragment) return 'This operation is not defined in this project.';
    for (const parameter of fragment.parameters) {
      try {
        resolveArgument(parameter, args[parameter.id]);
      } catch (err: any) {
        return err?.message || 'Check this operation\'s values.';
      }
    }
    return null;
  }, [fragment, args]);

  const summary = fragment
    ? fragment.parameters.length
      ? fragment.parameters.map((parameter) => `${parameter.label} ${args[parameter.id] ?? parameter.defaultValue ?? '…'}`).join(', ')
      : `${fragment.nodes.length} step${fragment.nodes.length === 1 ? '' : 's'}`
    : 'Missing operation';

  return (
    <FlowNodeShell
      id={id}
      selected={selected}
      tone="cyan"
      icon={Package}
      label="Operation"
      title={fragment?.name || config.fragmentId || 'Saved operation'}
      helperContent={
        <div>
          <div className="font-semibold text-slate-800">{fragment?.name || 'Saved operation'}</div>
          <div>{fragment?.description || 'A named group of steps saved from this workflow.'}</div>
          {fragment && (
            <div className="mt-2 text-[11px] text-slate-500">
              Expands to {fragment.nodes.length} step{fragment.nodes.length === 1 ? '' : 's'} when the workflow runs.
              Editing it here changes only this use of it.
            </div>
          )}
        </div>
      }
    >
      <div className="text-[11px] leading-4 text-slate-500">{summary}</div>

      {fragment?.parameters.map((parameter) => (
        <div key={parameter.id}>
          <label className={cn(fieldLabelClass, 'mb-1')} title={parameter.description}>{parameter.label}</label>
          {parameter.type === 'choice' ? (
            <select
              className={selectClass}
              value={String(args[parameter.id] ?? parameter.defaultValue ?? '')}
              onChange={(e) => setArgument(parameter.id, e.target.value)}
            >
              <option value="">Choose…</option>
              {(parameter.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          ) : parameter.type === 'field' && columnNames.length ? (
            <select
              className={selectClass}
              value={String(args[parameter.id] ?? parameter.defaultValue ?? '')}
              onChange={(e) => setArgument(parameter.id, e.target.value)}
            >
              <option value="">Choose a column…</option>
              {columnNames.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          ) : (
            <input
              type={parameter.type === 'number' ? 'number' : 'text'}
              className={inputClass}
              value={String(args[parameter.id] ?? parameter.defaultValue ?? '')}
              onChange={(e) => setArgument(parameter.id, e.target.value)}
              placeholder={parameter.type === 'number' ? 'e.g. 30' : 'column name'}
            />
          )}
        </div>
      ))}

      {error && <p className="text-[11px] font-medium text-red-500">{error}</p>}

      <Handle type="target" position={Position.Left} className={nodeHandleClass('cyan')} />
      <Handle type="source" position={Position.Right} className={nodeHandleClass('cyan')} />
    </FlowNodeShell>
  );
};
