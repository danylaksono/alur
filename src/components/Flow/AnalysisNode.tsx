import { useMemo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Zap } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { spatialFunctions, spatialFunctionsByCategory } from '../../utils/spatialFunctions';
import { cn } from '../../utils/cn';
import { FlowNodeShell, fieldLabelClass, inputClass, nodeHandleClass } from './FlowNodeShell';
import { TypeaheadSelect } from './TypeaheadSelect';

const EPSG_PATTERN = /^EPSG:\d{1,6}$/i;

/** Argument order, not left/right: ST_Difference(A, B) is A minus B. */
const ANALYSIS_PORTS = [
  { letter: 'A', role: 'first', top: '38%' },
  { letter: 'B', role: 'second', top: '62%' },
];

export const AnalysisNode = ({ data, id, selected }: any) => {
  const updateNode = useStore((s) => s.updateNode);
  const operation = data.config?.operation || 'ST_Buffer';
  const distance = data.config?.distance ?? 100;
  const sourceCrs = data.config?.sourceCrs ?? 'EPSG:4326';
  const targetCrs = data.config?.targetCrs ?? 'EPSG:3857';

  const selectedFunction = spatialFunctions.find((fn) => fn.name === operation) ?? spatialFunctions.find((fn) => fn.name === 'ST_Buffer');
  const requiredInputCount = selectedFunction?.requiredInputCount ?? 1;
  const operationOptions = useMemo(
    () => Object.entries(spatialFunctionsByCategory).flatMap(([category, ops]) =>
      ops.map((op) => ({
        value: op.name,
        label: op.name,
        description: op.summary,
        group: category,
      }))
    ),
    []
  );

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
      <div className="text-[11px] text-slate-500">Required inputs: {requiredInputCount} geometry{requiredInputCount > 1 ? 's' : ''}</div>
    </>
  ) : null;

  return (
    <FlowNodeShell
      id={id}
      selected={selected}
      tone="purple"
      icon={Zap}
      label="Spatial Op"
      title={operation}
      helperContent={selectedFnMeta}
      ports={requiredInputCount > 1 ? ANALYSIS_PORTS : undefined}
    >
        <div>
          <label className={cn(fieldLabelClass, 'mb-1')}>
            Operation
          </label>
          <TypeaheadSelect
            value={operation}
            options={operationOptions}
            onChange={(nextOperation) => updateConfig({ operation: nextOperation })}
            placeholder="Search functions..."
          />
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
          <div className="text-[11px] text-red-500 space-y-0.5 font-medium">
            {errors.map((err, i) => <div key={i}>{err}</div>)}
          </div>
        )}
      <Handle
        type="target"
        id="input-0"
        position={Position.Left}
        className={nodeHandleClass('purple')}
        style={requiredInputCount > 1 ? { top: '38%' } : undefined}
      />
      {requiredInputCount > 1 && (
        <>
          <Handle
            type="target"
            id="input-1"
            position={Position.Left}
            className={nodeHandleClass('purple')}
            style={{ top: '62%' }}
          />
        </>
      )}
      <Handle type="source" position={Position.Right} className={nodeHandleClass('purple')} />
    </FlowNodeShell>
  );
};
