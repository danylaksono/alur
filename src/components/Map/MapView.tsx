import { useEffect, useRef, useState, useCallback } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useStore } from '../../store/useStore';
import { cn } from '../../utils/cn';

const LAYER_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

function getLayerBounds(geojson: GeoJSON.FeatureCollection) {
  const coords: [number, number][] = [];
  const isValidLon = (v: number) => v >= -180 && v <= 180;
  const isValidLat = (v: number) => v >= -90 && v <= 90;
  const normalize = (pt: any): [number, number] | null => {
    if (!Array.isArray(pt) || pt.length < 2) return null;
    const lon = Number(pt[0]), lat = Number(pt[1]);
    if (Number.isNaN(lon) || Number.isNaN(lat)) return null;
    if (isValidLon(lon) && isValidLat(lat)) return [lon, lat];
    if (isValidLon(lat) && isValidLat(lon)) return [lat, lon];
    return null;
  };
  const collect = (g: GeoJSON.Geometry | null) => {
    if (!g) return;
    switch (g.type) {
      case 'Point': { const n = normalize(g.coordinates); if (n) coords.push(n); break; }
      case 'LineString': case 'MultiPoint': (g.coordinates as any[]).forEach((p) => { const n = normalize(p); if (n) coords.push(n); }); break;
      case 'Polygon': case 'MultiLineString': (g.coordinates as any[]).flat(1).forEach((p) => { const n = normalize(p); if (n) coords.push(n); }); break;
      case 'MultiPolygon': (g.coordinates as any[]).flat(2).forEach((p) => { const n = normalize(p); if (n) coords.push(n); }); break;
      case 'GeometryCollection': g.geometries.forEach(collect); break;
    }
  };
  geojson.features.forEach((f) => collect(f.geometry));
  if (!coords.length) return null;
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const [lon, lat] of coords) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  if (!isValidLon(minLon) || !isValidLat(minLat) || !isValidLon(maxLon) || !isValidLat(maxLat)) return null;
  return [[minLon, minLat], [maxLon, maxLat]] as [[number, number], [number, number]];
}

function formatPopupValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return value.toLocaleString();
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 100);
  return String(value).slice(0, 80);
}

