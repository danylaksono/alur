import { Handle, Position } from '@xyflow/react';
import { Calculator } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { NodeActions } from './NodeActions';
import { NodeSchema } from './NodeSchema';

export const AttributeNode = ({ data, id }: any) => {
  const updateNode = useStore((s) => s.updateNode);
  const expression = data.config?.expression ?? 'population / area';
  const resultField = data.config?.resultField ?? 'new_value';

  const updateConfig = (payload: any) => updateNode(id, { ...data.config, ...payload });

  return (
    <div className="relative px-4 py-3 min-w-[280px] bg-white border-l-4 border-l-slate-500 rounded-xl shadow-lg">
      <NodeActions
        id={id}
        helperContent={
          <div>
            <div className="font-semibold text-slate-800">Attribute Computation</div>
            <div>Add a calculated field using any DuckDB expression.</div>
            <div className="text-[9px] text-slate-500 mt-2">
              Example: <code>population / ST_Area(geom)</code>
            </div>
          </div>
        }
      />
      <div className="text-[10px] font-bold text-muted-foreground uppercase mb-1 flex items-center gap-1">
        <Calculator className="w-3 h-3 text-slate-500" /> Attribute Op
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
            Expression
          </label>
          <textarea
            rows={3}
            className="w-full rounded-lg border border-slate-200 bg-white text-sm text-slate-700 px-3 py-2 focus:border-slate-400 focus:ring-slate-200 focus:ring-2 outline-none font-mono"
            value={expression}
            onChange={(e) => updateConfig({ expression: e.target.value })}
            placeholder="population / area"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
            Result field name
          </label>
          <input
            type="text"
            className="w-full rounded-lg border border-slate-200 bg-white text-sm text-slate-700 px-3 py-2 focus:border-slate-400 focus:ring-slate-200 focus:ring-2 outline-none"
            value={resultField}
            onChange={(e) => updateConfig({ resultField: e.target.value })}
            placeholder="new_value"
          />
        </div>
      </div>

      <div className="mt-3 text-[10px] font-mono bg-slate-50 p-2 rounded text-slate-500 border border-slate-100 break-words">
        SELECT *, {expression} AS {resultField} FROM source;
      </div>

      <NodeSchema nodeId={id} />

      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-slate-400" />
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-slate-400" />
    </div>
  );
};
