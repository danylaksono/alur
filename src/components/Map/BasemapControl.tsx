import { useEffect, useRef, useState } from 'react';
import { Check, Map as MapIcon } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { BASEMAPS } from '../../utils/basemaps';
import { cn } from '../../utils/cn';

/** Floating basemap switcher over the map, above the attribution bar. */
export const BasemapControl = () => {
  const selectedBasemapId = useStore((s) => s.selectedBasemapId);
  const setSelectedBasemapId = useStore((s) => s.setSelectedBasemapId);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="pointer-events-auto absolute bottom-9 right-2.5 z-10 flex flex-col items-end gap-1.5">
      {open && (
        <div className="w-36 rounded-lg border border-slate-200 bg-white/95 p-1 shadow-lg backdrop-blur">
          <div className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Basemap
          </div>
          {BASEMAPS.map((basemap) => (
            <button
              key={basemap.id}
              type="button"
              onClick={() => {
                setSelectedBasemapId(basemap.id);
                setOpen(false);
              }}
              title={basemap.description}
              className={cn(
                'pressable flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors',
                basemap.id === selectedBasemapId
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              )}
            >
              {basemap.name}
              {basemap.id === selectedBasemapId && <Check className="h-3 w-3 shrink-0" />}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Basemap"
        aria-label="Basemap"
        className={cn(
          'pressable rounded-lg border border-slate-200 bg-white p-2 text-slate-600 shadow-md transition-colors hover:bg-slate-50',
          open && 'bg-slate-900 text-white hover:bg-slate-900'
        )}
      >
        <MapIcon className="h-4 w-4" />
      </button>
    </div>
  );
};