export const MapView = () => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const popup = useRef<maplibregl.Popup | null>(null);
  const renderedLayerIds = useRef<Set<string>>(new Set());
  const nodeLayerMap = useRef<Map<string, string>>(new Map());
  const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>({});

  const mapLayers = useStore((s) => s.mapLayers);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const setSelectedNodeId = useStore((s) => s.setSelectedNodeId);

  // Init map once
  useEffect(() => {
    if (!mapContainer.current || map.current) return;
    const m = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      center: [-74.006, 40.7128],
      zoom: 12,
    });
    m.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.current = m;

    popup.current = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: false,
      maxWidth: '300px',
    });

    return () => {
      m.remove();
      map.current = null;
      popup.current = null;
    };
  }, []);

  // Sync layers from store to map
  useEffect(() => {
    const m = map.current;
    if (!m) return;

    const syncLayers = () => {
      if (!m.isStyleLoaded()) { m.once('load', syncLayers); return; }

      // Remove stale layers
      const currentIds = new Set(mapLayers.map((l) => l.id));
      renderedLayerIds.current.forEach((rid) => {
        if (!currentIds.has(rid)) {
          const layerId = `input-layer-${rid}`;
          const sourceId = `input-source-${rid}`;
          if (m.getLayer(layerId)) m.removeLayer(layerId);
          if (m.getSource(sourceId)) m.removeSource(sourceId);
          renderedLayerIds.current.delete(rid);
        }
      });

      // Add/update current layers
      mapLayers.forEach((layer, idx) => {
        const sourceId = `input-source-${layer.id}`;
        const layerId = `input-layer-${layer.id}`;
        const color = layer.color || LAYER_COLORS[idx % LAYER_COLORS.length];

        const existingSource = m.getSource(sourceId) as maplibregl.GeoJSONSource | null;
        if (existingSource) {
          existingSource.setData(layer.geojson as any);
          return;
        }

        m.addSource(sourceId, { type: 'geojson', data: layer.geojson });

        const geomType = layer.geojson.features?.[0]?.geometry?.type || 'Point';
        const isPoint = geomType.includes('Point');
        const isLine = geomType.includes('Line');
        const type = isPoint ? 'circle' : isLine ? 'line' : 'fill';

        const paint: any = isPoint
          ? { 'circle-radius': 4, 'circle-color': color, 'circle-opacity': 0.8, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 0.5 }
          : isLine
          ? { 'line-color': color, 'line-width': 2, 'line-opacity': 0.8 }
          : { 'fill-color': color, 'fill-opacity': 0.25, 'fill-outline-color': color };

        m.addLayer({ id: layerId, type: type as any, source: sourceId, paint });

        // Click handler
        m.on('click', layerId, (e) => {
          const feature = e.features?.[0];
          if (!feature) return;

          const srcNodeId = layer.sourceNodeId;
          if (srcNodeId) setSelectedNodeId(srcNodeId);

          // Build popup
          const props = feature.properties || {};
          const entries = Object.entries(props).slice(0, 8);
          let html = entries.map(([k, v]) =>
            `<div style="display:flex;justify-content:space-between;gap:8px;font:11px/1.5 monospace">
              <span style="font-weight:600;color:#475569">${k}</span>
              <span style="color:#1e293b;text-align:right;max-width:160px;overflow:hidden;text-overflow:ellipsis">${formatPopupValue(v)}</span>
            </div>`
          ).join('');
          if (Object.keys(props).length > 8) html += `<div style="font:10px monospace;color:#94a3b8;margin-top:4px">+ ${Object.keys(props).length - 8} more fields</div>`;
          html = `<div style="font:10px/1.4 sans-serif;font-weight:700;color:#6366f1;margin-bottom:4px">${layer.name}</div>${html}`;

          popup.current?.setLngLat(e.lngLat).setHTML(html).addTo(m);
        });

        // Cursor
        m.on('mouseenter', layerId, () => { m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', layerId, () => { m.getCanvas().style.cursor = ''; });

        if (layer.sourceNodeId) {
          nodeLayerMap.current.set(layer.sourceNodeId, layer.id);
        }

        renderedLayerIds.current.add(layer.id);
      });
    };

    syncLayers();
  }, [mapLayers, setSelectedNodeId]);

  // Track layer visibility changes
  useEffect(() => {
    setLayerVisibility((prev) => {
      const next = { ...prev };
      mapLayers.forEach((l) => { if (!(l.id in next)) next[l.id] = true; });
      return next;
    });
  }, [mapLayers]);

  // Node selection → zoom & highlight
  useEffect(() => {
    const m = map.current;
    if (!m) return;

    const selectedLayerId = selectedNodeId ? nodeLayerMap.current.get(selectedNodeId) : null;

    mapLayers.forEach((layer) => {
      const layerId = `input-layer-${layer.id}`;
      if (!m.getLayer(layerId)) return;

      const isSelected = layer.id === selectedLayerId;

      const geomType = layer.geojson.features?.[0]?.geometry?.type || 'Point';
      const isPoint = geomType.includes('Point');
      const isLine = geomType.includes('Line');

      if (isSelected) {
        m.setPaintProperty(layerId, isPoint ? 'circle-opacity' : isLine ? 'line-opacity' : 'fill-opacity', isPoint ? 1 : isLine ? 1 : 0.4);
        m.setPaintProperty(layerId, isPoint ? 'circle-radius' : isLine ? 'line-width' : 'fill-outline-color', isPoint ? 6 : isLine ? 3 : '#000');
        const bounds = getLayerBounds(layer.geojson);
        if (bounds) m.fitBounds(bounds, { padding: 50, duration: 600, maxZoom: 16 });
      } else {
        m.setPaintProperty(layerId, isPoint ? 'circle-opacity' : isLine ? 'line-opacity' : 'fill-opacity', selectedLayerId ? (isPoint ? 0.2 : isLine ? 0.2 : 0.08) : isPoint ? 0.8 : isLine ? 0.8 : 0.25);
        m.setPaintProperty(layerId, isPoint ? 'circle-radius' : isLine ? 'line-width' : 'fill-outline-color', isPoint ? 4 : isLine ? 2 : undefined);
      }
    });
  }, [selectedNodeId, mapLayers]);

  const toggleLayer = useCallback((layerId: string) => {
    setLayerVisibility((prev) => {
      const next = { ...prev, [layerId]: !prev[layerId] };
      const m = map.current;
      if (m) {
        const mapLayerId = `input-layer-${layerId}`;
        const visible = next[layerId];
        if (m.getLayer(mapLayerId)) {
          m.setLayoutProperty(mapLayerId, 'visibility', visible ? 'visible' : 'none');
        }
      }
      return next;
    });
  }, []);

  return (
    <div className="w-full h-full relative">
      <div ref={mapContainer} className="w-full h-full" />

      <div className="absolute top-4 left-4 bg-white/90 backdrop-blur p-4 rounded-xl shadow-xl border border-border pointer-events-auto max-w-xs z-50 min-w-[200px]">
        <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">Layer Stack</h4>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 text-foreground font-medium">
              <div className="w-2 h-2 rounded-full bg-blue-500" /> Basemap
            </span>
            <span className="text-muted-foreground italic font-mono text-[10px]">active</span>
          </div>
          {mapLayers.length ? (
            mapLayers.map((layer) => {
              const idx = mapLayers.indexOf(layer);
              const color = layer.color || LAYER_COLORS[idx % LAYER_COLORS.length];
              const isSelected = layer.sourceNodeId === selectedNodeId;
              return (
                <div
                  key={layer.id}
                  className={cn(
                    'rounded-xl border p-2 text-[10px] cursor-pointer transition-colors',
                    isSelected ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                  )}
                  onClick={() => setSelectedNodeId(isSelected ? null : (layer.sourceNodeId || null))}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <input
                        type="checkbox"
                        checked={layerVisibility[layer.id] ?? true}
                        onChange={() => toggleLayer(layer.id)}
                        className="shrink-0 w-3 h-3 accent-indigo-500"
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span className="font-semibold text-slate-900 truncate">{layer.name}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-1 ml-5">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <span className="text-muted-foreground uppercase tracking-[0.15em]">
                      {layer.geojson.features.length.toLocaleString()} features
                    </span>
                    {isSelected && <span className="text-indigo-600 font-bold text-[9px]">SELECTED</span>}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-2 text-[10px] text-muted-foreground">
              No input layers loaded yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
