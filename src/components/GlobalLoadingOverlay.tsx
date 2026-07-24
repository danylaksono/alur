import { Database, LoaderCircle } from 'lucide-react';
import { useStore } from '../store/useStore';

export const GlobalLoadingOverlay = () => {
  const loadingOperations = useStore((state) => state.loadingOperations);
  const operations = Object.values(loadingOperations).sort((a, b) => b.startedAt - a.startedAt);
  const current = operations[0];

  if (!current) return null;

  const progress = current.progress === undefined
    ? undefined
    : Math.max(0, Math.min(100, current.progress));

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/15 px-4 backdrop-blur-[1.5px]"
      role="status"
      aria-live="polite"
      aria-label={`${current.title}. ${current.detail}`}
    >
      <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-white/80 bg-white/95 shadow-2xl shadow-slate-950/15">
        <div className="flex items-start gap-3.5 px-5 pb-4 pt-5">
          <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-primary">
            <Database className="h-5 w-5" aria-hidden="true" />
            <LoaderCircle className="absolute -inset-1 h-[52px] w-[52px] animate-spin text-teal-500/60" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-slate-900">{current.title}</p>
            {current.fileName && (
              <p className="mt-0.5 truncate text-[11px] font-medium text-slate-500" title={current.fileName}>
                {current.fileName}
              </p>
            )}
            <p className="mt-2 text-xs leading-5 text-slate-600">{current.detail}</p>
          </div>
        </div>

        <div className="h-1.5 bg-slate-100" aria-hidden="true">
          {progress === undefined ? (
            <div className="h-full w-1/3 animate-pulse rounded-r-full bg-primary" />
          ) : (
            <div
              className="h-full rounded-r-full bg-primary transition-[width] duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          )}
        </div>

        {operations.length > 1 && (
          <p className="border-t border-slate-100 px-5 py-2.5 text-[10px] font-medium text-slate-400">
            {operations.length - 1} more {operations.length === 2 ? 'task' : 'tasks'} queued
          </p>
        )}
      </div>
    </div>
  );
};
