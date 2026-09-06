import { useEffect, useRef, useState } from 'react';
import { LayoutGrid, PanelBottom, PanelLeft, PanelRight, PanelTop } from 'lucide-react';
import {
  LAYOUT_PRESETS,
  useStore,
  type DockSide,
  type LayoutPresetId,
} from '../../store/useStore';
import { cn } from '../../utils/cn';

const PRESET_ORDER = Object.keys(LAYOUT_PRESETS) as Array<Exclude<LayoutPresetId, 'custom'>>;

/** A miniature of the arrangement, so the choice is legible without reading. */
const PresetThumbnail = ({ dock, closed }: { dock: DockSide; closed: boolean }) => (
  <span
    className={cn(
      'flex h-7 w-9 shrink-0 gap-[2px] overflow-hidden rounded border border-slate-300 bg-white p-[2px]',
      dock === 'bottom' && 'flex-col',
      dock === 'top' && 'flex-col-reverse',
      dock === 'right' && 'flex-row',
      dock === 'left' && 'flex-row-reverse',
    )}
    aria-hidden="true"
  >
    <span className="flex-1 rounded-[1px] bg-teal-600/70" />
    {!closed && <span className={cn('rounded-[1px] bg-slate-300', dock === 'bottom' || dock === 'top' ? 'h-2' : 'w-3')} />}
  </span>
);

const DOCK_OPTIONS: Array<{ id: DockSide; icon: typeof PanelBottom; label: string }> = [
  { id: 'bottom', icon: PanelBottom, label: 'Dock below the map' },
  { id: 'top', icon: PanelTop, label: 'Dock above the map' },
  { id: 'left', icon: PanelLeft, label: 'Dock left of the map' },
  { id: 'right', icon: PanelRight, label: 'Dock right of the map' },
];

export const LayoutMenu = ({ expanded }: { expanded: boolean }) => {
  const layoutPreset = useStore((s) => s.ui.layoutPreset);
  const dockSide = useStore((s) => s.ui.dockSide);
  const applyLayoutPreset = useStore((s) => s.applyLayoutPreset);
  const setDockSide = useStore((s) => s.setDockSide);
  const [isOpen, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen]);

  const currentLabel = layoutPreset === 'custom' ? 'Custom' : LAYOUT_PRESETS[layoutPreset].label;

  return (
    <div ref={rootRef} className={cn('relative', expanded ? 'w-full' : '')}>
      <button
        type="button"
        onClick={() => setOpen(!isOpen)}
        className={cn(
          'pressable flex h-9 items-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700',
          expanded ? 'w-full gap-2.5 px-2.5' : 'w-9 justify-center',
        )}
        title={`Layout: ${currentLabel}`}
        aria-label={`Layout: ${currentLabel}`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <LayoutGrid className="h-4 w-4 shrink-0" />
        {expanded && <span className="truncate text-xs font-semibold">Layout</span>}
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label="Workspace layout"
          className="absolute bottom-0 left-full z-[100] ml-2 w-64 rounded-lg border border-slate-200 bg-white p-2 shadow-xl"
        >
          <p className="px-1.5 pb-1.5 text-[11px] font-bold uppercase tracking-[.14em] text-slate-500">Arrangement</p>
          {PRESET_ORDER.map((id) => {
            const spec = LAYOUT_PRESETS[id];
            const active = layoutPreset === id;
            return (
              <button
                key={id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  applyLayoutPreset(id);
                  setOpen(false);
                }}
                className={cn(
                  'pressable flex w-full items-center gap-2.5 rounded-md p-1.5 text-left transition-colors',
                  active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50',
                )}
              >
                <PresetThumbnail dock={spec.dock} closed={spec.drawerMode === 'collapsed'} />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold">{spec.label}</span>
                  <span className={cn('block text-[11px] leading-4', active ? 'text-slate-400' : 'text-slate-500')}>
                    {spec.description}
                  </span>
                </span>
              </button>
            );
          })}

          <div className="my-1.5 h-px bg-slate-100" />
          <p className="px-1.5 pb-1.5 text-[11px] font-bold uppercase tracking-[.14em] text-slate-500">
            Dock position{layoutPreset === 'custom' && <span className="ml-1 font-medium normal-case tracking-normal text-slate-500">· custom</span>}
          </p>
          <div className="flex gap-1 px-0.5">
            {DOCK_OPTIONS.map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                type="button"
                role="menuitemradio"
                aria-checked={dockSide === id}
                onClick={() => setDockSide(id)}
                className={cn(
                  'pressable flex h-8 flex-1 items-center justify-center rounded-md transition-colors',
                  dockSide === id ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100',
                )}
                title={label}
                aria-label={label}
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
