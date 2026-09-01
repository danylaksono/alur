import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, FunctionSquare, Pencil, Plus, Trash2, X } from 'lucide-react';
import {
  applyComputedFields,
  FIELD_CALCULATOR_FUNCTIONS,
  validateComputedField,
  type ComputedField,
} from '../utils/fieldCalculator';

type FieldCalculatorDialogProps = {
  fields: ComputedField[];
  availableColumns: string[];
  sampleRows: Record<string, unknown>[];
  onAdd: (field: Omit<ComputedField, 'id'>) => void;
  onUpdate: (id: string, field: Omit<ComputedField, 'id'>) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
};

const EMPTY_DRAFT = { name: '', expression: '' };

const formatValue = (value: unknown) => {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return String(value);
};

export const FieldCalculatorDialog = ({
  fields,
  availableColumns,
  sampleRows,
  onAdd,
  onUpdate,
  onDelete,
  onClose,
}: FieldCalculatorDialogProps) => {
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fieldSearch, setFieldSearch] = useState('');
  const expressionRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const validation = useMemo(
    () => validateComputedField({ id: editingId ?? undefined, ...draft }, availableColumns, fields),
    [availableColumns, draft, editingId, fields],
  );
  const filteredColumns = useMemo(() => {
    const query = fieldSearch.trim().toLowerCase();
    return query ? availableColumns.filter((column) => column.toLowerCase().includes(query)) : availableColumns;
  }, [availableColumns, fieldSearch]);
  const preview = useMemo(() => {
    if (!draft.name.trim() || !draft.expression.trim()) return [];
    const field: ComputedField = { id: editingId || 'preview', name: draft.name.trim(), expression: draft.expression.trim() };
    return applyComputedFields(sampleRows.slice(0, 5), [field]).map((row, index) => ({
      key: String(row._alur_feature_id ?? index),
      value: row[field.name],
    }));
  }, [draft, editingId, sampleRows]);

  const reset = () => {
    setDraft(EMPTY_DRAFT);
    setEditingId(null);
  };
  const insertField = (column: string) => {
    const element = expressionRef.current;
    const start = element?.selectionStart ?? draft.expression.length;
    const end = element?.selectionEnd ?? draft.expression.length;
    const prefix = start > 0 && !/[\s(,+\-*/%<>=!]$/.test(draft.expression.slice(0, start)) ? ' ' : '';
    const token = `${prefix}${column}`;
    setDraft((current) => ({
      ...current,
      expression: current.expression.slice(0, start) + token + current.expression.slice(end),
    }));
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
  };
  const save = () => {
    if (!validation.ok) return;
    const value = { name: draft.name.trim(), expression: draft.expression.trim() };
    if (editingId) onUpdate(editingId, value);
    else onAdd(value);
    reset();
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="field-calculator-title"
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div className="flex min-w-0 gap-2.5">
            <FunctionSquare className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
            <div>
              <h2 id="field-calculator-title" className="text-sm font-bold text-slate-800">Field calculator</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Add calculated columns to this table view. Values are evaluated safely without running arbitrary code.
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close field calculator" className="pressable rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-5 overflow-auto p-5">
          {fields.length > 0 && (
            <section aria-label="Computed fields" className="space-y-2">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Computed fields</h3>
              {fields.map((field) => (
                <div key={field.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                  <span className="font-bold text-slate-800">{field.name}</span>
                  <code className="min-w-0 flex-1 truncate text-slate-500" title={field.expression}>{field.expression}</code>
                  <button
                    type="button"
                    aria-label={`Edit computed field ${field.name}`}
                    onClick={() => { setEditingId(field.id); setDraft({ name: field.name, expression: field.expression }); }}
                    className="pressable rounded border border-slate-200 bg-white p-1.5 text-slate-500 hover:text-slate-800"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button type="button" aria-label={`Delete computed field ${field.name}`} onClick={() => onDelete(field.id)} className="pressable rounded border border-slate-200 bg-white p-1.5 text-slate-500 hover:text-rose-600">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </section>
          )}

          <section aria-label={editingId ? 'Edit computed field' : 'New computed field'} className="space-y-3">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{editingId ? 'Edit field' : 'New field'}</h3>
            <label className="block space-y-1 text-xs font-semibold text-slate-700">
              <span>Field name</span>
              <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. cost_per_hectare" className="h-9 w-full rounded-md border border-slate-200 px-2.5 font-mono text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100" />
            </label>
            <label className="block space-y-1 text-xs font-semibold text-slate-700">
              <span>Expression</span>
              <textarea ref={expressionRef} value={draft.expression} onChange={(event) => setDraft((current) => ({ ...current, expression: event.target.value }))} placeholder="e.g. population / area" rows={3} className="w-full resize-y rounded-md border border-slate-200 px-2.5 py-2 font-mono text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100" />
            </label>

            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-700">Available fields</span>
                <input value={fieldSearch} onChange={(event) => setFieldSearch(event.target.value)} aria-label="Filter available fields" placeholder="Filter…" className="h-6 w-28 rounded border border-slate-200 px-1.5 text-[11px] outline-none" />
              </div>
              <div className="flex max-h-24 flex-wrap gap-1 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-1.5">
                {filteredColumns.map((column) => (
                  <button key={column} type="button" onClick={() => insertField(column)} className="pressable rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-600 hover:border-slate-400">
                    {column}
                  </button>
                ))}
                {!filteredColumns.length && <span className="px-1 text-[11px] text-slate-400">No matching fields</span>}
              </div>
            </div>

            {(draft.name || draft.expression) && validation.errors.length > 0 && (
              <ul role="alert" className="space-y-0.5 text-xs text-rose-600">
                {validation.errors.map((error) => <li key={error}>{error}</li>)}
              </ul>
            )}
            {validation.warnings.length > 0 && (
              <ul className="space-y-0.5 text-xs text-amber-600">
                {validation.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            )}

            {preview.length > 0 && (
              <div className="overflow-hidden rounded-md border border-slate-200">
                <div className="bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Preview · loaded rows</div>
                {preview.map((row) => (
                  <div key={row.key} className="flex justify-between border-t border-slate-100 px-2 py-1 font-mono text-xs">
                    <span className="text-slate-400">{row.key}</span>
                    <span className={row.value == null ? 'italic text-slate-400' : 'text-slate-700'}>{formatValue(row.value)}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <button type="button" onClick={save} disabled={!validation.ok} className="pressable inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">
                <Plus className="h-3.5 w-3.5" /> {editingId ? 'Save changes' : 'Add field'}
              </button>
              {(editingId || draft.name || draft.expression) && <button type="button" onClick={reset} className="pressable rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600">Cancel</button>}
            </div>

            <details className="text-xs text-slate-500">
              <summary className="inline-flex cursor-pointer items-center gap-1 font-semibold"><ChevronDown className="h-3 w-3" /> Expression reference</summary>
              <div className="mt-2 space-y-1.5 rounded-md bg-slate-50 p-2.5">
                <p>Operators: <code>+ − * / %</code>, comparisons <code>&gt; &gt;= &lt; &lt;= == !=</code>, and <code>and or not</code>.</p>
                <p className="font-mono">{FIELD_CALCULATOR_FUNCTIONS.map((item) => item.signature).join(' · ')}</p>
              </div>
            </details>
          </section>
        </div>
      </div>
    </div>
  );
};
