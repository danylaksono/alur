import { BoxSelect, Check, Crosshair, Expand, Home, LocateFixed, Map as MapIcon, Minus, MousePointer2, Plus } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../utils/cn';
import { BASEMAPS } from '../../utils/basemaps';
import { useStore } from '../../store/useStore';

export const MapInteractionToolbar = ({
  selectionMode,
  hasLayer,
  coordinates,
  onToggleSelection,
  onHome,
  onCopyCoordinates,
  onZoomIn,
  onZoomOut,
  onGeolocate,
  onFullscreen,
}: {
  selectionMode: boolean;
  hasLayer: boolean;
  coordinates: string;
  onToggleSelection: () => void;
  onHome: () => void;
  onCopyCoordinates: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onGeolocate: () => void;
  onFullscreen: () => void;
}) => {
  const [basemapsOpen, setBasemapsOpen] = useState(false);
  const selectedBasemapId = useStore((state) => state.selectedBasemapId);
  const setSelectedBasemapId = useStore((state) => state.setSelectedBasemapId);
  return (
  <>
    <div className="pointer-events-auto absolute right-2.5 top-3 z-20 flex flex-col rounded-lg border border-slate-200 bg-white shadow-md" aria-label="Map controls">
      <button type="button" onClick={onZoomIn} aria-label="Zoom in" className="flex h-9 w-9 items-center justify-center border-b border-slate-100 text-slate-600 hover:bg-slate-50"><Plus className="h-4 w-4" /></button>
      <button type="button" onClick={onZoomOut} aria-label="Zoom out" className="flex h-9 w-9 items-center justify-center border-b border-slate-100 text-slate-600 hover:bg-slate-50"><Minus className="h-4 w-4" /></button>
      <button type="button" onClick={onToggleSelection} disabled={!hasLayer} aria-pressed={selectionMode} aria-label={selectionMode ? 'Return to map navigation' : 'Box select features'} title={selectionMode ? 'Navigation mode (Esc)' : 'Box select features'} className={cn('flex h-9 w-9 items-center justify-center border-b border-slate-100 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35', selectionMode && 'bg-orange-50 text-orange-700')}>
        {selectionMode ? <MousePointer2 className="h-4 w-4" /> : <BoxSelect className="h-4 w-4" />}
      </button>
      <button type="button" onClick={onHome} disabled={!hasLayer} aria-label="Zoom to active layer" title="Zoom to active layer" className="flex h-9 w-9 items-center justify-center border-b border-slate-100 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35">
        <Home className="h-4 w-4" />
      </button>
      <button type="button" onClick={onGeolocate} aria-label="Find my location" className="flex h-9 w-9 items-center justify-center border-b border-slate-100 text-slate-600 hover:bg-slate-50"><LocateFixed className="h-4 w-4" /></button>
      <button type="button" onClick={onFullscreen} aria-label="Toggle map fullscreen" className="flex h-9 w-9 items-center justify-center border-b border-slate-100 text-slate-600 hover:bg-slate-50"><Expand className="h-4 w-4" /></button>
      <button type="button" onClick={() => setBasemapsOpen(!basemapsOpen)} aria-expanded={basemapsOpen} aria-label="Choose basemap" title="Basemap" className={cn('flex h-9 w-9 items-center justify-center rounded-b-lg text-slate-600 hover:bg-slate-50', basemapsOpen && 'bg-slate-900 text-white hover:bg-slate-900')}><MapIcon className="h-4 w-4" /></button>
      {basemapsOpen && <div className="absolute right-11 top-0 w-40 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"><p className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">Basemap</p>{BASEMAPS.map((basemap) => <button key={basemap.id} type="button" onClick={() => { setSelectedBasemapId(basemap.id); setBasemapsOpen(false); }} className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[11px] font-semibold text-slate-600 hover:bg-slate-50">{basemap.name}{selectedBasemapId === basemap.id && <Check className="h-3 w-3" />}</button>)}</div>}
    </div>
    {selectionMode && (
      <div className="pointer-events-none absolute right-14 top-3 z-20 rounded-md border border-orange-200 bg-white/95 px-2.5 py-2 text-[11px] font-medium text-slate-600 shadow backdrop-blur">
        Drag to select · Shift add · Alt subtract · Esc exit
      </div>
    )}
    {coordinates && (
      <button type="button" onClick={onCopyCoordinates} className="pointer-events-auto absolute bottom-9 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-md border border-slate-200 bg-white/90 px-2 py-1 font-mono text-[10px] tabular-nums text-slate-500 shadow-sm backdrop-blur hover:bg-white hover:text-slate-800 md:bottom-2.5" title="Copy pointer coordinates">
        <Crosshair className="h-3 w-3" /> {coordinates}
      </button>
    )}
  </>
  );
};
