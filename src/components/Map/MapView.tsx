import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useStore } from '../../store/useStore';
import { getBasemap } from '../../utils/basemaps';
import { compileLayerStyle, geometryKindForLayer } from '../../utils/mapStyleCompiler';
import { featureIdFromMapFeature } from '../../utils/featureIdentity';
import { FEATURE_ID_PROPERTY } from '../../types/visualAnalytics';
import type { VisualFilter } from '../../types/visualAnalytics';
import { LegendControl } from './LegendControl';
import { BasemapControl } from './BasemapControl';
import { LocationSearchControl } from './LocationSearchControl';
import type { GeocodingResult } from '../../services/geocodingService';
import { mvtTileUrl, registerMvtProtocol, registerMvtTileSource, unregisterMvtTileSource } from '../../services/mvtTileService';
import { boundsForLayer, mvtSourceForLayer } from '../../utils/layerSource';
import { compileVisualFiltersWhereClause } from '../../utils/visualFilterSql';

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

const compileMapFilter = (filters: VisualFilter[]) => {
  const expressions = filters.map((filter) => {
    if (filter.kind === 'category') {
      const categoryExpression: unknown[] = ['in', ['to-string', ['get', filter.field]], ['literal', filter.values]];
      if (filter.includeNull) {
        return ['any', categoryExpression, ['!', ['has', filter.field]], ['==', ['get', filter.field], null]];
      }
      return categoryExpression;
    }

    if (filter.kind === 'temporal') {
      const temporalPredicates: unknown[] = [];
      if (filter.start) temporalPredicates.push(['>=', ['to-string', ['get', filter.field]], filter.start]);
      if (filter.end) temporalPredicates.push(['<=', ['to-string', ['get', filter.field]], filter.end]);
      const temporalExpression = temporalPredicates.length > 1 ? ['all', ...temporalPredicates] : temporalPredicates[0];
      if (filter.includeNull) {
        return temporalExpression
          ? ['any', temporalExpression, ['!', ['has', filter.field]], ['==', ['get', filter.field], null]]
          : ['any', ['!', ['has', filter.field]], ['==', ['get', filter.field], null]];
      }
      return temporalExpression;
    }

    const rangePredicates: unknown[] = [];
    if (filter.min !== undefined) rangePredicates.push(['>=', ['to-number', ['get', filter.field]], filter.min]);
    if (filter.max !== undefined) rangePredicates.push(['<=', ['to-number', ['get', filter.field]], filter.max]);
    const rangeExpression = rangePredicates.length > 1 ? ['all', ...rangePredicates] : rangePredicates[0];
    if (filter.includeNull) {
      return rangeExpression
        ? ['any', rangeExpression, ['!', ['has', filter.field]], ['==', ['get', filter.field], null]]
        : ['any', ['!', ['has', filter.field]], ['==', ['get', filter.field], null]];
    }
    return rangeExpression;
  }).filter(Boolean);

  if (!expressions.length) return null;
  return expressions.length === 1 ? expressions[0] : ['all', ...expressions];
};

const optionalLayerProps = (props: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(props).filter(([, value]) => value !== undefined));

