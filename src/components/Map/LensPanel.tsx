import { Aperture, X } from 'lucide-react';
import { cn } from '../../utils/cn';
import type { LensConfig } from '../../services/lensService';

/**
 * The lens's own controls.
 *
 * Not a section of the layer's style, deliberately. A style persists in the
 * project and drives the legend; a lens is a place you point at, and its
 * settings would be strange things to save next to fill colour and opacity.
 * What it does borrow from the layer is the vocabulary — every field on offer
 * is that layer's, and the panel is empty of meaning without one.
 *
 * It appears with the lens and leaves with it, which is also what keeps it
 * honest about being an instrument rather than a workspace.
 */

const HEADING = 'block text-[10px] font-bold uppercase tracking-wider text-slate-500';
const SELECT =
  'mt-1 h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 outline-none focus:border-violet-400';

/** A pair of mutually exclusive buttons, for the two-option choices. */
const Toggle = <T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; title: string }>;
  onChange: (value: T) => void;
}) => (
  <div>
    <span className={HEADING}>{label}</span>
    <div className="mt-1 flex rounded-md border border-slate-200 p-0.5" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          title={option.title}
          onClick={() => onChange(option.value)}
          className={cn(
            'pressable flex-1 rounded px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50',
            value === option.value && 'bg-violet-100 text-violet-800 hover:bg-violet-100',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  </div>
);

export const LensPanel = ({
  config,
  fields,
  groupFields,
  categoryCount,
  onChange,
  onClose,
}: {
  config: LensConfig;
  /** Numeric fields on the layer the lens reads. */
  fields: string[];
  /** Text fields it can group by. */
  groupFields: string[];
  /** Categories actually found, once a lens has been placed. */
  categoryCount: number;
  onChange: (patch: Partial<LensConfig>) => void;
  onClose: () => void;
}) => {
  const grouped = Boolean(config.groupField);
  return (
    <aside
      className="pointer-events-auto absolute left-3 top-[3.75rem] z-10 w-60 space-y-2.5 rounded-lg border border-violet-200 bg-white/95 p-3 shadow-lg backdrop-blur"
      aria-label="Lens settings"
    >
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-violet-700">
          <Aperture className="h-3.5 w-3.5" aria-hidden="true" />
          Lens
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Put the lens away"
          title="Put the lens away (Esc)"
          className="pressable rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <label className="block">
        <span className={HEADING}>Bars are</span>
        <select
          value={config.groupField ?? ''}
          onChange={(event) => onChange({ groupField: event.target.value || null })}
          className={SELECT}
          disabled={groupFields.length === 0}
        >
          <option value="">Compass sectors</option>
          {groupFields.map((field) => (
            <option key={field} value={field}>
              {field}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className={HEADING}>Measuring</span>
        <select
          value={config.field ?? ''}
          onChange={(event) => onChange({ field: event.target.value || null })}
          className={SELECT}
        >
          <option value="">How many points</option>
          {fields.map((field) => (
            <option key={field} value={field}>
              {field}
            </option>
          ))}
        </select>
      </label>

      {config.field && (
        <Toggle
          label="Aggregated as"
          value={config.statistic}
          onChange={(statistic) => onChange({ statistic })}
          options={[
            { value: 'total', label: 'Total', title: 'Summed over the points in each bar — an extensive quantity' },
            { value: 'mean', label: 'Mean', title: 'Averaged over the points in each bar — an intensive quantity, like a rate' },
          ]}
        />
      )}

      <label className="block">
        <span className={HEADING}>Shown as</span>
        <select
          value={config.normalisation}
          onChange={(event) => onChange({ normalisation: event.target.value as LensConfig['normalisation'] })}
          className={SELECT}
        >
          <option value="count">Raw value</option>
          <option value="share">Share of the lens</option>
          <option value="density">Per km²</option>
          <option value="lq">Unusual for around here</option>
        </select>
      </label>

      {/* The morph only means something when bars have an identity to keep as
          they move. Compass sectors already are their direction. */}
      {grouped && (
        <label className="block">
          <span className={HEADING}>Arrange</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={config.morph}
            onChange={(event) => onChange({ morph: Number(event.target.value) })}
            className="mt-1.5 w-full accent-violet-600"
            aria-label="Arrange bars between category order and true bearing"
          />
          <span className="mt-0.5 flex justify-between text-[10px] text-slate-500">
            <span>Grouped</span>
            <span>By bearing</span>
          </span>
        </label>
      )}

      <p className="border-t border-slate-100 pt-2 text-[10px] leading-snug text-slate-500">
        {config.normalisation === 'lq'
          ? 'Against the ring of points just outside the lens. Above 1 means this neighbourhood has more than its surroundings do.'
          : grouped
            ? `${categoryCount || 'No'} ${categoryCount === 1 ? 'category' : 'categories'} in view${categoryCount ? ', most common first' : ''}.`
            : 'One bar per compass sector: which way it lies from here.'}
      </p>
    </aside>
  );
};
