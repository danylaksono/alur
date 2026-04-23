import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useStore } from '../../store/useStore';

export const MapView = () => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const mapLayers = useStore((state) => state.mapLayers);

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      center: [-74.006, 40.7128],
      zoom: 12,
    });

    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  const getLayerBounds = (geojson: GeoJSON.FeatureCollection) => {
    const coords: [number, number][] = [];

    const isValidLon = (value: number) => value >= -180 && value <= 180;
    const isValidLat = (value: number) => value >= -90 && value <= 90;
    const normalizeCoordinate = (pt: any): [number, number] | null => {
      if (!Array.isArray(pt) || pt.length < 2) return null;
      const lon = Number(pt[0]);
      const lat = Number(pt[1]);
      if (Number.isNaN(lon) || Number.isNaN(lat)) return null;

      if (isValidLon(lon) && isValidLat(lat)) {
        return [lon, lat];
      }
      if (isValidLon(lat) && isValidLat(lon)) {
        return [lat, lon];
      }
      return null;
    };

    const collect = (geometry: GeoJSON.Geometry | null) => {
      if (!geometry) return;
      switch (geometry.type) {
        case 'Point': {
          const normalized = normalizeCoordinate(geometry.coordinates);
          if (normalized) coords.push(normalized);
          break;
        }
        case 'LineString':
        case 'MultiPoint':
          (geometry.coordinates as any[]).forEach((pt) => {
            const normalized = normalizeCoordinate(pt);
            if (normalized) coords.push(normalized);
          });
          break;
        case 'Polygon':
        case 'MultiLineString':
          (geometry.coordinates as any[]).flat(1).forEach((pt) => {
            const normalized = normalizeCoordinate(pt);
            if (normalized) coords.push(normalized);
          });
          break;
        case 'MultiPolygon':
          (geometry.coordinates as any[]).flat(2).forEach((pt) => {
            const normalized = normalizeCoordinate(pt);
            if (normalized) coords.push(normalized);
          });
          break;
        case 'GeometryCollection':
          geometry.geometries.forEach(collect);
          break;
      }
    };

    geojson.features.forEach((feature) => collect(feature.geometry));

    if (!coords.length) return null;

    const lons = coords.map((c) => c[0]);
    const lats = coords.map((c) => c[1]);
    const sw: [number, number] = [Math.min(...lons), Math.min(...lats)];
    const ne: [number, number] = [Math.max(...lons), Math.max(...lats)];

    if (!isValidLon(sw[0]) || !isValidLat(sw[1]) || !isValidLon(ne[0]) || !isValidLat(ne[1])) {
      return null;
    }

    return [sw, ne] as [[number, number], [number, number]];
  };

  useEffect(() => {
    if (!map.current) return;

    const updateLayers = () => {
      if (!map.current?.isStyleLoaded()) {
        map.current?.once('load', updateLayers);
        return;
      }

      mapLayers.forEach((layer) => {
        const sourceId = `input-source-${layer.id}`;
        const layerId = `input-layer-${layer.id}`;
        const existingSource = map.current?.getSource(sourceId) as maplibregl.GeoJSONSource | null;

        if (existingSource) {
          existingSource.setData(layer.geojson as any);
          return;
        }

        map.current?.addSource(sourceId, {
          type: 'geojson',
          data: layer.geojson,
        });

        const geometryType = layer.geojson.features?.[0]?.geometry?.type || 'Point';
        const isPoint = geometryType.includes('Point');
        const isLine = geometryType.includes('Line');
        const layerType = isPoint ? 'circle' : isLine ? 'line' : 'fill';
        const paint: any = isPoint
          ? {
              'circle-radius': 4,
              'circle-color': '#2563eb',
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 1,
            }
          : isLine
          ? {
              'line-color': '#2563eb',
              'line-width': 2,
            }
          : {
              'fill-color': '#2563eb',
              'fill-opacity': 0.3,
              'fill-outline-color': '#1e40af',
            };

        map.current?.addLayer({
          id: layerId,
          type: layerType as any,
          source: sourceId,
          paint,
        });
      });

      const latestLayer = mapLayers[mapLayers.length - 1];
      if (latestLayer) {
        const bounds = getLayerBounds(latestLayer.geojson);
        if (bounds) {
          map.current?.fitBounds(bounds, { padding: 40, duration: 800, maxZoom: 16 });
        }
      }
    };

    updateLayers();
  }, [mapLayers]);

  return (
    <div className="w-full h-full relative">
      <div ref={mapContainer} className="w-full h-full" />
      
      {/* Map Overlay for Layer Control */}
      <div className="absolute top-4 left-4 bg-white/90 backdrop-blur p-4 rounded-xl shadow-xl border border-border pointer-events-auto max-w-xs z-50">
        <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">Layer Stack</h4>
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 text-foreground font-medium">
              <div className="w-2 h-2 rounded-full bg-blue-500" /> Basemap
            </span>
            <span className="text-muted-foreground italic font-mono text-[10px]">active</span>
          </div>
          {mapLayers.length ? (
            mapLayers.map((layer) => (
              <div key={layer.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-2 text-[10px] text-slate-700">
                <div className="font-semibold text-slate-900 truncate">{layer.name}</div>
                <div className="text-muted-foreground mt-1 uppercase tracking-[0.15em]">input layer</div>
              </div>
            ))
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
