import { useStore } from '../../store/useStore';
import { Database } from 'lucide-react';

interface NodeSchemaProps {
  nodeId: string;
}

export const NodeSchema = ({ nodeId }: NodeSchemaProps) => {
  const schema = useStore((state) => state.nodeSchemas[nodeId]);

  if (!schema || schema.length === 0) return null;

  return (
    <div className="mt-3 pt-2 border-t border-slate-100">
      <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2">
        <Database className="w-2.5 h-2.5" /> Output Schema
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1 max-h-[120px] overflow-y-auto pr-1 custom-scrollbar">
        {schema.map((col: any, i: number) => (
          <div key={i} className="flex items-center justify-between gap-2 px-1.5 py-1 bg-slate-50 rounded border border-slate-100 min-w-0">
            <span className="text-[11px] font-medium text-slate-700 truncate" title={col.name}>
              {col.name}
            </span>
            <span className="text-[10px] font-mono text-slate-400 shrink-0">
              {col.type}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
