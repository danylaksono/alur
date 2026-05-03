import { useMemo, type ChangeEvent } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Zap } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { spatialFunctions, spatialFunctionsByCategory } from '../../utils/spatialFunctions';
import { NodeActions } from './NodeActions';
import { NodeSchema } from './NodeSchema';
import { cn } from '../../utils/cn';

const EPSG_PATTERN = /^EPSG:\d{1,6}$/i;

export const AnalysisNode = ({ data, id }: any) => {
  const updateNode = useStore((s) => s.updateNode);
  const operation = data.config?.operation || 'ST_Buffer';
  const distance = data.config?.distance ?? 100;
  const sourceCrs = data.config?.sourceCrs ?? 'EPSG:4326';
  const targetCrs = data.config?.targetCrs ?? 'EPSG:3857';

  const selectedFunction = spatialFunctions.find((fn) => fn.name === operation) ?? spatialFunctions.find((fn) => fn.name === 'ST_Buffer');
  const requiredInputCount = selectedFunction?.requiredInputCount ?? 1;

  const updateConfig = (payload: any) => updateNode(id, { ...data.config, ...payload });

  const errors = useMemo(() => {
    const errs: string[] = [];
    if (operation === 'ST_Buffer' && (distance < 0 || Number.isNaN(distance))) {
      errs.push('Buffer distance must be a non-negative number');
    }
    if (operation === 'ST_Transform') {
      if (!EPSG_PATTERN.test(sourceCrs)) errs.push('Source CRS should be EPSG:XXXX');
      if (!EPSG_PATTERN.test(targetCrs)) errs.push('Target CRS should be EPSG:XXXX');
    }
    return errs;
  }, [operation, distance, sourceCrs, targetCrs]);

  const selectedFnMeta = selectedFunction ? (
    <>
      <div className="font-semibold text-slate-800">{selectedFunction.name}</div>
      <div>{selectedFunction.summary}</div>
      <div className="text-[9px] text-slate-500">Required inputs: {requiredInputCount} geometry{requiredInputCount > 1 ? 's' : ''}</div>
    </>
  ) : null;

  return (
    <div className="relative px-4 py-3 min-w-[280px] bg-white border-l-4 border-l-purple-500 rounded-xl shadow-lg">
      <NodeActions id={id} helperContent={selectedFnMeta} />
      <div className="text-[10px] font-bold text-muted-foreground uppercase mb-1 flex items-center gap-1">
        <Zap className="w-3 h-3 text-purple-500" /> Spatial Op
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
            Operation
          </label>
          <select
            className="w-full rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-700 px-3 py-2 focus:border-purple-400 focus:ring-purple-200 focus:ring-2 outline-none"
            value={operation}
            onChange={(e) => updateConfig({ operation: e.target.value })}
          >
            {Object.entries(spatialFunctionsByCategory).map(([category, ops]) => (
              <optgroup key={category} label={category}>
                {ops.map((op) => (
                  <option key={op.name} value={op.name}>{op.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {operation === 'ST_Buffer' && (
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
              Distance
            </label>
            <input
              type="number"
              min={0}
              className={cn(
                'w-full rounded-lg border text-sm px-3 py-2 outline-none transition-colors',
                errors.length > 0 ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white focus:border-purple-400 focus:ring-purple-200 focus:ring-2'
              )}
              value={distance}
              onChange={(e) => updateConfig({ distance: Number(e.target.value) })}
            />
          </div>
        )}

        {operation === 'ST_Transform' && (
          <div className="space-y-2">
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
                Source CRS
              </label>
              <input
                type="text"
                className={cn(
                  'w-full rounded-lg border text-sm px-3 py-2 outline-none transition-colors',
                  errors.length > 0 ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white focus:border-purple-400 focus:ring-purple-200 focus:ring-2'
                )}
                value={sourceCrs}
                onChange={(e) => updateConfig({ sourceCrs: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
                Target CRS
              </label>
              <input
                type="text"
                className={cn(
                  'w-full rounded-lg border text-sm px-3 py-2 outline-none transition-colors',
                  errors.length > 0 ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white focus:border-purple-400 focus:ring-purple-200 focus:ring-2'
                )}
                value={targetCrs}
                onChange={(e) => updateConfig({ targetCrs: e.target.value })}
              />
            </div>
          </div>
        )}

        {errors.length > 0 && (
          <div className="text-[9px] text-red-500 space-y-0.5 font-medium">
            {errors.map((err, i) => <div key={i}>{err}</div>)}
          </div>
        )}
      </div>

      <div className="mt-3 text-[10px] font-mono bg-slate-50 p-2 rounded text-slate-500 border border-slate-100 break-words">
        {`SELECT ${operation}(${requiredInputCount === 1 ? 'geom' : 'a.geom, b.geom'}${operation === 'ST_Buffer' ? `, ${distance}` : ''}) ...`}
      </div>

      <NodeSchema nodeId={id} />

      <div className="absolute -left-1.5 top-1/2 -translate-y-1/2 flex flex-col gap-6">
        <div className="relative">
          <Handle type="target" id="input-0" position={Position.Left} className="!w-3 !h-3 !bg-purple-400" />
          {requiredInputCount > 1 && <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[8px] font-bold text-slate-400 uppercase">A</span>}
        </div>
        {requiredInputCount > 1 && (
          <div className="relative">
            <Handle type="target" id="input-1" position={Position.Left} className="!w-3 !h-3 !bg-purple-400" />
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[8px] font-bold text-slate-400 uppercase">B</span>
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-purple-400" />
    </div>
  );
};
