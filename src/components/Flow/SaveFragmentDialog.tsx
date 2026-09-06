import { useMemo, useState } from 'react';
import { Package, Plus, X } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { cn } from '../../utils/cn';
import {
  fragmentErrors,
  fragmentFromSelection,
  fragmentWarnings,
  placeholdersUsed,
  type FragmentParameter,
  type FragmentParameterType,
} from '../../utils/workflowFragments';

const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200';

/**
 * Turns a selected run of steps into a named operation.
 *
 * The values are found rather than declared: whatever `{{name}}` placeholders
 * the author has written into the selected steps show up here to be labelled
 * and typed. That way the flow is "edit the steps until they read the way you
 * want, then say what the blanks mean", instead of designing a signature up
 * front against nothing.
 */
export const SaveFragmentDialog = ({ selectedIds, onClose }: { selectedIds: string[]; onClose: () => void }) => {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const saveFragment = useStore((s) => s.saveFragment);
  const addToast = useStore((s) => s.addToast);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [parameters, setParameters] = useState<FragmentParameter[]>(() => {
    const selected = new Set(selectedIds);
    return placeholdersUsed({ nodes: nodes.filter((node) => selected.has(node.id)) })
      .map((id) => ({ id, label: id.replace(/_/g, ' '), type: 'number' as FragmentParameterType }));
  });

  const draft = useMemo(() => {
    try {
      return {
        fragment: fragmentFromSelection(nodes, edges, selectedIds, {
          id: `fragment-${Date.now()}`,
          name,
          description,
          parameters,
          createdAt: Date.now(),
        }),
        shapeError: null as string | null,
      };
    } catch (err: any) {
      return { fragment: null, shapeError: err?.message || 'This selection cannot be saved as one operation.' };
    }
  }, [nodes, edges, selectedIds, name, description, parameters]);

  const errors = draft.fragment ? fragmentErrors(draft.fragment) : draft.shapeError ? [draft.shapeError] : [];
  const warnings = draft.fragment ? fragmentWarnings(draft.fragment) : [];

  const updateParameter = (index: number, patch: Partial<FragmentParameter>) =>
    setParameters(parameters.map((item, position) => (position === index ? { ...item, ...patch } : item)));

  const save = () => {
    if (!draft.fragment || errors.length) return;
    saveFragment(draft.fragment);
    addToast({ type: 'success', message: `Saved "${draft.fragment.name}" as an operation. It is in the node palette.` });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Save as operation"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
            <Package className="h-4 w-4 text-cyan-600" />
            Save {selectedIds.length} step{selectedIds.length === 1 ? '' : 's'} as an operation
          </h2>
          <button type="button" onClick={onClose} className="pressable rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto px-4 py-4">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-slate-600">Name</span>
            <input
              autoFocus
              className={inputClass}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Retrofit"
              maxLength={60}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-slate-600">What it does</span>
            <input
              className={inputClass}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Raises a chosen column by a fixed amount"
              maxLength={160}
            />
          </label>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-600">Values it asks for</span>
              <span className="text-[11px] text-slate-500">Write <code>{'{{name}}'}</code> in a step to add one</span>
            </div>

            {parameters.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-[11px] leading-5 text-slate-500">
                This operation has no blanks to fill in — it will always do exactly what the selected steps do.
                To make it reusable, put <code>{'{{amount}}'}</code> where a number should go, or
                {' '}<code>{'{{column}}'}</code> where a column name should go, then reopen this.
              </p>
            ) : (
              <div className="space-y-2">
                {parameters.map((parameter, index) => (
                  <div key={parameter.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                    <div className="flex items-center gap-2">
                      <code className="shrink-0 rounded bg-white px-1.5 py-0.5 text-[11px] font-semibold text-cyan-700">{`{{${parameter.id}}}`}</code>
                      <input
                        className={cn(inputClass, 'flex-1 py-1')}
                        value={parameter.label}
                        onChange={(event) => updateParameter(index, { label: event.target.value })}
                        placeholder="Label"
                        aria-label={`Label for ${parameter.id}`}
                      />
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <select
                        className={cn(inputClass, 'py-1')}
                        value={parameter.type}
                        onChange={(event) => updateParameter(index, { type: event.target.value as FragmentParameterType })}
                        aria-label={`Type for ${parameter.id}`}
                      >
                        <option value="number">A number</option>
                        <option value="field">A column</option>
                        <option value="choice">One of a list</option>
                      </select>
                      <input
                        className={cn(inputClass, 'py-1')}
                        value={String(parameter.defaultValue ?? '')}
                        onChange={(event) => updateParameter(index, { defaultValue: event.target.value })}
                        placeholder="Default (optional)"
                        aria-label={`Default for ${parameter.id}`}
                      />
                    </div>
                    {parameter.type === 'choice' && (
                      <input
                        className={cn(inputClass, 'mt-2 py-1')}
                        value={(parameter.options || []).join(', ')}
                        onChange={(event) => updateParameter(index, { options: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })}
                        placeholder="Allowed values, comma separated"
                        aria-label={`Options for ${parameter.id}`}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => setParameters([...parameters, { id: `value_${parameters.length + 1}`, label: `Value ${parameters.length + 1}`, type: 'number' }])}
              className="pressable mt-2 flex items-center gap-1 rounded px-1 text-[11px] font-semibold text-cyan-700 hover:bg-cyan-50"
            >
              <Plus className="h-3 w-3" /> Add a value by hand
            </button>
          </div>

          {/* Free text is not offered on purpose: a value is interpolated into
              SQL, so only shapes that can be validated are allowed. */}
          <p className="text-[11px] leading-4 text-slate-500">
            Numbers must be numbers, and columns must be plain column names. That is checked before the operation runs.
          </p>

          {errors.map((message) => <p key={message} className="text-[11px] font-medium text-rose-600">{message}</p>)}
          {warnings.map((message) => <p key={message} className="text-[11px] text-amber-700">{message}</p>)}
        </div>

        <div className="flex items-center justify-end gap-2 border-t bg-slate-50 px-4 py-3">
          <button type="button" onClick={onClose} className="pressable rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100">Cancel</button>
          <button
            type="button"
            onClick={save}
            disabled={errors.length > 0 || !name.trim()}
            className="pressable rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save operation
          </button>
        </div>
      </div>
    </div>
  );
};
