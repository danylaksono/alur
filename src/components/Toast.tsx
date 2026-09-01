import { useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { useStore, type Toast } from '../store/useStore';
import { cn } from '../utils/cn';

const iconMap = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
  warning: AlertTriangle,
};

const styleMap = {
  success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  error: 'bg-red-50 border-red-200 text-red-800',
  info: 'bg-blue-50 border-blue-200 text-blue-800',
  warning: 'bg-amber-50 border-amber-200 text-amber-800',
};

function ToastItem({ toast }: { toast: Toast }) {
  const removeToast = useStore((s) => s.removeToast);
  const Icon = iconMap[toast.type];

  useEffect(() => {
    const timer = setTimeout(() => removeToast(toast.id), 5000);
    return () => clearTimeout(timer);
  }, [toast.id, removeToast]);

  return (
    <div className={cn('flex items-start gap-2 px-4 py-3 rounded-xl border shadow-lg text-[11px] font-medium min-w-[280px] max-w-md toast-enter', styleMap[toast.type])}>
      <Icon className="w-4 h-4 shrink-0 mt-0.5" />
      <span className="flex-1">{toast.message}</span>
      <button type="button" onClick={() => removeToast(toast.id)} className="pressable shrink-0 opacity-60 hover:opacity-100 transition-opacity" aria-label="Dismiss notification">
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const toasts = useStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    // Top-center, just below the header: keeps toasts off the drawer workspace
    // (bottom), the map controls (top-right), and the left panel.
    <div className="fixed left-1/2 top-14 z-[9999] flex -translate-x-1/2 flex-col items-center gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem toast={toast} />
        </div>
      ))}
    </div>
  );
}
