import { type ReactNode } from 'react';
import { type LucideIcon } from 'lucide-react';
import { cn } from '../../utils/cn';
import { NodeActions } from './NodeActions';

type NodeTone = 'blue' | 'purple' | 'slate' | 'orange' | 'amber' | 'emerald' | 'cyan';

const toneStyles: Record<NodeTone, { bar: string; icon: string; handle: string }> = {
  blue: { bar: 'bg-blue-400', icon: 'text-blue-600 bg-blue-50', handle: '!bg-blue-500' },
  cyan: { bar: 'bg-cyan-400', icon: 'text-cyan-600 bg-cyan-50', handle: '!bg-cyan-500' },
  purple: { bar: 'bg-purple-400', icon: 'text-purple-600 bg-purple-50', handle: '!bg-purple-500' },
  slate: { bar: 'bg-slate-400', icon: 'text-slate-600 bg-slate-100', handle: '!bg-slate-500' },
  orange: { bar: 'bg-orange-400', icon: 'text-orange-600 bg-orange-50', handle: '!bg-orange-500' },
  amber: { bar: 'bg-amber-400', icon: 'text-amber-600 bg-amber-50', handle: '!bg-amber-500' },
  emerald: { bar: 'bg-emerald-400', icon: 'text-emerald-600 bg-emerald-50', handle: '!bg-emerald-500' },
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
  children,
}: FlowNodeShellProps) => {
  const styles = toneStyles[tone];

  return (
    <div
      className={cn(
        'group relative box-border rounded-lg border bg-white transition-shadow',
        selected
          ? 'border-slate-900 shadow-md ring-1 ring-slate-900'
          : 'border-slate-200 shadow-sm hover:shadow-md',
        widthClassName
      )}
    >
      <div className={cn('h-1 rounded-t-[7px]', styles.bar)} />
      <NodeActions id={id} selected={selected} helperContent={helperContent} />
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 pr-12">
        <div className={cn('shrink-0 rounded-md p-1', styles.icon)}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase leading-tight tracking-wide text-slate-600">
            {label}
          </div>
          {title && (
            <div className="truncate text-xs font-semibold leading-tight text-slate-800">
              {title}
            </div>
          )}
        </div>
      </div>
      <div className="space-y-2 px-3 pb-2.5 pt-2">
        {children}
      </div>
    </div>
  );
};

export const fieldLabelClass = 'block text-[10px] font-semibold uppercase tracking-wide text-slate-400';
export const inputClass = 'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none transition-colors focus:border-slate-400 focus:ring-2 focus:ring-slate-200';
export const selectClass = 'w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700 outline-none transition-colors focus:border-slate-400 focus:ring-2 focus:ring-slate-200';
