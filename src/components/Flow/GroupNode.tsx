import { NodeResizer } from '@xyflow/react';
import { Trash2 } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { cn } from '../../utils/cn';

/**
 * A titled region of the canvas.
 *
 * Per-node notes say why one step is there; this says what a run of them is
 * for — the thing a fifteen-node graph most needs and the SQL can never carry.
 * It owns nothing: the nodes inside are ordinary nodes that happen to sit on
 * top of it, so grouping cannot change what the workflow compiles to. Dragging
 * the box takes whatever is inside it along, which is handled on the canvas
 * where the drag deltas are known.
 */
export const GroupNode = ({ id, data, selected }: any) => {
  const updateNodeLabel = useStore((s) => s.updateNodeLabel);
  const removeNode = useStore((s) => s.removeNode);

  return (
    <>
      {/* Resizing is offered only on the selected box, or every group on the
          canvas would show eight handles at once. */}
      <NodeResizer
        isVisible={selected}
        minWidth={220}
        minHeight={160}
        lineClassName="!border-slate-400"
        handleClassName="!h-2 !w-2 !rounded-sm !border !border-slate-400 !bg-white"
      />
      <div
        className={cn(
          'h-full w-full rounded-xl border-2 border-dashed bg-slate-500/[0.04] transition-colors',
          selected ? 'border-slate-400' : 'border-slate-300',
        )}
      >
        <div className="flex items-center gap-1 px-2.5 pt-2">
          <input
            value={data.label ?? ''}
            onChange={(event) => updateNodeLabel(id, event.target.value)}
            placeholder="Name this part of the workflow"
            aria-label="Group name"
            // nodrag, or typing in the field drags the box across the canvas.
            className="nodrag min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-[11px] font-bold uppercase tracking-wide text-slate-500 outline-none placeholder:font-semibold placeholder:normal-case placeholder:tracking-normal placeholder:text-slate-400 focus:text-slate-700"
          />
          <button
            type="button"
            onClick={() => removeNode(id)}
            title="Delete this group — the steps inside it stay"
            aria-label="Delete group"
            className={cn(
              'nodrag shrink-0 rounded p-1 text-slate-400 transition-opacity hover:bg-white hover:text-rose-600',
              selected ? 'opacity-100' : 'opacity-0 focus-visible:opacity-100',
            )}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
    </>
  );
};
