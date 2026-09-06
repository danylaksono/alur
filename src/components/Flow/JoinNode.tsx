import { useMemo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { GitMerge } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { cn } from '../../utils/cn';
import { FlowNodeShell, fieldLabelClass, inputClass, nodeHandleClass, selectClass } from './FlowNodeShell';

const JOIN_PREDICATE_OPTIONS = [
  { value: 'ST_Intersects', label: 'Intersects' },
  { value: 'ST_Within', label: 'A within B' },
  { value: 'ST_Contains', label: 'A contains B' },
  { value: 'ST_DWithin', label: 'Within distance' },
];

const EXCLUDED_COLUMNS = new Set(['geometry', 'geom', 'geojson']);

export const JoinNode = ({ data, id, selected }: any) => {
  const updateNode = useStore((s) => s.updateNode);
  const edges = useStore((s) => s.edges);
  const nodeSchemas = useStore((s) => s.nodeSchemas);
  const config = data.config || {};
  const mode: 'spatial' | 'attribute' = config.mode || 'spatial';
  const joinType: 'left' | 'inner' = config.joinType || 'left';
  const predicate: string = config.predicate || 'ST_Intersects';
  const distance: number = config.distance ?? 100;

  const columnsForHandle = (handle: string) => {
    const edge = edges.find((item) => item.target === id && (item.targetHandle || 'input-0') === handle);
    if (!edge) return [];
    const schema = nodeSchemas[edge.source] || [];
    return schema
      .map((col: any) => col.name || col.column_name)
      .filter((name: unknown): name is string =>
        typeof name === 'string' && !EXCLUDED_COLUMNS.has(name.toLowerCase()) && !name.toLowerCase().startsWith('__alur_')
      );
  };
  const leftColumns = useMemo(() => columnsForHandle('input-0'), [edges, nodeSchemas, id]);
  const rightColumns = useMemo(() => columnsForHandle('input-1'), [edges, nodeSchemas, id]);

  const updateConfig = (patch: Record<string, unknown>) => updateNode(id, { ...config, ...patch });

  const title = mode === 'attribute'
    ? config.leftKey && config.rightKey ? `${config.leftKey} = ${config.rightKey}` : 'Attribute join'
    : JOIN_PREDICATE_OPTIONS.find((option) => option.value === predicate)?.label || predicate;

  const helperContent = (
    <>
      <div className="font-semibold text-slate-800">Join (A ⟕ B)</div>
      <div>Keeps A's rows and geometry, and appends B's attributes with an <code>r_</code> prefix.</div>
      <div className="text-[11px] text-slate-500">Left join keeps unmatched A rows; inner join drops them.</div>
    </>
  );

  return (
    <FlowNodeShell
      id={id}
      selected={selected}
      tone="cyan"
      icon={GitMerge}
      label="Join"
      title={title}
      helperContent={helperContent}
    >
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={cn(fieldLabelClass, 'mb-1')}>Mode</label>
          <select
            className={selectClass}
            value={mode}
            onChange={(e) => updateConfig({ mode: e.target.value })}
          >
            <option value="spatial">Spatial</option>
            <option value="attribute">Attribute</option>
          </select>
        </div>
        <div>
          <label className={cn(fieldLabelClass, 'mb-1')}>Type</label>
          <select
            className={selectClass}
            value={joinType}
            onChange={(e) => updateConfig({ joinType: e.target.value })}
          >
            <option value="left">Left join</option>
            <option value="inner">Inner join</option>
          </select>
        </div>
      </div>

      {mode === 'spatial' ? (
        <>
          <div>
            <label className={cn(fieldLabelClass, 'mb-1')}>Predicate</label>
            <select
              className={selectClass}
              value={predicate}
              onChange={(e) => updateConfig({ predicate: e.target.value })}
            >
              {JOIN_PREDICATE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          {predicate === 'ST_DWithin' && (
            <div>
              <label className={cn(fieldLabelClass, 'mb-1')}>Distance</label>
              <input
                type="number"
                min={0}
                className={inputClass}
                value={distance}
                onChange={(e) => updateConfig({ distance: Number(e.target.value) })}
              />
            </div>
          )}
        </>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={cn(fieldLabelClass, 'mb-1')}>Key A</label>
            {leftColumns.length ? (
              <select
                className={selectClass}
                value={config.leftKey || ''}
                onChange={(e) => updateConfig({ leftKey: e.target.value })}
              >
                <option value="">Choose…</option>
                {leftColumns.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            ) : (
              <input
                type="text"
                className={inputClass}
                placeholder="column"
                value={config.leftKey || ''}
                onChange={(e) => updateConfig({ leftKey: e.target.value })}
              />
            )}
          </div>
          <div>
            <label className={cn(fieldLabelClass, 'mb-1')}>Key B</label>
            {rightColumns.length ? (
              <select
                className={selectClass}
                value={config.rightKey || ''}
                onChange={(e) => updateConfig({ rightKey: e.target.value })}
              >
                <option value="">Choose…</option>
                {rightColumns.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            ) : (
              <input
                type="text"
                className={inputClass}
                placeholder="column"
                value={config.rightKey || ''}
                onChange={(e) => updateConfig({ rightKey: e.target.value })}
              />
            )}
          </div>
        </div>
      )}

      <Handle
        type="target"
        id="input-0"
        position={Position.Left}
        className={nodeHandleClass('cyan')}
        style={{ top: '38%' }}
      />
      <Handle
        type="target"
        id="input-1"
        position={Position.Left}
        className={nodeHandleClass('cyan')}
        style={{ top: '62%' }}
      />
      <span className="pointer-events-none absolute left-1.5 top-[38%] -translate-y-1/2 text-[11px] font-bold uppercase text-slate-500">A</span>
      <span className="pointer-events-none absolute left-1.5 top-[62%] -translate-y-1/2 text-[11px] font-bold uppercase text-slate-500">B</span>
      <Handle type="source" position={Position.Right} className={nodeHandleClass('cyan')} />
    </FlowNodeShell>
  );
};
