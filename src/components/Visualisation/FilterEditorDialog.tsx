import { useEffect, useId, useState } from 'react';
import { SlidersHorizontal, Trash2, X } from 'lucide-react';
import type { VisualFilter } from '../../types/visualAnalytics';
import { isVisualFilterValid, visualFilterLabel } from '../../utils/visualFilters';

const inputClass = 'h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-700 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100';
const labelClass = 'space-y-1 text-[11px] font-semibold text-slate-600';

const numberValue = (value: string) => value.trim() === '' ? undefined : Number(value);

export const FilterEditorDialog = ({
  filter,
  title = 'Edit filter',
  onApply,
  onCancel,
  onRemove,
}: {
  filter: VisualFilter;
  title?: string;
  onApply: (filter: VisualFilter) => void;
  onCancel: () => void;
  onRemove?: () => void;
}) => {
  const titleId = useId();
  const [draft, setDraft] = useState<VisualFilter>(filter);

  useEffect(() => setDraft(filter), [filter]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const setMode = (mode: 'include' | 'exclude') => {
    if ('mode' in draft) setDraft({ ...draft, mode });
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/25 p-4" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <section role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b bg-slate-50 px-4 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <SlidersHorizontal className="h-4 w-4 text-sky-600" /> {title}
            </h2>
            <p className="mt-0.5 truncate text-[11px] text-slate-500">{visualFilterLabel(draft)}</p>
          </div>
          <button type="button" onClick={onCancel} aria-label="Close filter editor" className="pressable rounded-md p-1.5 text-slate-500 hover:bg-slate-200 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 p-4">
          {'mode' in draft && (
            <fieldset className="space-y-1.5">
              <legend className="text-[11px] font-semibold text-slate-600">Mode</legend>
              <div className="grid grid-cols-2 gap-2">
                {(['include', 'exclude'] as const).map((mode) => (
                  <button key={mode} type="button" aria-pressed={(draft.mode || 'include') === mode} onClick={() => setMode(mode)} className={`rounded-md border px-3 py-2 text-xs font-semibold capitalize ${(draft.mode || 'include') === mode ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                    {mode}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {draft.kind === 'category' && (
            <label className={labelClass}>
              Values <span className="font-normal text-slate-500">comma or line separated</span>
              <textarea autoFocus rows={4} value={draft.values.join('\n')} onChange={(event) => setDraft({ ...draft, values: [...new Set(event.target.value.split(/[\n,]/).map((value) => value.trim()).filter(Boolean))] })} className={`${inputClass} h-auto py-2 font-mono`} />
            </label>
          )}

          {draft.kind === 'range' && (
            <div className="grid grid-cols-2 gap-3">
              <label className={labelClass}>Minimum
                <input autoFocus type="number" value={draft.min ?? ''} onChange={(event) => setDraft({ ...draft, min: numberValue(event.target.value) })} className={inputClass} />
              </label>
              <label className={labelClass}>Maximum
                <input type="number" value={draft.max ?? ''} onChange={(event) => setDraft({ ...draft, max: numberValue(event.target.value) })} className={inputClass} />
              </label>
            </div>
          )}

          {draft.kind === 'temporal' && (
            <div className="grid grid-cols-2 gap-3">
              <label className={labelClass}>From
                <input autoFocus type="text" value={draft.start ?? ''} placeholder="YYYY-MM-DD" onChange={(event) => setDraft({ ...draft, start: event.target.value || undefined })} className={inputClass} />
              </label>
              <label className={labelClass}>Until
                <input type="text" value={draft.end ?? ''} placeholder="YYYY-MM-DD" onChange={(event) => setDraft({ ...draft, end: event.target.value || undefined })} className={inputClass} />
              </label>
            </div>
          )}

          {draft.kind === 'text' && (
            <div className="grid grid-cols-[9rem_1fr] gap-3">
              <label className={labelClass}>Operator
                <select value={draft.operator} onChange={(event) => setDraft({ ...draft, operator: event.target.value as typeof draft.operator })} className={inputClass}>
                  <option value="contains">Contains</option>
                  <option value="starts_with">Starts with</option>
                  <option value="ends_with">Ends with</option>
                  <option value="equals">Equals</option>
                </select>
              </label>
              <label className={labelClass}>Value
                <input autoFocus type="text" value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.target.value })} className={inputClass} />
              </label>
            </div>
          )}

          {draft.kind === 'boolean' && (
            <label className={labelClass}>Value
              <select autoFocus value={String(draft.value)} onChange={(event) => setDraft({ ...draft, value: event.target.value === 'true' })} className={inputClass}>
                <option value="true">True</option>
                <option value="false">False</option>
              </select>
            </label>
          )}

          {draft.kind === 'null' && (
            <label className={labelClass}>Condition
              <select autoFocus value={draft.isNull ? 'null' : 'not-null'} onChange={(event) => setDraft({ ...draft, isNull: event.target.value === 'null' })} className={inputClass}>
                <option value="null">Is null</option>
                <option value="not-null">Is not null</option>
              </select>
            </label>
          )}

          {(draft.kind === 'category' || draft.kind === 'range' || draft.kind === 'temporal') && (
            <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
              <input type="checkbox" checked={Boolean(draft.includeNull)} onChange={(event) => setDraft({ ...draft, includeNull: event.target.checked })} className="h-4 w-4 rounded border-slate-300 accent-sky-600" />
              Include null or missing values
            </label>
          )}

          {draft.kind === 'text' && (
            <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
              <input type="checkbox" checked={Boolean(draft.caseSensitive)} onChange={(event) => setDraft({ ...draft, caseSensitive: event.target.checked })} className="h-4 w-4 rounded border-slate-300 accent-sky-600" />
              Case sensitive
            </label>
          )}
        </div>

        <footer className="flex items-center justify-between border-t bg-slate-50 px-4 py-3">
          {onRemove ? (
            <button type="button" onClick={onRemove} className="pressable inline-flex items-center gap-1.5 rounded-md px-2 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50">
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className="pressable rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
            <button type="button" disabled={!isVisualFilterValid(draft)} onClick={() => onApply(draft)} className="pressable rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40">Apply filter</button>
          </div>
        </footer>
      </section>
    </div>
  );
};

