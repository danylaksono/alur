import { type ReactNode } from 'react';
import { AlertTriangle, CircleDashed, StickyNote, type LucideIcon } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { cn } from '../../utils/cn';
import { NodeActions } from './NodeActions';

type NodeTone = 'blue' | 'purple' | 'slate' | 'orange' | 'amber' | 'emerald' | 'cyan' | 'violet';

const toneStyles: Record<NodeTone, { bar: string; icon: string; handle: string }> = {
  blue: { bar: 'bg-blue-400', icon: 'text-blue-600 bg-blue-50', handle: '!bg-blue-500' },
  cyan: { bar: 'bg-cyan-400', icon: 'text-cyan-600 bg-cyan-50', handle: '!bg-cyan-500' },
  purple: { bar: 'bg-purple-400', icon: 'text-purple-600 bg-purple-50', handle: '!bg-purple-500' },
  slate: { bar: 'bg-slate-400', icon: 'text-slate-600 bg-slate-100', handle: '!bg-slate-500' },
  orange: { bar: 'bg-orange-400', icon: 'text-orange-600 bg-orange-50', handle: '!bg-orange-500' },
  amber: { bar: 'bg-amber-400', icon: 'text-amber-600 bg-amber-50', handle: '!bg-amber-500' },
  emerald: { bar: 'bg-emerald-400', icon: 'text-emerald-600 bg-emerald-50', handle: '!bg-emerald-500' },
  violet: { bar: 'bg-violet-400', icon: 'text-violet-600 bg-violet-50', handle: '!bg-violet-500' },
};

interface FlowNodeShellProps {
  id: string;
  tone: NodeTone;
  icon: LucideIcon;
  label: string;
  title?: string;
  selected?: boolean;
  helperContent?: ReactNode;
  widthClassName?: string;
  /**
   * Named input ports, for nodes that take more than one and where the order
   * changes the answer. The shell draws them and reserves the gutter they sit
   * in, so the labels cannot land on top of the node's own fields.
   */
  ports?: Array<{ letter: string; role: string; top: string }>;
  children: ReactNode;
}

export const nodeHandleClass = (tone: NodeTone) => toneStyles[tone].handle;

