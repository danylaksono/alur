import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useStore } from '../../store/useStore';
import { getBasemap } from '../../utils/basemaps';

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

  const selectedBasemapId = useStore((s) => s.selectedBasemapId);
  const mapLayers = useStore((s) => s.mapLayers);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const selectedLayerId = useStore((s) => s.selectedLayerId);
  const layerFocusRequest = useStore((s) => s.layerFocusRequest);
  const setSelectedNodeId = useStore((s) => s.setSelectedNodeId);
  const selectLayer = useStore((s) => s.selectLayer);

  // Init map once
  useEffect(() => {
    if (!mapContainer.current || map.current) return;
	    const m = new maplibregl.Map({
	      container: mapContainer.current,
	      style: getBasemap(selectedBasemapId).styleUrl,
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

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const nextStyleUrl = getBasemap(selectedBasemapId).styleUrl;
    renderedLayerIds.current.clear();
    nodeLayerMap.current.clear();
    popup.current?.remove();
    m.setStyle(nextStyleUrl);
  }, [selectedBasemapId]);

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
          nodeLayerMap.current.forEach((mappedLayerId, nodeId) => {
            if (mappedLayerId === rid) nodeLayerMap.current.delete(nodeId);
          });
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
          ? { 'circle-radius': 4, 'circle-color': color, 'circle-opacity': layer.opacity, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 0.5, 'circle-stroke-opacity': Math.min(1, layer.opacity + 0.15) }
          : isLine
          ? { 'line-color': color, 'line-width': 2, 'line-opacity': layer.opacity }
          : { 'fill-color': color, 'fill-opacity': Math.max(0.05, layer.opacity * 0.35), 'fill-outline-color': color };

        m.addLayer({ id: layerId, type: type as any, source: sourceId, paint });
        m.setLayoutProperty(layerId, 'visibility', layer.visible ? 'visible' : 'none');

        // Click handler
        m.on('click', layerId, (e) => {
          const feature = e.features?.[0];
          if (!feature) return;

          const srcNodeId = layer.sourceNodeId;
          if (srcNodeId) setSelectedNodeId(srcNodeId);
          selectLayer(layer.id);

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
  }, [mapLayers, selectedBasemapId, setSelectedNodeId, selectLayer]);

  // Layer state → visibility, opacity, and highlight
  useEffect(() => {
    const m = map.current;
    if (!m) return;

    const selectedLayerForNode = selectedNodeId ? nodeLayerMap.current.get(selectedNodeId) : null;
    const activeLayerId = selectedLayerId || selectedLayerForNode;

    mapLayers.forEach((layer) => {
      const layerId = `input-layer-${layer.id}`;
      if (!m.getLayer(layerId)) return;
      m.setLayoutProperty(layerId, 'visibility', layer.visible ? 'visible' : 'none');

      const isSelected = layer.id === activeLayerId;

      const geomType = layer.geojson.features?.[0]?.geometry?.type || 'Point';
      const isPoint = geomType.includes('Point');
      const isLine = geomType.includes('Line');
      const baseOpacity = layer.visible ? layer.opacity : 0;

      if (isSelected) {
        m.setPaintProperty(layerId, isPoint ? 'circle-opacity' : isLine ? 'line-opacity' : 'fill-opacity', isPoint || isLine ? baseOpacity : Math.max(0.05, baseOpacity * 0.5));
        if (isPoint) m.setPaintProperty(layerId, 'circle-stroke-opacity', Math.min(1, baseOpacity + 0.15));
        m.setPaintProperty(layerId, isPoint ? 'circle-radius' : isLine ? 'line-width' : 'fill-outline-color', isPoint ? 6 : isLine ? 3 : '#000');
      } else {
        const inactiveOpacity = activeLayerId ? Math.min(0.2, baseOpacity * 0.4) : baseOpacity;
        m.setPaintProperty(layerId, isPoint ? 'circle-opacity' : isLine ? 'line-opacity' : 'fill-opacity', isPoint ? inactiveOpacity : isLine ? inactiveOpacity : Math.max(0.05, inactiveOpacity * 0.35));
        if (isPoint) m.setPaintProperty(layerId, 'circle-stroke-opacity', Math.min(1, inactiveOpacity + 0.15));
        m.setPaintProperty(layerId, isPoint ? 'circle-radius' : isLine ? 'line-width' : 'fill-outline-color', isPoint ? 4 : isLine ? 2 : undefined);
      }
    });
  }, [selectedNodeId, selectedLayerId, mapLayers]);

  useEffect(() => {
    const m = map.current;
    if (!m || !layerFocusRequest) return;
    const layer = mapLayers.find((item) => item.id === layerFocusRequest.layerId);
    if (!layer) return;
    const bounds = getLayerBounds(layer.geojson);
    if (bounds) {
      m.fitBounds(bounds, { padding: 50, duration: 600, maxZoom: 16 });
    }
  }, [layerFocusRequest, mapLayers]);

  return (
    <div className="w-full h-full relative">
      <div ref={mapContainer} className="w-full h-full" />
    </div>
  );
};
