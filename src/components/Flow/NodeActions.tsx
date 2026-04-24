import { useState, useRef, useEffect, type ReactNode } from 'react';
import { Copy, Trash2, Info } from 'lucide-react';
import { useStore } from '../../store/useStore';

interface NodeActionsProps {
  id: string;
  helperContent?: ReactNode;
}

export const NodeActions = ({ id, helperContent }: NodeActionsProps) => {
  const { removeNode, duplicateNode } = useStore();
  const [showHelper, setShowHelper] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const handleDelete = () => {
    removeNode(id);
  };

  const handleDuplicate = () => {
    duplicateNode(id, `node-${Date.now()}`);
  };

  // Close popover when clicking outside
  useEffect(() => {
    if (!showHelper) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowHelper(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showHelper]);

  return (
    <div className="absolute top-3 right-3 flex items-center gap-1">
      {helperContent && (
        <div className="relative" ref={popoverRef}>
          <button
            type="button"
            onClick={() => setShowHelper((v) => !v)}
            title="Show info"
            className="rounded-md border border-slate-200 bg-white p-1 text-slate-400 shadow-sm hover:bg-blue-50 hover:text-blue-500 transition-colors"
          >
            <Info className="w-3.5 h-3.5" />
          </button>
          {showHelper && (
            <div className="absolute right-0 top-full mt-1 z-50 w-56 rounded-xl border border-slate-200 bg-white p-3 shadow-xl text-[10px] text-slate-600 space-y-1 animate-in fade-in slide-in-from-top-1">
              {helperContent}
            </div>
          )}
        </div>
      )}
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