export const MapView = () => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const popup = useRef<maplibregl.Popup | null>(null);
  const locationMarker = useRef<maplibregl.Marker | null>(null);
  const renderedLayerIds = useRef<Set<string>>(new Set());
  const renderedSourceVersions = useRef<Map<string, string>>(new Map());
  const nodeLayerMap = useRef<Map<string, string>>(new Map());
  const previousFeatureState = useRef<Map<string, { hoveredFeatureId?: string; highlightedFeatureIds: Set<string>; selectedFeatureIds: Set<string> }>>(new Map());
  const styleReady = useRef(false);
  type LayerEventName = 'click' | 'mousemove' | 'mouseleave';
  const layerEventHandlers = useRef<Map<string, Array<{ event: LayerEventName; mapLayerId: string; fn: (...args: any[]) => void }>>>(new Map());

  const selectedBasemapId = useStore((s) => s.selectedBasemapId);
  const mapLayers = useStore((s) => s.mapLayers);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const selectedLayerId = useStore((s) => s.selectedLayerId);
  const layerFocusRequest = useStore((s) => s.layerFocusRequest);
  const visualAnalytics = useStore((s) => s.visualAnalytics);
  const setSelectedNodeId = useStore((s) => s.setSelectedNodeId);
  const selectLayer = useStore((s) => s.selectLayer);
  const setHoveredFeature = useStore((s) => s.setHoveredFeature);
  const toggleSelectedFeature = useStore((s) => s.toggleSelectedFeature);
  const visibleLegends = mapLayers
    .filter((layer) => layer.visible && layer.legend)
    .map((layer) => ({
      layerId: layer.id,
      layerName: layer.name,
      legend: layer.legend!,
    }));
  const layerFilterKey = JSON.stringify(
    Object.fromEntries(mapLayers.map((layer) => [layer.id, visualAnalytics.layers[layer.id]?.filters || []])),
  );

  // Init map once
  useEffect(() => {
    if (!mapContainer.current || map.current) return;
    registerMvtProtocol();
	    const m = new maplibregl.Map({
	      container: mapContainer.current,
	      style: getBasemap(selectedBasemapId).styleUrl,
	      // Blank-canvas start: world view until the first layer focuses the map.
	      center: [0, 20],
	      zoom: 1.5,
	    });
    m.addControl(new maplibregl.NavigationControl(), 'top-right');
    // Fires on the initial style load and after every setStyle — unlike
    // isStyleLoaded(), it is not perturbed by ongoing tile loads.
    m.on('style.load', () => { styleReady.current = true; });
    map.current = m;
    if (import.meta.env.DEV) {
      // Debug handle for driving/inspecting the map in dev tools and E2E runs.
      (window as unknown as Record<string, unknown>).__ymnMap = m;
    }

    popup.current = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: false,
      maxWidth: '300px',
    });

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => map.current?.resize());
    });
    resizeObserver.observe(mapContainer.current);

    // Per-layer restyle indicator: mark while a layer's source loads tiles,
    // clear everything once the map settles. setLayerRestyling suppresses
    // no-op writes, so these chatty events don't spam the store.
    m.on('sourcedataloading', (e: maplibregl.MapSourceDataEvent) => {
      const sourceId = (e as { sourceId?: string }).sourceId;
      if (sourceId?.startsWith('input-source-')) {
        useStore.getState().setLayerRestyling(sourceId.slice('input-source-'.length), true);
      }
    });
    m.on('idle', () => {
      const { restylingLayerIds, setLayerRestyling } = useStore.getState();
      Object.keys(restylingLayerIds).forEach((layerId) => setLayerRestyling(layerId, false));
    });

    return () => {
      resizeObserver.disconnect();
      locationMarker.current?.remove();
      locationMarker.current = null;
      m.remove();
      map.current = null;
      popup.current = null;
    };
	  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const nextStyleUrl = getBasemap(selectedBasemapId).styleUrl;
    layerEventHandlers.current.forEach((handlers) => {
      handlers.forEach(({ event, mapLayerId, fn }) => m.off(event, mapLayerId, fn as any));
    });
    layerEventHandlers.current.clear();
    renderedLayerIds.current.clear();
    renderedSourceVersions.current.clear();
    nodeLayerMap.current.clear();
    popup.current?.remove();
    styleReady.current = false;
    m.setStyle(nextStyleUrl);
  }, [selectedBasemapId]);

  // Sync layers from store to map
  useEffect(() => {
    const m = map.current;
    if (!m) return;

    const detachLayerHandlers = (layerId: string) => {
      const handlers = layerEventHandlers.current.get(layerId);
      if (!handlers) return;
      handlers.forEach(({ event, mapLayerId, fn }) => m.off(event, mapLayerId, fn as any));
      layerEventHandlers.current.delete(layerId);
    };

    const attachLayerHandler = (layerId: string, event: 'click' | 'mousemove' | 'mouseleave', mapLayerId: string, fn: (...args: any[]) => void) => {
      m.on(event, mapLayerId, fn as any);
      const handlers = layerEventHandlers.current.get(layerId) || [];
      handlers.push({ event, mapLayerId, fn });
      layerEventHandlers.current.set(layerId, handlers);
    };

    const syncLayers = () => {
      // Gate on style readiness, not isStyleLoaded(): the latter is false
      // whenever any tile is still loading, which on DuckDB MVT layers is
      // most of the time — deferring syncs indefinitely.
      if (!styleReady.current) { m.once('style.load', syncLayers); return; }

      // Remove stale layers
      const currentIds = new Set(mapLayers.map((l) => l.id));
      renderedLayerIds.current.forEach((rid) => {
        if (!currentIds.has(rid)) {
          detachLayerHandlers(rid);
          const baseLayerId = `input-layer-${rid}`;
          const clusterLayerId = `${baseLayerId}-clusters`;
          const clusterCountLayerId = `${baseLayerId}-cluster-count`;
          const labelLayerId = `${baseLayerId}-labels`;
          const sourceId = `input-source-${rid}`;
          [baseLayerId, clusterLayerId, clusterCountLayerId, labelLayerId].forEach((id) => {
            if (m.getLayer(id)) m.removeLayer(id);
          });
          if (m.getSource(sourceId)) m.removeSource(sourceId);
          unregisterMvtTileSource(rid);
          renderedLayerIds.current.delete(rid);
          renderedSourceVersions.current.delete(rid);
          nodeLayerMap.current.forEach((mappedLayerId, nodeId) => {
            if (mappedLayerId === rid) nodeLayerMap.current.delete(nodeId);
          });
        }
      });

      // Add/update current layers
      mapLayers.forEach((layer, idx) => {
        const sourceId = `input-source-${layer.id}`;
        const layerId = `input-layer-${layer.id}`;
        const layerGeoKind = geometryKindForLayer(layer);
        const layerFilters = visualAnalytics.layers[layer.id]?.filters || [];
        const baseMvtSource = mvtSourceForLayer(layer);
        const tileFilterFields = new Set(baseMvtSource?.propertyColumns || []);
        const tileFilters = layerFilters.filter((filter) => tileFilterFields.has(filter.field));
        const tileSource = baseMvtSource
          ? { ...baseMvtSource, filterWhereClause: compileVisualFiltersWhereClause(tileFilters) }
          : undefined;
        const renderVersion = layer.source.kind === 'duckdb-table' || layer.source.kind === 'duckdb-query'
          ? layer.source.renderVersion
          : layer.styleVersion;
        const sourceVersion = `${renderVersion}:${JSON.stringify(tileFilters)}`;
        const isVectorTiled = Boolean(tileSource);
        const isClustered = !isVectorTiled && layerGeoKind === 'point' && typeof layer.clusterRadius === 'number';
        const sourceLayer = tileSource?.layerName;
        const clusterLayerId = `${layerId}-clusters`;
        const clusterCountLayerId = `${layerId}-cluster-count`;
        const labelLayerId = `${layerId}-labels`;
        const removeRenderedMapLayers = () => {
          [layerId, clusterLayerId, clusterCountLayerId, labelLayerId].forEach((id) => {
            if (m.getLayer(id)) m.removeLayer(id);
          });
        };

        if (tileSource) {
          registerMvtTileSource(layer.id, tileSource);
        }

        const existingSourceVersion = renderedSourceVersions.current.get(layer.id);
        if (
          isVectorTiled &&
          m.getSource(sourceId) &&
          existingSourceVersion !== undefined &&
          existingSourceVersion !== sourceVersion
        ) {
          // Tiles are about to regenerate — surface a per-layer restyling state.
          useStore.getState().setLayerRestyling(layer.id, true);
          removeRenderedMapLayers();
          m.removeSource(sourceId);
        }

        const existingSource = m.getSource(sourceId) as maplibregl.GeoJSONSource | null;
        if (existingSource && !isVectorTiled) {
          existingSource.setData((layer.geojson || { type: 'FeatureCollection', features: [] }) as any);
        } else if (!existingSource && isVectorTiled && tileSource) {
          m.addSource(sourceId, {
            type: 'vector',
            tiles: [mvtTileUrl(layer.id, sourceVersion)],
            minzoom: 0,
            maxzoom: 22,
          });
        } else if (!existingSource) {
          m.addSource(sourceId, {
            type: 'geojson',
            data: layer.geojson || { type: 'FeatureCollection', features: [] },
            promoteId: FEATURE_ID_PROPERTY,
            ...(isClustered ? {
              cluster: true,
              clusterRadius: layer.clusterRadius,
              clusterMaxZoom: layer.clusterMaxZoom ?? 16,
            } : {}),
          } as any);
        }
        renderedSourceVersions.current.set(layer.id, sourceVersion);

        const handleFeatureClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
          if (isClustered && e.features?.[0]?.properties?.cluster) {
            const clusterId = e.features[0].properties.cluster_id;
            (m.getSource(sourceId) as maplibregl.GeoJSONSource)
              .getClusterExpansionZoom(clusterId)
              .then((zoom: number) => {
                const coordinates = (e.features![0].geometry as GeoJSON.Point).coordinates as [number, number];
                m.easeTo({ center: coordinates, zoom });
              })
              .catch(() => {
                const coordinates = (e.features![0].geometry as GeoJSON.Point).coordinates as [number, number];
                m.easeTo({ center: coordinates, zoom: m.getZoom() + 1 });
              });
            return;
          }

          const feature = e.features?.[0];
          if (!feature) return;
          const featureId = featureIdFromMapFeature(feature);
          const srcNodeId = layer.sourceNodeId;
          if (srcNodeId) setSelectedNodeId(srcNodeId);
          selectLayer(layer.id);
          if (featureId) toggleSelectedFeature(layer.id, featureId);

          const props = feature.properties || {};
          const entries = Object.entries(props).slice(0, 8);
          let html = entries.map(([k, v]) =>
            `<div style="display:flex;justify-content:space-between;gap:8px;font:11px/1.5 monospace">
              <span style="font-weight:600;color:#475569">${k}</span>
              <span style="color:#1e293b;text-align:right;max-width:160px;overflow:hidden;text-overflow:ellipsis">${formatPopupValue(v)}</span>
            </div>`
          ).join('');
          if (Object.keys(props).length > 8) html += `<div style="font:10px monospace;color:#94a3b8;margin-top:4px">+ ${Object.keys(props).length - 8} more fields</div>`;
          html = `<div style="font:10px/1.4 sans-serif;font-weight:700;color:#0f766e;margin-bottom:4px">${layer.name}</div>${html}`;
          popup.current?.setLngLat(e.lngLat).setHTML(html).addTo(m);
        };

        // Detach this layer's previous handlers so re-syncs never accumulate duplicates.
        detachLayerHandlers(layer.id);

        if (isClustered) {
          if (m.getLayer(clusterLayerId)) m.removeLayer(clusterLayerId);
          m.addLayer({
            id: clusterLayerId,
            type: 'circle',
            source: sourceId,
            filter: ['has', 'point_count'],
            paint: {
              'circle-color': ['step', ['get', 'point_count'], '#94a3b8', 10, '#6366f1', 100, '#8b5cf6', 500, '#ec4899'],
              'circle-radius': ['step', ['get', 'point_count'], 16, 10, 22, 100, 30, 500, 38],
              'circle-stroke-width': 2,
              'circle-stroke-color': '#ffffff',
              'circle-opacity': layer.visible ? layer.opacity : 0,
            },
          });

          if (m.getLayer(clusterCountLayerId)) m.removeLayer(clusterCountLayerId);
          m.addLayer({
            id: clusterCountLayerId,
            type: 'symbol',
            source: sourceId,
            filter: ['has', 'point_count'],
            layout: {
              'text-field': ['get', 'point_count_abbreviated'],
              'text-size': 11,
            },
          });

          if (m.getLayer(layerId)) m.removeLayer(layerId);
          const compiled = compileLayerStyle(layer, { index: idx });
          m.addLayer({
            id: layerId,
            type: compiled.type as any,
            source: sourceId,
            ...(sourceLayer ? { 'source-layer': sourceLayer } : {}),
            filter: ['!', ['has', 'point_count']],
            paint: compiled.paint as any,
            ...optionalLayerProps({ layout: compiled.layout as any }),
          } as any);

          if (compiled.label) {
            if (m.getLayer(labelLayerId)) m.removeLayer(labelLayerId);
            m.addLayer({
              id: labelLayerId,
              type: compiled.label.type as any,
              source: sourceId,
              ...(sourceLayer ? { 'source-layer': sourceLayer } : {}),
              filter: ['!', ['has', 'point_count']],
              layout: compiled.label.layout as any,
              paint: compiled.label.paint as any,
            });
          }

          attachLayerHandler(layer.id, 'click', clusterLayerId, handleFeatureClick);
          attachLayerHandler(layer.id, 'click', layerId, handleFeatureClick);

          attachLayerHandler(layer.id, 'mousemove', clusterLayerId, () => { m.getCanvas().style.cursor = 'pointer'; });
          attachLayerHandler(layer.id, 'mouseleave', clusterLayerId, () => { m.getCanvas().style.cursor = ''; });
          attachLayerHandler(layer.id, 'mousemove', layerId, (e) => {
            const feature = e.features?.[0];
            const featureId = feature ? featureIdFromMapFeature(feature) : null;
            if (featureId) setHoveredFeature(layer.id, featureId);
            m.getCanvas().style.cursor = 'pointer';
          });
          attachLayerHandler(layer.id, 'mouseleave', layerId, () => {
            setHoveredFeature(layer.id, null);
            m.getCanvas().style.cursor = '';
          });
        } else {
          if (m.getLayer(layerId)) m.removeLayer(layerId);
          const compiled = compileLayerStyle(layer, { index: idx });
          m.addLayer({
            id: layerId,
            type: compiled.type as any,
            source: sourceId,
            ...(sourceLayer ? { 'source-layer': sourceLayer } : {}),
            paint: compiled.paint as any,
            ...optionalLayerProps({ layout: compiled.layout as any }),
          } as any);

          // 3D extrusion is invisible from straight above — tilt once, then
          // leave the camera to the user.
          if (compiled.type === 'fill-extrusion' && m.getPitch() === 0) {
            m.easeTo({ pitch: 50, duration: 800 });
          }

          if (compiled.label) {
            if (m.getLayer(labelLayerId)) m.removeLayer(labelLayerId);
            m.addLayer({
              id: labelLayerId,
              type: compiled.label.type as any,
              source: sourceId,
              ...(sourceLayer ? { 'source-layer': sourceLayer } : {}),
              layout: compiled.label.layout as any,
              paint: compiled.label.paint as any,
            });
          }

          attachLayerHandler(layer.id, 'click', layerId, handleFeatureClick);

          attachLayerHandler(layer.id, 'mousemove', layerId, (e) => {
            const feature = e.features?.[0];
            const featureId = feature ? featureIdFromMapFeature(feature) : null;
            if (featureId) setHoveredFeature(layer.id, featureId);
            m.getCanvas().style.cursor = 'pointer';
          });
          attachLayerHandler(layer.id, 'mouseleave', layerId, () => {
            setHoveredFeature(layer.id, null);
            m.getCanvas().style.cursor = '';
          });
        }

        if (m.getLayer(layerId)) {
          m.setLayoutProperty(layerId, 'visibility', layer.visible ? 'visible' : 'none');
          m.setFilter(layerId, compileMapFilter(layerFilters) as any);
        }

        if (layer.sourceNodeId) {
          nodeLayerMap.current.set(layer.sourceNodeId, layer.id);
        }

        renderedLayerIds.current.add(layer.id);
      });
    };

    syncLayers();
  }, [mapLayers, selectedBasemapId, layerFilterKey, setSelectedNodeId, selectLayer, setHoveredFeature, toggleSelectedFeature]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;

    mapLayers.forEach((layer) => {
      const sourceId = `input-source-${layer.id}`;
      if (!m.getSource(sourceId)) return;
      const vectorSourceLayer = mvtSourceForLayer(layer)?.layerName;

      const previous = previousFeatureState.current.get(layer.id) || { highlightedFeatureIds: new Set<string>(), selectedFeatureIds: new Set<string>() };
      const current = visualAnalytics.layers[layer.id] || { selectedFeatureIds: [] };
      const nextSelected = new Set(current.selectedFeatureIds);
      const nextHighlighted = new Set(current.highlightedFeatureIds || []);

      const setState = (featureId: string | undefined, state: Record<string, boolean>) => {
        if (!featureId) return;
        try {
          m.setFeatureState({
            source: sourceId,
            ...(vectorSourceLayer ? { sourceLayer: vectorSourceLayer } : {}),
            id: vectorSourceLayer && /^\d+$/.test(featureId) ? Number(featureId) : featureId,
          }, state);
        } catch {
          // The source can be between style reloads; the next sync will apply the state.
        }
      };

      setState(previous.hoveredFeatureId, { hover: false });
      previous.highlightedFeatureIds.forEach((featureId) => {
        if (!nextHighlighted.has(featureId)) setState(featureId, { hover: false });
      });
      previous.selectedFeatureIds.forEach((featureId) => {
        if (!nextSelected.has(featureId)) setState(featureId, { selected: false });
      });

      setState(current.hoveredFeatureId, { hover: true });
      nextHighlighted.forEach((featureId) => setState(featureId, { hover: true }));
      nextSelected.forEach((featureId) => setState(featureId, { selected: true }));

      previousFeatureState.current.set(layer.id, {
        hoveredFeatureId: current.hoveredFeatureId,
        highlightedFeatureIds: nextHighlighted,
        selectedFeatureIds: nextSelected,
      });
    });
  }, [mapLayers, visualAnalytics]);

  // Layer state → visibility, opacity, and highlight
  useEffect(() => {
    const m = map.current;
    if (!m) return;

    const selectedLayerForNode = selectedNodeId ? nodeLayerMap.current.get(selectedNodeId) : null;
    const activeLayerId = selectedLayerId || selectedLayerForNode;

    mapLayers.forEach((layer) => {
      const layerId = `input-layer-${layer.id}`;
      if (!m.getLayer(layerId)) return;
      const isInactive = Boolean(activeLayerId && layer.id !== activeLayerId);

      m.setLayoutProperty(layerId, 'visibility', layer.visible ? 'visible' : 'none');
      m.setFilter(layerId, compileMapFilter(visualAnalytics.layers[layer.id]?.filters || []) as any);

      const isSelected = layer.id === activeLayerId;
      const compiled = compileLayerStyle(layer, {
        index: mapLayers.indexOf(layer),
        selected: isSelected,
        inactive: isInactive,
      });

      // A visualisation change can also change the layer TYPE (e.g. fill →
      // fill-extrusion). Setting the new type's paint keys on the old layer
      // throws inside MapLibre — skip; the sync effect rebuilds the layer.
      if (m.getLayer(layerId)?.type !== compiled.type) return;

      Object.entries(compiled.paint).forEach(([key, value]) => {
        m.setPaintProperty(layerId, key, value as any);
      });

      const clusterLayerId = `${layerId}-clusters`;
      const clusterCountLayerId = `${layerId}-cluster-count`;
      const labelLayerId = `${layerId}-labels`;
      const clusterOpacity = isInactive ? Math.min(0.25, layer.opacity * 0.35) : layer.opacity;

      if (m.getLayer(clusterLayerId)) {
        m.setLayoutProperty(clusterLayerId, 'visibility', layer.visible ? 'visible' : 'none');
        m.setPaintProperty(clusterLayerId, 'circle-opacity', clusterOpacity);
      }

      if (m.getLayer(clusterCountLayerId)) {
        m.setLayoutProperty(clusterCountLayerId, 'visibility', layer.visible ? 'visible' : 'none');
        m.setPaintProperty(clusterCountLayerId, 'text-opacity', clusterOpacity);
      }

      if (m.getLayer(labelLayerId)) {
        m.setLayoutProperty(labelLayerId, 'visibility', layer.visible ? 'visible' : 'none');
        m.setPaintProperty(labelLayerId, 'text-opacity', isInactive ? Math.min(0.2, layer.opacity * 0.4) : layer.opacity);
        m.setPaintProperty(labelLayerId, 'text-halo-width', isInactive ? 1.5 : compiled.label?.paint['text-halo-width'] ?? 1.5);
      }
    });
  }, [selectedNodeId, selectedLayerId, mapLayers, visualAnalytics]);

  useEffect(() => {
    const m = map.current;
    if (!m || !layerFocusRequest) return;

    const fitFocusedLayer = () => {
      const layer = useStore.getState().mapLayers.find((item) => item.id === layerFocusRequest.layerId);
      if (!layer) return;
      const bounds = layerFocusRequest.bounds || boundsForLayer(layer) || (layer.geojson ? getLayerBounds(layer.geojson) : null);
      if (bounds) {
        m.fitBounds(bounds, { padding: 50, duration: 600, maxZoom: 16 });
      }
    };

    if (!m.isStyleLoaded()) {
      m.once('idle', fitFocusedLayer);
      return () => {
        m.off('idle', fitFocusedLayer);
      };
    }

    fitFocusedLayer();
  }, [layerFocusRequest]);

  const focusSearchResult = (result: GeocodingResult) => {
    const m = map.current;
    if (!m) return;

    locationMarker.current?.remove();
    locationMarker.current = new maplibregl.Marker({ color: '#0f766e' })
      .setLngLat(result.center)
      .addTo(m);

    if (result.bounds) {
      m.fitBounds(result.bounds, { padding: 64, duration: 700, maxZoom: 17 });
      return;
    }

    m.flyTo({ center: result.center, zoom: Math.max(m.getZoom(), 14), duration: 700 });
  };

  const clearSearchResult = () => {
    locationMarker.current?.remove();
    locationMarker.current = null;
  };

  return (
    <div className="w-full h-full relative">
      <div ref={mapContainer} className="w-full h-full" />
      <LocationSearchControl onSelect={focusSearchResult} onClear={clearSearchResult} />
      <LegendControl legends={visibleLegends} />
      <BasemapControl />
    </div>
  );
};