export const FlowNodeShell = ({
  id,
  tone,
  icon: Icon,
  label,
  title,
  selected = false,
  helperContent,
  widthClassName = 'w-60',
  ports,
  children,
}: FlowNodeShellProps) => {
  const styles = toneStyles[tone];
  // The compiler stops at the first problem, so at most one node carries an
  // issue at a time — which is also the only one worth acting on.
  const issue = useStore((state) => (state.workflowIssue?.nodeId === id ? state.workflowIssue.message : null));
  const node = useStore((state) => state.nodes.find((item) => item.id === id));
  const setNodeNote = useStore((state) => state.setNodeNote);
  const disabled = Boolean(node?.data.disabled);
  const collapsed = Boolean(node?.data.collapsed);
  const note = node?.data.note ?? '';
  const editingNote = useStore((state) => state.ui.noteEditorNodeId === id);
  const setNoteEditor = useStore((state) => state.setNoteEditorNodeId);
  const readiness = useStore((state) => state.workflowReadiness[id]);
  // An unfinished step reads as unfinished before it is ever run. The issue
  // badge outranks it: that one is the compiler actually refusing.
  const needsSetup = !disabled && !issue && readiness && !readiness.ready ? readiness.reason : null;

  return (
    <div
      className={cn(
        'group relative box-border rounded-lg transition-shadow',
        // Dashed while unfinished, solid once the step can do its job — the
        // border carries the state so it survives being zoomed out.
        needsSetup ? 'border-2 border-dashed bg-slate-50/80' : 'border bg-white',
        disabled && 'opacity-55 grayscale',
        issue
          ? 'border-amber-400 shadow-md ring-1 ring-amber-300'
          : selected
            ? 'border-slate-900 shadow-md ring-1 ring-slate-900'
            : needsSetup
              ? 'border-slate-300 shadow-sm hover:shadow-md'
              : 'border-slate-200 shadow-sm hover:shadow-md',
        widthClassName
      )}
    >
      <div className={cn('h-1 rounded-t-[7px]', needsSetup || disabled ? 'bg-slate-300' : styles.bar)} />
      <NodeActions id={id} selected={selected} helperContent={helperContent} />
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 pr-12">
        <div className={cn('shrink-0 rounded-md p-1', styles.icon)}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase leading-tight tracking-wide text-slate-600">
            {label}
          </div>
          {title && (
            <div className="truncate text-xs font-semibold leading-tight text-slate-800">
              {title}
            </div>
          )}
        </div>
      </div>
      {/* Collapsed keeps the header, the state footers and every handle, so a
          folded step still shows what it is and stays wired into the graph.
          Each node passes its Handles among these children, so the fields are
          hidden one by one rather than by dropping the whole block — unmounting
          it would take the handles with it and cut the node out of the graph. */}
      <div
        className={cn(
          collapsed
            ? '[&>*:not(.react-flow__handle)]:hidden'
            : cn('space-y-2 pb-2.5 pr-3 pt-2', ports?.length ? 'pl-11' : 'pl-3'),
        )}
      >
        {children}
      </div>

      {ports?.map((port) => (
        <span
          key={port.letter}
          className="pointer-events-none absolute left-1.5 z-10 flex -translate-y-1/2 flex-col items-start leading-none"
          style={{ top: port.top }}
          title={`${port.letter} — ${port.role}`}
        >
          <span className="text-[11px] font-bold uppercase text-slate-600">{port.letter}</span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {port.role}
          </span>
        </span>
      ))}
      {(note || editingNote) && (
        <div className="border-t border-amber-100 bg-amber-50/60 px-3 py-2">
          {editingNote ? (
            <textarea
              autoFocus
              value={note}
              onChange={(event) => setNodeNote(id, event.target.value)}
              onBlur={() => setNoteEditor(null)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setNoteEditor(null);
              }}
              placeholder="Why is this step here?"
              aria-label="Note"
              // nodrag/nowheel, or typing in the box pans the canvas instead.
              className="nodrag nowheel w-full resize-none rounded border border-amber-200 bg-white px-2 py-1 text-[11px] leading-snug text-slate-700 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
              rows={3}
            />
          ) : (
            <button
              type="button"
              onClick={() => setNoteEditor(id)}
              title="Edit note"
              className="nodrag flex w-full items-start gap-1.5 text-left text-[11px] leading-snug text-amber-900"
            >
              <StickyNote className="mt-px h-3 w-3 shrink-0 text-amber-600" aria-hidden="true" />
              <span className="whitespace-pre-wrap">{note}</span>
            </button>
          )}
        </div>
      )}
      {disabled && (
        <div className="rounded-b-lg border-t border-slate-200 bg-slate-100 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
          Bypassed — passes its input straight through
        </div>
      )}
      {needsSetup && (
        <div
          className="flex items-start gap-1.5 rounded-b-lg border-t border-slate-200 bg-white/70 px-3 py-2 text-[11px] font-medium leading-snug text-slate-600"
          role="status"
        >
          <CircleDashed className="mt-px h-3 w-3 shrink-0 text-slate-500" aria-hidden="true" />
          <span>{needsSetup}</span>
        </div>
      )}
      {issue && (
        <div
          className="flex items-start gap-1.5 rounded-b-lg border-t border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium leading-snug text-amber-900"
          role="status"
        >
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
          <span>{issue}</span>
        </div>
      )}
    </div>
  );
};

export const fieldLabelClass = 'block text-[11px] font-semibold uppercase tracking-wide text-slate-500';
export const inputClass = 'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none transition-colors focus:border-slate-400 focus:ring-2 focus:ring-slate-200';
export const selectClass = 'w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700 outline-none transition-colors focus:border-slate-400 focus:ring-2 focus:ring-slate-200';
