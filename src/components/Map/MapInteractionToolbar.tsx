import { BoxSelect, Camera, Check, Crosshair, Expand, Home, Loader2, LocateFixed, Map as MapIcon, Minus, MousePointer2, Navigation, Plus, Scan } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../utils/cn';
import { BASEMAPS } from '../../utils/basemaps';
import { useStore } from '../../store/useStore';
import { pinMapEvidence } from '../../services/explainCapture';

export const MapInteractionToolbar = ({
  selectionMode,
  hasLayer,
  hasSelection,
  coordinates,
  bearing,
  pitch,
  zoom,
  onToggleSelection,
  onHome,
  onZoomSelection,
  onResetNorth,
  onCopyCoordinates,
  onZoomIn,
  onZoomOut,
  onGeolocate,
  onFullscreen,
}: {
  selectionMode: boolean;
  hasLayer: boolean;
  hasSelection: boolean;
  coordinates: string;
  bearing: number;
  pitch: number;
  zoom: number;
  onToggleSelection: () => void;
  onHome: () => void;
  onZoomSelection: () => void;
  onResetNorth: () => void;
  onCopyCoordinates: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onGeolocate: () => void;
  onFullscreen: () => void;
}) => {
  const [basemapsOpen, setBasemapsOpen] = useState(false);
  const [isPinning, setPinning] = useState(false);
  // Only surfaced once the map is actually off north or tilted: an always-on
  // compass reading 0° is chrome that never earns its square.
  const isOriented = Math.abs(bearing) >= 0.5 || pitch >= 0.5;
  const selectedBasemapId = useStore((state) => state.selectedBasemapId);
  const setSelectedBasemapId = useStore((state) => state.setSelectedBasemapId);
  return (
  <>
    <div className="pointer-events-auto absolute right-2.5 top-3 z-20 flex flex-col rounded-lg border border-slate-200 bg-white shadow-md" aria-label="Map controls">
      <button type="button" onClick={onZoomIn} aria-label="Zoom in" className="pressable flex h-9 w-9 items-center justify-center border-b border-slate-100 text-slate-600 hover:bg-slate-50"><Plus className="h-4 w-4" /></button>
      <button type="button" onClick={onZoomOut} aria-label="Zoom out" className="pressable flex h-9 w-9 items-center justify-center border-b border-slate-100 text-slate-600 hover:bg-slate-50"><Minus className="h-4 w-4" /></button>
      <button type="button" onClick={onToggleSelection} disabled={!hasLayer} aria-pressed={selectionMode} aria-label={selectionMode ? 'Return to map navigation' : 'Box select features'} title={selectionMode ? 'Navigation mode (Esc)' : 'Box select features'} className={cn('pressable flex h-9 w-9 items-center justify-center border-b border-slate-100 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35', selectionMode && 'bg-orange-50 text-orange-700')}>
        {selectionMode ? <MousePointer2 className="h-4 w-4" /> : <BoxSelect className="h-4 w-4" />}
      </button>
      <button type="button" onClick={onHome} disabled={!hasLayer} aria-label="Zoom to active layer" title="Zoom to active layer" className="pressable flex h-9 w-9 items-center justify-center border-b border-slate-100 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35">
        <Home className="h-4 w-4" />
      </button>
      <button type="button" onClick={onZoomSelection} disabled={!hasSelection} aria-label="Zoom to selection" title="Zoom to selection" className="pressable flex h-9 w-9 items-center justify-center border-b border-slate-100 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35">
        <Scan className="h-4 w-4" />
      </button>
      {isOriented && (
        <button
          type="button"
          onClick={onResetNorth}
          aria-label={`Reset bearing to north (currently ${Math.round(bearing)} degrees)`}
          title={`${Math.round(Math.abs(bearing))}° ${bearing >= 0 ? 'east' : 'west'} of north${pitch >= 0.5 ? `, tilted ${Math.round(pitch)}°` : ''} — click to reset`}
          className="pressable flex h-9 w-9 items-center justify-center border-b border-slate-100 text-slate-600 hover:bg-slate-50"
        >
          {/* Rotated against the bearing, so the needle keeps pointing at true
              north while the map turns underneath it. */}
          <Navigation className="h-4 w-4 fill-current text-orange-600" style={{ transform: `rotate(${-bearing}deg)` }} />
        </button>
      )}
      <button type="button" onClick={onGeolocate} aria-label="Find my location" className="pressable flex h-9 w-9 items-center justify-center border-b border-slate-100 text-slate-600 hover:bg-slate-50"><LocateFixed className="h-4 w-4" /></button>
      <button type="button" onClick={onFullscreen} aria-label="Toggle map fullscreen" className="pressable flex h-9 w-9 items-center justify-center border-b border-slate-100 text-slate-600 hover:bg-slate-50"><Expand className="h-4 w-4" /></button>
      <button
        type="button"
        onClick={() => { setPinning(true); void pinMapEvidence().finally(() => setPinning(false)); }}
        disabled={!hasLayer || isPinning}
        aria-label="Pin this map view to your report"
        title="Pin this map view to your report"
        className="pressable flex h-9 w-9 items-center justify-center border-b border-slate-100 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35"
      >
        {isPinning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
      </button>
      <button type="button" onClick={() => setBasemapsOpen(!basemapsOpen)} aria-expanded={basemapsOpen} aria-label="Choose basemap" title="Basemap" className={cn('pressable flex h-9 w-9 items-center justify-center rounded-b-lg text-slate-600 hover:bg-slate-50', basemapsOpen && 'bg-slate-900 text-white hover:bg-slate-900')}><MapIcon className="h-4 w-4" /></button>
      {basemapsOpen && <div className="absolute right-11 top-0 w-40 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"><p className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">Basemap</p>{BASEMAPS.map((basemap) => <button key={basemap.id} type="button" onClick={() => { setSelectedBasemapId(basemap.id); setBasemapsOpen(false); }} className="pressable flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[11px] font-semibold text-slate-600 hover:bg-slate-50">{basemap.name}{selectedBasemapId === basemap.id && <Check className="h-3 w-3" />}</button>)}</div>}
    </div>
    {selectionMode && (
      <div className="pointer-events-none absolute right-14 top-3 z-20 rounded-md border border-orange-200 bg-white/95 px-2.5 py-2 text-[11px] font-medium text-slate-600 shadow backdrop-blur">
        Drag to select · Shift add · Alt subtract · Esc exit
      </div>
    )}
    {/* Zoom and CRS stay put when the pointer leaves the map; only the
        coordinates come and go with it. The scale *bar* is MapLibre's, bottom
        right — this is the numeric half it does not report. */}
    <button type="button" onClick={onCopyCoordinates} disabled={!coordinates} style={{ bottom: 'calc(0.625rem + var(--alur-map-chrome-bottom, 0px))' }} className="pressable pointer-events-auto absolute left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-md border border-slate-200 bg-white/90 px-2 py-1 font-mono text-[11px] tabular-nums text-slate-500 shadow-sm backdrop-blur enabled:hover:bg-white enabled:hover:text-slate-800" title={coordinates ? 'Copy pointer coordinates' : 'Move the pointer over the map to read a coordinate'}>
      <Crosshair className="h-3 w-3" />
      <span title="Coordinates are WGS 84 longitude and latitude">EPSG:4326</span>
      {coordinates && <span className="text-slate-700">{coordinates}</span>}
      <span className="text-slate-400" aria-hidden="true">·</span>
      <span title="Zoom level">z{zoom.toFixed(1)}</span>
    </button>
  </>
  );
};
