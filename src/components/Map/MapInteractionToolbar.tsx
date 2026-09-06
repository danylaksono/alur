import { BoxSelect, Camera, Check, Crosshair, Expand, Home, Loader2, LocateFixed, Map as MapIcon, Minus, MousePointer2, Navigation, Plus, Scan, Trash2, Aperture } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../utils/cn';
import { BASEMAPS, attributionFor, basemapStyleFromUrl, defaultTileSourceName, detectTileSourceKind } from '../../utils/basemaps';
import { useStore } from '../../store/useStore';
import { pinMapEvidence } from '../../services/explainCapture';

export const MapInteractionToolbar = ({
  selectionMode,
  lensMode,
  lensFields,
  lensField,
  onLensFieldChange,
  onToggleLens,
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
  lensMode: boolean;
  lensFields: string[];
  lensField: string | null;
  onLensFieldChange: (field: string | null) => void;
  onToggleLens: () => void;
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
  const [tileUrl, setTileUrl] = useState('');
  const [tileName, setTileName] = useState('');
  const [adding, setAdding] = useState(false);
  const [isPinning, setPinning] = useState(false);
  // Only surfaced once the map is actually off north or tilted: an always-on
  // compass reading 0° is chrome that never earns its square.
  const isOriented = Math.abs(bearing) >= 0.5 || pitch >= 0.5;
  const selectedBasemapId = useStore((state) => state.selectedBasemapId);
  const setSelectedBasemapId = useStore((state) => state.setSelectedBasemapId);
  const customBasemaps = useStore((state) => state.settings.customBasemaps);
  const addCustomBasemap = useStore((state) => state.addCustomBasemap);
  const removeCustomBasemap = useStore((state) => state.removeCustomBasemap);
  const addToast = useStore((state) => state.addToast);
  return (
  <>
    <div className="pointer-events-auto absolute right-2.5 top-3 z-20 flex flex-col rounded-lg border border-slate-200 bg-white shadow-md" aria-label="Map controls">
      <button type="button" onClick={onZoomIn} aria-label="Zoom in" className="pressable flex h-9 w-9 items-center justify-center border-b border-slate-100 text-slate-600 hover:bg-slate-50"><Plus className="h-4 w-4" /></button>
      <button type="button" onClick={onZoomOut} aria-label="Zoom out" className="pressable flex h-9 w-9 items-center justify-center border-b border-slate-100 text-slate-600 hover:bg-slate-50"><Minus className="h-4 w-4" /></button>
      <button type="button" onClick={onToggleSelection} disabled={!hasLayer} aria-pressed={selectionMode} aria-label={selectionMode ? 'Return to map navigation' : 'Box select features'} title={selectionMode ? 'Navigation mode (Esc)' : 'Box select features'} className={cn('pressable flex h-9 w-9 items-center justify-center border-b border-slate-100 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35', selectionMode && 'bg-orange-50 text-orange-700')}>
        {selectionMode ? <MousePointer2 className="h-4 w-4" /> : <BoxSelect className="h-4 w-4" />}
      </button>
      <button type="button" onClick={onToggleLens} disabled={!hasLayer} aria-pressed={lensMode} aria-label={lensMode ? 'Put the lens away' : 'Place a multivariate lens'} title={lensMode ? 'Click the map to place or move the lens · Esc to exit' : 'Lens: summarise what is around a point'} className={cn('pressable flex h-9 w-9 items-center justify-center border-b border-slate-100 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35', lensMode && 'bg-violet-50 text-violet-700')}>
        <Aperture className="h-4 w-4" />
      </button>
      {/* Only while the tool is armed: this is the lens's own setting, so it
          appears with the lens and leaves with it rather than living as a
          panel that is empty most of the time. */}
      {lensMode && lensFields.length > 0 && (
        <div className="absolute right-11 top-[4.5rem] w-52 rounded-lg border border-violet-200 bg-white p-1 shadow-lg">
          <p className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-violet-700">Lens reads</p>
          <div role="radiogroup" aria-label="What the lens bars measure">
            {[null, ...lensFields].map((field) => (
              <button
                key={field ?? '__count'}
                type="button"
                role="radio"
                aria-checked={lensField === field}
                onClick={() => onLensFieldChange(field)}
                title={field ? `Total ${field} in each compass sector` : 'How many points lie in each compass sector'}
                className={cn(
                  'pressable flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[11px] font-semibold text-slate-600 hover:bg-slate-50',
                  lensField === field && 'bg-violet-50 text-violet-700',
                )}
              >
                <span className="truncate">{field ?? 'Point density'}</span>
                {lensField === field && <Check className="h-3 w-3 shrink-0" />}
              </button>
            ))}
          </div>
          <p className="px-2 pb-1 pt-1 text-[10px] leading-snug text-slate-500">
            {lensField ? 'Total per compass sector.' : 'Points per compass sector.'}
          </p>
        </div>
      )}
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
      {basemapsOpen && (
        <div className="absolute right-11 top-0 w-64 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          <p className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">Basemap</p>
          {[...BASEMAPS, ...customBasemaps].map((basemap) => (
            <div key={basemap.id} className="group/basemap flex items-center gap-1">
              <button
                type="button"
                onClick={() => { setSelectedBasemapId(basemap.id); setBasemapsOpen(false); }}
                title={basemap.custom?.url || basemap.description}
                className="pressable flex min-w-0 flex-1 items-center justify-between rounded-md px-2 py-1.5 text-left text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
              >
                <span className="truncate">{basemap.name}</span>
                {selectedBasemapId === basemap.id && <Check className="h-3 w-3 shrink-0" />}
              </button>
              {basemap.custom && (
                <button
                  type="button"
                  onClick={() => removeCustomBasemap(basemap.id)}
                  title={`Remove ${basemap.name}`}
                  aria-label={`Remove ${basemap.name}`}
                  className="pressable shrink-0 rounded p-1 text-slate-400 opacity-0 hover:bg-rose-50 hover:text-rose-600 focus-visible:opacity-100 group-hover/basemap:opacity-100"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}

          <form
            className="mt-1 space-y-1 border-t border-slate-100 px-2 pb-1 pt-2"
            onSubmit={async (event) => {
              event.preventDefault();
              const url = tileUrl.trim();
              if (!url) return;
              const kind = detectTileSourceKind(url);

              // A bare vector archive has named source layers that only a style
              // document can render; adding it as raster would draw nothing and
              // say nothing, so the header is read before it is accepted.
              if (kind === 'pmtiles' && !url.toLowerCase().endsWith('.json')) {
                setAdding(true);
                try {
                  const { ensurePmtilesProtocol, inspectPmtilesArchive } = await import(
                    '../../services/pmtilesProtocol'
                  );
                  await ensurePmtilesProtocol();
                  const info = await inspectPmtilesArchive(url);
                  if (info.isVector) {
                    addToast({
                      type: 'warning',
                      message:
                        'That is a vector PMTiles archive. Add the style.json that references it instead — a vector archive has no styling of its own.',
                    });
                    return;
                  }
                } catch (error) {
                  addToast({
                    type: 'error',
                    message: `Could not read that PMTiles archive: ${
                      error instanceof Error ? error.message : 'unknown error'
                    }`,
                  });
                  return;
                } finally {
                  setAdding(false);
                }
              }

              addCustomBasemap({
                id: `custom-${Date.now()}`,
                name: tileName.trim() || defaultTileSourceName(url, kind),
                description: `${kind.toUpperCase()} · ${url}`,
                style: basemapStyleFromUrl(url, kind, attributionFor(kind)),
                custom: { url, kind },
              });
              setTileUrl('');
              setTileName('');
            }}
          >
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500" htmlFor="alur-tile-url">
              Add a tile source
            </label>
            <input
              id="alur-tile-url"
              value={tileUrl}
              onChange={(event) => setTileUrl(event.target.value)}
              placeholder="XYZ, WMS, .pmtiles, or style.json"
              className="h-7 w-full rounded border border-slate-200 px-2 text-[11px] outline-none focus:border-sky-400"
            />
            <div className="flex gap-1">
              <input
                value={tileName}
                onChange={(event) => setTileName(event.target.value)}
                placeholder="Name (optional)"
                aria-label="Tile source name"
                className="h-7 min-w-0 flex-1 rounded border border-slate-200 px-2 text-[11px] outline-none focus:border-sky-400"
              />
              <button
                type="submit"
                disabled={!tileUrl.trim() || adding}
                className="pressable h-7 shrink-0 rounded bg-slate-900 px-2 text-[11px] font-bold text-white disabled:opacity-40"
              >
                Add
              </button>
            </div>
            {tileUrl.trim() && (
              <p className="text-[11px] text-slate-500">
                Detected: {detectTileSourceKind(tileUrl).toUpperCase()}
              </p>
            )}
          </form>
        </div>
      )}
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
