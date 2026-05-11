import { useMemo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Zap } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { spatialFunctions, spatialFunctionsByCategory } from '../../utils/spatialFunctions';
import { NodeSchema } from './NodeSchema';
import { cn } from '../../utils/cn';
import { FlowNodeShell, fieldLabelClass, inputClass, nodeHandleClass, selectClass } from './FlowNodeShell';

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
    <FlowNodeShell
      id={id}
      tone="purple"
      icon={Zap}
      label="Spatial Op"
      title={operation}
      helperContent={selectedFnMeta}
    >
        <div>
          <label className={cn(fieldLabelClass, 'mb-1')}>
            Operation
          </label>
          <select
            className={selectClass}
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
            <label className={cn(fieldLabelClass, 'mb-1')}>
              Distance
            </label>
            <input
              type="number"
              min={0}
              className={cn(
                inputClass,
                errors.length > 0 && 'border-red-300 bg-red-50 focus:border-red-400 focus:ring-red-200'
              )}
              value={distance}
              onChange={(e) => updateConfig({ distance: Number(e.target.value) })}
            />
          </div>
        )}

        {operation === 'ST_Transform' && (
          <div className="space-y-2">
            <div>
              <label className={cn(fieldLabelClass, 'mb-1')}>
                Source CRS
              </label>
              <input
                type="text"
                className={cn(
                  inputClass,
                  errors.length > 0 && 'border-red-300 bg-red-50 focus:border-red-400 focus:ring-red-200'
                )}
                value={sourceCrs}
                onChange={(e) => updateConfig({ sourceCrs: e.target.value })}
              />
            </div>
            <div>
              <label className={cn(fieldLabelClass, 'mb-1')}>
                Target CRS
              </label>
              <input
                type="text"
                className={cn(
                  inputClass,
                  errors.length > 0 && 'border-red-300 bg-red-50 focus:border-red-400 focus:ring-red-200'
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

      <NodeSchema nodeId={id} />

      <div className="absolute -left-1.5 top-1/2 -translate-y-1/2 flex flex-col gap-6">
        <div className="relative">
          <Handle type="target" id="input-0" position={Position.Left} className={nodeHandleClass('purple')} />
          {requiredInputCount > 1 && <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[8px] font-bold text-slate-400 uppercase">A</span>}
        </div>
        {requiredInputCount > 1 && (
          <div className="relative">
            <Handle type="target" id="input-1" position={Position.Left} className={nodeHandleClass('purple')} />
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[8px] font-bold text-slate-400 uppercase">B</span>
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} className={nodeHandleClass('purple')} />
    </FlowNodeShell>
  );
};
