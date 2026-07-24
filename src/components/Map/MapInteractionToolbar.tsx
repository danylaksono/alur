import { BoxSelect, Crosshair, Home, MousePointer2 } from 'lucide-react';
import { cn } from '../../utils/cn';

export const MapInteractionToolbar = ({
  selectionMode,
  hasLayer,
  coordinates,
  onToggleSelection,
  onHome,
  onCopyCoordinates,
}: {
  selectionMode: boolean;
  hasLayer: boolean;
  coordinates: string;
  onToggleSelection: () => void;
  onHome: () => void;
  onCopyCoordinates: () => void;
}) => (
  <>
    <div className="pointer-events-auto absolute right-2.5 top-24 z-20 flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-md">
      <button type="button" onClick={onToggleSelection} disabled={!hasLayer} aria-pressed={selectionMode} aria-label={selectionMode ? 'Return to map navigation' : 'Box select features'} title={selectionMode ? 'Navigation mode (Esc)' : 'Box select features'} className={cn('flex h-9 w-9 items-center justify-center border-b border-slate-100 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35', selectionMode && 'bg-orange-50 text-orange-700')}>
        {selectionMode ? <MousePointer2 className="h-4 w-4" /> : <BoxSelect className="h-4 w-4" />}
      </button>
      <button type="button" onClick={onHome} disabled={!hasLayer} aria-label="Zoom to active layer" title="Zoom to active layer" className="flex h-9 w-9 items-center justify-center text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35">
        <Home className="h-4 w-4" />
      </button>
    </div>
    {selectionMode && (
      <div className="pointer-events-none absolute right-14 top-24 z-20 rounded-md border border-orange-200 bg-white/95 px-2.5 py-2 text-[11px] font-medium text-slate-600 shadow backdrop-blur">
        Drag to select · Shift add · Alt subtract · Esc exit
      </div>
    )}
    {coordinates && (
      <button type="button" onClick={onCopyCoordinates} className="pointer-events-auto absolute bottom-2.5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-md border border-slate-200 bg-white/90 px-2 py-1 font-mono text-[10px] tabular-nums text-slate-500 shadow-sm backdrop-blur hover:bg-white hover:text-slate-800" title="Copy pointer coordinates">
        <Crosshair className="h-3 w-3" /> {coordinates}
      </button>
    )}
  </>
);

