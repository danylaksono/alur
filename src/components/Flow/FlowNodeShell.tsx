import { type ReactNode } from 'react';
import { type LucideIcon } from 'lucide-react';
import { cn } from '../../utils/cn';
import { NodeActions } from './NodeActions';

type NodeTone = 'blue' | 'purple' | 'slate' | 'orange' | 'amber' | 'emerald';

const toneStyles: Record<NodeTone, { accent: string; icon: string; handle: string }> = {
  blue: { accent: 'border-blue-200 bg-blue-50/40', icon: 'text-blue-600 bg-blue-50 border-blue-100', handle: '!bg-blue-400' },
  purple: { accent: 'border-purple-200 bg-purple-50/40', icon: 'text-purple-600 bg-purple-50 border-purple-100', handle: '!bg-purple-400' },
  slate: { accent: 'border-slate-200 bg-slate-50/70', icon: 'text-slate-600 bg-slate-50 border-slate-200', handle: '!bg-slate-400' },
  orange: { accent: 'border-orange-200 bg-orange-50/40', icon: 'text-orange-600 bg-orange-50 border-orange-100', handle: '!bg-orange-400' },
  amber: { accent: 'border-amber-200 bg-amber-50/40', icon: 'text-amber-600 bg-amber-50 border-amber-100', handle: '!bg-amber-400' },
  emerald: { accent: 'border-emerald-200 bg-emerald-50/40', icon: 'text-emerald-600 bg-emerald-50 border-emerald-100', handle: '!bg-emerald-400' },
};

interface FlowNodeShellProps {
  id: string;
  tone: NodeTone;
  icon: LucideIcon;
  label: string;
  title?: string;
  helperContent?: ReactNode;
  widthClassName?: string;
  children: ReactNode;
}

export const nodeHandleClass = (tone: NodeTone) => cn('!h-3 !w-3', toneStyles[tone].handle);

export const FlowNodeShell = ({
  id,
  tone,
  icon: Icon,
  label,
  title,
  helperContent,
  widthClassName = 'w-[280px]',
  children,
}: FlowNodeShellProps) => {
  const styles = toneStyles[tone];

  return (
    <div
      className={cn(
        'relative box-border rounded-xl border bg-white shadow-lg shadow-slate-900/10',
        styles.accent,
        widthClassName
      )}
    >
      <NodeActions id={id} helperContent={helperContent} />
      <div className="flex min-h-12 items-start gap-2.5 border-b border-slate-100 px-4 py-3 pr-32">
        <div className={cn('rounded-lg border p-1.5', styles.icon)}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {label}
          </div>
          {title && (
            <div className="mt-0.5 truncate text-sm font-semibold text-slate-800">
              {title}
            </div>
          )}
        </div>
      </div>
      <div className="space-y-3 px-4 py-3">
        {children}
      </div>
    </div>
  );
};

export const fieldLabelClass = 'block text-[11px] font-semibold uppercase tracking-wide text-slate-500';
export const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition-colors focus:border-slate-400 focus:ring-2 focus:ring-slate-200';
export const selectClass = 'w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition-colors focus:border-slate-400 focus:ring-2 focus:ring-slate-200';
