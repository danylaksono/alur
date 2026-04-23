import { Handle, Position } from '@xyflow/react';
import { type ChangeEvent } from 'react';
import { Zap, Calculator } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { spatialFunctions, spatialFunctionsByCategory } from '../../utils/spatialFunctions';
import { NodeActions } from './NodeActions';

export const AnalysisNode = ({ data, id }: any) => {
  const { updateNode } = useStore();
  const isAttribute = data.type === 'attribute';
  const operation = data.config?.operation || (isAttribute ? 'Add Computed Field' : 'ST_Buffer');
  const distance = data.config?.distance ?? 100;
  const resultField = data.config?.resultField ?? 'new_value';
  const expression = data.config?.expression ?? 'population / area';
  const sourceTable = data.config?.sourceTable ?? 'input_table';

  const selectedFunction = !isAttribute
    ? spatialFunctions.find((fn) => fn.name === operation) ?? spatialFunctions.find((fn) => fn.name === 'ST_Buffer')
    : undefined;
  const requiredInputCount = selectedFunction?.requiredInputCount ?? 1;

  const updateConfig = (payload: any) => updateNode(id, { ...data.config, ...payload });

  const handleOperationChange = (e: ChangeEvent<HTMLSelectElement>) => {
    updateConfig({ operation: e.target.value });
  };

  const handleDistanceChange = (e: ChangeEvent<HTMLInputElement>) => {
    updateConfig({ distance: Number(e.target.value) });
  };

  return (
    <div className={`relative px-4 py-3 min-w-[280px] bg-white border-l-4 rounded-xl shadow-lg ${isAttribute ? 'border-l-slate-500' : 'border-l-purple-500'}`}>
      <NodeActions id={id} />
      <div className="text-[10px] font-bold text-muted-foreground uppercase mb-1 flex items-center gap-1">
        {isAttribute ? <Calculator className="w-3 h-3 text-slate-500" /> : <Zap className="w-3 h-3 text-purple-500" />} {isAttribute ? 'Attribute Op' : 'Spatial Op'}
      </div>

      <div className="space-y-3">
        {!isAttribute ? (
          <>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
                Operation
              </label>
              <select
                className="w-full rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-700 px-3 py-2 focus:border-purple-400 focus:ring-purple-200 focus:ring-2 outline-none"
                value={operation}
                onChange={handleOperationChange}
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
                  className="w-full rounded-lg border border-slate-200 bg-white text-sm text-slate-700 px-3 py-2 focus:border-purple-400 focus:ring-purple-200 focus:ring-2 outline-none"
                  value={distance}
                  onChange={handleDistanceChange}
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
                    className="w-full rounded-lg border border-slate-200 bg-white text-sm text-slate-700 px-3 py-2 focus:border-purple-400 focus:ring-purple-200 focus:ring-2 outline-none"
                    value={data.config?.sourceCrs ?? 'EPSG:4326'}
                    onChange={(e) => updateConfig({ sourceCrs: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
                    Target CRS
                  </label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-slate-200 bg-white text-sm text-slate-700 px-3 py-2 focus:border-purple-400 focus:ring-purple-200 focus:ring-2 outline-none"
                    value={data.config?.targetCrs ?? 'EPSG:3857'}
                    onChange={(e) => updateConfig({ targetCrs: e.target.value })}
                  />
                </div>
              </div>
            )}

            <div className="rounded-2xl bg-slate-50 border border-slate-100 p-3 text-[10px] text-slate-600 space-y-1">
              <div className="font-semibold text-slate-800">{selectedFunction?.name}</div>
              <div>{selectedFunction?.summary}</div>
              <div className="text-[9px] text-slate-500">Required inputs: {requiredInputCount} geometry{requiredInputCount > 1 ? 's' : ''}</div>
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
                Source table or CTE
              </label>
              <input
                type="text"
                className="w-full rounded-lg border border-slate-200 bg-white text-sm text-slate-700 px-3 py-2 focus:border-slate-400 focus:ring-slate-200 focus:ring-2 outline-none"
                value={sourceTable}
                onChange={(e) => updateConfig({ sourceTable: e.target.value })}
                placeholder="input_table"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
                Expression
              </label>
              <textarea
                rows={4}
                className="w-full rounded-lg border border-slate-200 bg-white text-sm text-slate-700 px-3 py-2 focus:border-slate-400 focus:ring-slate-200 focus:ring-2 outline-none"
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
            <div className="rounded-2xl bg-slate-50 border border-slate-100 p-3 text-[10px] text-slate-600">
              Build a new attribute using a DuckDB expression. The output adds one computed field to each row.
            </div>
          </>
        )}
      </div>

      <div className="mt-3 text-[10px] font-mono bg-slate-50 p-2 rounded text-slate-500 border border-slate-100 break-words">
        {isAttribute ? (
          `SELECT *, ${expression} AS ${resultField} FROM ${sourceTable};`
        ) : (
          `SELECT ${operation}(${requiredInputCount === 1 ? 'geom' : 'geom, geom2'}${operation === 'ST_Buffer' ? `, ${distance}` : ''}) ...`
        )}
      </div>

      <Handle type="target" id="input-0" position={Position.Left} className="!bg-purple-400" />
      {!isAttribute && requiredInputCount > 1 && (
        <Handle type="target" id="input-1" position={Position.Top} className="!bg-purple-400" />
      )}
      <Handle type="source" position={Position.Right} className="!bg-purple-400" />
    </div>
  );
};
