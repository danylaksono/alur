import { Copy, Trash2 } from 'lucide-react';
import { useStore } from '../../store/useStore';

interface NodeActionsProps {
  id: string;
}

export const NodeActions = ({ id }: NodeActionsProps) => {
  const { removeNode, duplicateNode } = useStore();

  const handleDelete = () => {
    removeNode(id);
  };

  const handleDuplicate = () => {
    duplicateNode(id, `node-${Date.now()}`);
  };

  return (
    <div className="absolute top-3 right-3 flex items-center gap-1">
      <button
        type="button"
        onClick={handleDuplicate}
        title="Duplicate node"
        className="rounded-md border border-slate-200 bg-white p-1 text-slate-500 shadow-sm hover:bg-slate-50"
      >
        <Copy className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={handleDelete}
        title="Delete node"
        className="rounded-md border border-slate-200 bg-white p-1 text-rose-500 shadow-sm hover:bg-rose-50"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
