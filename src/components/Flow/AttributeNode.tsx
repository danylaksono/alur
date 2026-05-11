import { Handle, Position } from '@xyflow/react';
import { Calculator } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { NodeSchema } from './NodeSchema';
import { FlowNodeShell, fieldLabelClass, inputClass, nodeHandleClass } from './FlowNodeShell';
import { cn } from '../../utils/cn';

export const AttributeNode = ({ data, id }: any) => {
  const updateNode = useStore((s) => s.updateNode);
  const expression = data.config?.expression ?? 'population / area';
  const resultField = data.config?.resultField ?? 'new_value';

  const updateConfig = (payload: any) => updateNode(id, { ...data.config, ...payload });

  return (
    <FlowNodeShell
        id={id}
        tone="slate"
        icon={Calculator}
        label="Attribute Op"
        title={resultField}
        helperContent={
          <div>
            <div className="font-semibold text-slate-800">Attribute Computation</div>
            <div>Add a calculated field using any DuckDB expression.</div>
            <div className="text-[9px] text-slate-500 mt-2">
              Example: <code>population / ST_Area(geom)</code>
            </div>
          </div>
        }
      >
        <div>
          <label className={cn(fieldLabelClass, 'mb-1')}>
            Expression
          </label>
          <textarea
            rows={3}
            className={cn(inputClass, 'font-mono')}
            value={expression}
            onChange={(e) => updateConfig({ expression: e.target.value })}
            placeholder="population / area"
          />
        </div>
        <div>
          <label className={cn(fieldLabelClass, 'mb-1')}>
            Result field name
          </label>
          <input
            type="text"
            className={inputClass}
            value={resultField}
            onChange={(e) => updateConfig({ resultField: e.target.value })}
            placeholder="new_value"
          />
        </div>

      <NodeSchema nodeId={id} />

      <Handle type="target" position={Position.Left} className={nodeHandleClass('slate')} />
      <Handle type="source" position={Position.Right} className={nodeHandleClass('slate')} />
    </FlowNodeShell>
  );
};
