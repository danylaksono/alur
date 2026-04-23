import { Handle, Position } from '@xyflow/react';
import { Eye, Map as MapIcon, Share2 } from 'lucide-react';
import { NodeActions } from './NodeActions';

export const OutputNode = ({ data, id }: any) => {
  return (
    <div className="relative box-border px-4 py-3 w-[240px] bg-white border-l-4 border-l-emerald-500 rounded-xl shadow-lg">
      <NodeActions id={id} />
      <div className="text-[10px] font-bold text-muted-foreground uppercase mb-1 flex items-center gap-1">
        <Eye className="w-3 h-3 text-emerald-500" /> Map Output
      </div>
      
      <div className="text-xs font-bold text-slate-700 mt-2 flex items-center gap-2">
        <MapIcon className="w-3 h-3 text-emerald-600" /> Visualize Results
      </div>
      
      <div className="flex gap-2 mt-3 pt-2 border-t">
        <button className="flex-1 bg-emerald-50 text-emerald-700 py-1.5 rounded-lg text-[10px] font-bold hover:bg-emerald-100 transition-colors">
          PREVIEW
        </button>
        <button className="p-1.5 bg-slate-50 text-slate-400 rounded-lg hover:bg-slate-100">
          <Share2 className="w-3 h-3" />
        </button>
      </div>

      <Handle type="target" position={Position.Left} className="!bg-emerald-400" />
    </div>
  );
};
