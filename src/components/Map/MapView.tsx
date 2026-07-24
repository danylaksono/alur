import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useStore } from '../../store/useStore';
import { getBasemap } from '../../utils/basemaps';
import { compileLayerStyle, geometryKindForLayer } from '../../utils/mapStyleCompiler';
import { featureIdFromMapFeature } from '../../utils/featureIdentity';
import { FEATURE_ID_PROPERTY } from '../../types/visualAnalytics';
import { LegendControl } from './LegendControl';
import { LocationSearchControl } from './LocationSearchControl';
import type { GeocodingResult } from '../../services/geocodingService';
import { mvtTileUrl, registerMvtProtocol, registerMvtTileSource, unregisterMvtTileSource } from '../../services/mvtTileService';
import { boundsForLayer, mvtSourceForLayer } from '../../utils/layerSource';
import { compileVisualFiltersWhereClause } from '../../utils/visualFilterSql';
import { ScreenGridLayerGL } from 'screengrid';
import {
  buildGlyphGridLayerOptions,
  glyphCellFeatureIds,
  glyphPointDataKey,
  queryLayerGlyphPoints,
  type GlyphPoint,
} from '../../services/glyphGridService';
import type { GlyphGridVisualisation } from '../../types/visualisation';
import { requiredMapTileProperties } from '../../utils/mapTileProperties';
import { queryLayerFeatureDetails } from '../../services/visualAnalyticsService';
import { MapInteractionToolbar } from './MapInteractionToolbar';
import { combineFeatureSelection, featureIdsFromRenderedFeatures, screenSelectionBox, type SelectionOperation } from '../../utils/mapSelection';
import { applyCohortComparisonPaint, compileMapFilter } from '../../utils/mapFilterCompiler';

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

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const popupHtml = (layerName: string, properties: Record<string, unknown> | null, loading = false) => {
  const title = `<div style="font:10px/1.4 sans-serif;font-weight:700;color:#0f766e;margin-bottom:4px">${escapeHtml(layerName)}</div>`;
  if (loading) {
    return `${title}<div style="font:11px/1.5 sans-serif;color:#64748b">Loading feature details…</div>`;
  }
  const entries = Object.entries(properties || {}).slice(0, 8);
  const rows = entries.map(([key, value]) =>
    `<div style="display:flex;justify-content:space-between;gap:8px;font:11px/1.5 monospace">
      <span style="font-weight:600;color:#475569">${escapeHtml(key)}</span>
      <span style="color:#1e293b;text-align:right;max-width:160px;overflow:hidden;text-overflow:ellipsis">${escapeHtml(formatPopupValue(value))}</span>
    </div>`,
  ).join('');
  const remainder = Object.keys(properties || {}).length - entries.length;
  return `${title}${rows}${remainder > 0
    ? `<div style="font:10px monospace;color:#94a3b8;margin-top:4px">+ ${remainder} more fields</div>`
    : ''}`;
};

const optionalLayerProps = (props: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(props).filter(([, value]) => value !== undefined));

export const MapView = () => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const popup = useRef<maplibregl.Popup | null>(null);
  const popupRequestId = useRef(0);
  const locationMarker = useRef<maplibregl.Marker | null>(null);
  const renderedLayerIds = useRef<Set<string>>(new Set());
  const renderedSourceVersions = useRef<Map<string, string>>(new Map());
  const nodeLayerMap = useRef<Map<string, string>>(new Map());
  const previousFeatureState = useRef<Map<string, { hoveredFeatureId?: string; highlightedFeatureIds: Set<string>; selectedFeatureIds: Set<string> }>>(new Map());
  const styleReady = useRef(false);
  const glyphLayers = useRef<Map<string, { layer: ScreenGridLayerGL<GlyphPoint, number, number[]>; key: string }>>(new Map());
  const glyphPointCache = useRef<Map<string, { key: string; promise: Promise<GlyphPoint[]> }>>(new Map());
  const selectionDrag = useRef<{ start: { x: number; y: number }; operation: SelectionOperation } | null>(null);
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
  const setFeatureSelection = useStore((s) => s.setFeatureSelection);
  const focusLayer = useStore((s) => s.focusLayer);
  const addToast = useStore((s) => s.addToast);
  const mapCamera = useStore((s) => s.ui.mapCamera);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectionBox, setSelectionBox] = useState<[[number, number], [number, number]] | null>(null);
  const [coordinates, setCoordinates] = useState('');
  const visibleLegends = mapLayers
    .filter((layer) => layer.visible && layer.legend)
    .map((layer) => ({
      layerId: layer.id,
      layerName: layer.name,
      legend: layer.legend!,
    }));
  const layerFilterKey = JSON.stringify(
    Object.fromEntries(mapLayers.map((layer) => [layer.id, visualAnalytics.datasets[layer.id]?.filters || []])),
  );

  // Init map once
  useEffect(() => {
    if (!mapContainer.current || map.current) return;
    registerMvtProtocol();
    const m = new maplibregl.Map({
      container: mapContainer.current,
      style: getBasemap(selectedBasemapId).styleUrl,
      // Blank-canvas start: world view until the first layer focuses the map.
      center: [mapCamera.longitude, mapCamera.latitude],
      zoom: mapCamera.zoom,
      bearing: mapCamera.bearing,
      pitch: mapCamera.pitch,
    });
    m.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 120 }), 'bottom-right');
    // Fires on the initial style load and after every setStyle — unlike
    // isStyleLoaded(), it is not perturbed by ongoing tile loads.
    m.on('style.load', () => { styleReady.current = true; });
    map.current = m;
    if (import.meta.env.DEV) {
      // Debug handle for driving/inspecting the map in dev tools and E2E runs.
      (window as unknown as Record<string, unknown>).__alurMap = m;
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
    let coordinateFrame = 0;
    const updateCoordinates = (event: maplibregl.MapMouseEvent) => {
      cancelAnimationFrame(coordinateFrame);
      coordinateFrame = requestAnimationFrame(() => {
        setCoordinates(`${event.lngLat.lng.toFixed(5)}, ${event.lngLat.lat.toFixed(5)}`);
      });
    };
    const clearCoordinates = () => setCoordinates('');
    m.on('mousemove', updateCoordinates);
    m.on('mouseout', clearCoordinates);
    const storeCamera = () => {
      const center = m.getCenter();
      useStore.getState().setMapCamera({
        longitude: center.lng,
        latitude: center.lat,
        zoom: m.getZoom(),
        bearing: m.getBearing(),
        pitch: m.getPitch(),
      });
    };
    m.on('moveend', storeCamera);

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
      const { restylingLayerIds, setLayerRestyling, loadingOperations, finishLoadingOperation } = useStore.getState();
      Object.keys(restylingLayerIds).forEach((layerId) => setLayerRestyling(layerId, false));
      Object.values(loadingOperations).forEach((operation) => {
        if (!operation.waitForLayerId) return;
        const sourceId = `input-source-${operation.waitForLayerId}`;
        if (m.getSource(sourceId) && m.isSourceLoaded(sourceId)) {
          finishLoadingOperation(operation.id);
        }
      });
    });

    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(coordinateFrame);
      m.off('mousemove', updateCoordinates);
      m.off('mouseout', clearCoordinates);
      m.off('moveend', storeCamera);
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
    const center = m.getCenter();
    if (
      Math.abs(center.lng - mapCamera.longitude) < 1e-7
      && Math.abs(center.lat - mapCamera.latitude) < 1e-7
      && Math.abs(m.getZoom() - mapCamera.zoom) < 1e-7
      && Math.abs(m.getBearing() - mapCamera.bearing) < 1e-7
      && Math.abs(m.getPitch() - mapCamera.pitch) < 1e-7
    ) return;
    m.jumpTo({
      center: [mapCamera.longitude, mapCamera.latitude],
      zoom: mapCamera.zoom,
      bearing: mapCamera.bearing,
      pitch: mapCamera.pitch,
    });
  }, [mapCamera]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const canvas = m.getCanvas();
    if (!selectionMode) {
      selectionDrag.current = null;
      setSelectionBox(null);
      canvas.style.cursor = '';
      if (!m.dragPan.isEnabled()) m.dragPan.enable();
      return;
    }

    popup.current?.remove();
    m.dragPan.disable();
    canvas.style.cursor = 'crosshair';

    const pointForEvent = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
        y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
      };
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const start = pointForEvent(event);
      selectionDrag.current = {
        start,
        operation: event.altKey ? 'subtract' : event.shiftKey ? 'add' : 'replace',
      };
      canvas.setPointerCapture(event.pointerId);
      setSelectionBox(screenSelectionBox(start, start));
    };
    const onPointerMove = (event: PointerEvent) => {
      const drag = selectionDrag.current;
      if (!drag) return;
      event.preventDefault();
      setSelectionBox(screenSelectionBox(drag.start, pointForEvent(event)));
    };
    const finishSelection = (event: PointerEvent) => {
      const drag = selectionDrag.current;
      selectionDrag.current = null;
      if (!drag) return;
      const end = pointForEvent(event);
      const box = screenSelectionBox(drag.start, end);
      setSelectionBox(null);
      if (Math.abs(box[1][0] - box[0][0]) < 3 || Math.abs(box[1][1] - box[0][1]) < 3) return;

      const state = useStore.getState();
      const layer = state.mapLayers.find((candidate) => candidate.id === state.selectedLayerId)
        || state.mapLayers.find((candidate) => candidate.visible);
      if (!layer) return;
      const mapLayerId = `input-layer-${layer.id}`;
      if (!m.getLayer(mapLayerId)) return;
      const features = m.queryRenderedFeatures(box, { layers: [mapLayerId] });
      const incoming = featureIdsFromRenderedFeatures(features);
      if (incoming.length > 25_000) {
        addToast({ type: 'warning', message: 'That box contains more than 25,000 visible features. Zoom in and select a smaller area.' });
        return;
      }
      const current = state.visualAnalytics.datasets[layer.id]?.selectedFeatureIds || [];
      setFeatureSelection(layer.id, combineFeatureSelection(current, incoming, drag.operation));
      selectLayer(layer.id);
      addToast({
        type: 'info',
        message: incoming.length
          ? `${incoming.length.toLocaleString()} visible features ${drag.operation === 'replace' ? 'selected' : drag.operation === 'add' ? 'added' : 'removed'}.`
          : 'No selectable visible features were found in that box.',
      });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectionMode(false);
    };

    canvas.addEventListener('pointerdown', onPointerDown, true);
    canvas.addEventListener('pointermove', onPointerMove, true);
    canvas.addEventListener('pointerup', finishSelection, true);
    canvas.addEventListener('pointercancel', finishSelection, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown, true);
      canvas.removeEventListener('pointermove', onPointerMove, true);
      canvas.removeEventListener('pointerup', finishSelection, true);
      canvas.removeEventListener('pointercancel', finishSelection, true);
      window.removeEventListener('keydown', onKeyDown);
      selectionDrag.current = null;
      canvas.style.cursor = '';
      if (!m.dragPan.isEnabled()) m.dragPan.enable();
    };
  }, [selectionMode, addToast, selectLayer, setFeatureSelection]);

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
    // setStyle wipes custom layers too — forget them so the glyph sync re-adds.
    glyphLayers.current.clear();
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

      // On the first dataset, position the camera before registering its vector
      // source. Otherwise MapLibre immediately asks DuckDB for a world-scale
      // tile at zoom 1, where dense building polygons quantize into large
      // triangles/squares and block the useful local tiles behind them.
      if (renderedLayerIds.current.size === 0 && mapLayers.length > 0 && m.getZoom() <= 2.5) {
        const requestedLayerId = useStore.getState().layerFocusRequest?.layerId;
        const initialLayer = mapLayers.find((layer) => layer.id === requestedLayerId) ?? mapLayers[0];
        const initialBounds = boundsForLayer(initialLayer)
          || (initialLayer.geojson ? getLayerBounds(initialLayer.geojson) : null);
        if (initialBounds) {
          m.fitBounds(initialBounds, { padding: 50, duration: 0, maxZoom: 16 });
        }
      }

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
        const layerFilters = visualAnalytics.datasets[layer.id]?.filters || [];
        const baseMvtSource = mvtSourceForLayer(layer);
        const tileFilterFields = new Set(baseMvtSource?.propertyColumns || []);
        const tileFilters = layerFilters.filter((filter) => tileFilterFields.has(filter.field));
        const renderPropertyColumns = baseMvtSource
          ? requiredMapTileProperties(baseMvtSource.propertyColumns, layer.visualisation, tileFilters)
          : [];
        const tileSource = baseMvtSource
          ? {
              ...baseMvtSource,
              filterWhereClause: compileVisualFiltersWhereClause(tileFilters),
              renderPropertyColumns,
            }
          : undefined;
        const renderVersion = layer.source.kind === 'duckdb-table' || layer.source.kind === 'duckdb-query'
          ? layer.source.renderVersion
          : layer.styleVersion;
        const sourceVersion = `${renderVersion}:${JSON.stringify(tileFilters)}:${JSON.stringify(renderPropertyColumns)}`;
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

          if (!featureId) {
            popup.current?.setLngLat(e.lngLat).setHTML(popupHtml(layer.name, feature.properties || {})).addTo(m);
            return;
          }

          const requestId = ++popupRequestId.current;
          popup.current?.setLngLat(e.lngLat).setHTML(popupHtml(layer.name, null, true)).addTo(m);
          void queryLayerFeatureDetails(layer, featureId)
            .then((properties) => {
              if (popupRequestId.current !== requestId) return;
              popup.current?.setHTML(popupHtml(layer.name, properties || feature.properties || {}));
            })
            .catch(() => {
              if (popupRequestId.current !== requestId) return;
              popup.current?.setHTML(popupHtml(layer.name, feature.properties || {}));
            });
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
          const comparisonPaint = layer.id === visualAnalytics.comparison?.datasetId
            ? applyCohortComparisonPaint(compiled.paint, visualAnalytics.cohorts, visualAnalytics.comparison, visualAnalytics.datasets[layer.id]?.filters || [])
            : compiled.paint;
          m.addLayer({
            id: layerId,
            type: compiled.type as any,
            source: sourceId,
            ...(sourceLayer ? { 'source-layer': sourceLayer } : {}),
            filter: ['!', ['has', 'point_count']],
            paint: comparisonPaint as any,
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
          const comparisonPaint = layer.id === visualAnalytics.comparison?.datasetId
            ? applyCohortComparisonPaint(compiled.paint, visualAnalytics.cohorts, visualAnalytics.comparison, visualAnalytics.datasets[layer.id]?.filters || [])
            : compiled.paint;
          m.addLayer({
            id: layerId,
            type: compiled.type as any,
            source: sourceId,
            ...(sourceLayer ? { 'source-layer': sourceLayer } : {}),
            paint: comparisonPaint as any,
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
          // Glyph-grid layers render on the screengrid canvas instead; hiding the
          // base layer keeps feature clicks from competing with cell clicks.
          const glyphActive = layer.visualisation?.kind === 'glyph_grid';
          m.setLayoutProperty(layerId, 'visibility', layer.visible && !glyphActive ? 'visible' : 'none');
          m.setFilter(layerId, (layer.id === visualAnalytics.comparison?.datasetId ? null : compileMapFilter(layerFilters)) as any);
        }

        if (layer.sourceNodeId) {
          nodeLayerMap.current.set(layer.sourceNodeId, layer.id);
        }

        renderedLayerIds.current.add(layer.id);
      });
    };

    syncLayers();
  }, [mapLayers, selectedBasemapId, layerFilterKey, setSelectedNodeId, selectLayer, setHoveredFeature, toggleSelectedFeature]);

  // Glyph-grid layers: screengrid custom canvas layers fed from DuckDB points.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    let cancelled = false;

    const syncGlyphLayers = async () => {
      if (!styleReady.current) {
        m.once('style.load', () => { if (!cancelled) syncGlyphLayers(); });
        return;
      }

      const wanted = new Map<string, { layer: typeof mapLayers[number]; vis: GlyphGridVisualisation }>();
      const configuredGlyphLayerIds = new Set<string>();
      mapLayers.forEach((layer) => {
        if (layer.visualisation?.kind === 'glyph_grid') configuredGlyphLayerIds.add(layer.id);
        if (layer.visible && layer.visualisation?.kind === 'glyph_grid') {
          wanted.set(layer.id, { layer, vis: layer.visualisation });
        }
      });

      glyphPointCache.current.forEach((_, layerId) => {
        if (!configuredGlyphLayerIds.has(layerId)) glyphPointCache.current.delete(layerId);
      });

      glyphLayers.current.forEach((entry, layerId) => {
        if (!wanted.has(layerId)) {
          if (m.getLayer(entry.layer.id)) m.removeLayer(entry.layer.id);
          glyphLayers.current.delete(layerId);
        }
      });

      for (const [layerId, { layer, vis }] of wanted) {
        const filters = visualAnalytics.datasets[layerId]?.filters || [];
        const dataKey = glyphPointDataKey({ layer, filters, vis });
        const key = JSON.stringify({ dataKey, vis });
        const existing = glyphLayers.current.get(layerId);
        if (existing && existing.key === key) continue;

        let points: GlyphPoint[] = [];
        try {
          const cached = glyphPointCache.current.get(layerId);
          if (cached?.key === dataKey) {
            points = await cached.promise;
          } else {
            const promise = queryLayerGlyphPoints({ layer, filters, vis });
            glyphPointCache.current.set(layerId, { key: dataKey, promise });
            points = await promise;
          }
        } catch (error) {
          const cached = glyphPointCache.current.get(layerId);
          if (cached?.key === dataKey) glyphPointCache.current.delete(layerId);
          console.error(`Failed to prepare glyph-grid points for layer "${layer.name}"`, error);
          // Data errors surface as an empty glyph layer rather than a crash.
        }
        if (cancelled) return;

        const glyphMapLayerId = `glyph-layer-${layerId}`;
        const options = buildGlyphGridLayerOptions({
          id: glyphMapLayerId,
          vis,
          points,
          onCellClick: (cell) => {
            selectLayer(layerId);
            setFeatureSelection(layerId, glyphCellFeatureIds(cell));
          },
        });

        if (existing && m.getLayer(existing.layer.id)) {
          existing.layer.setConfig(options);
          glyphLayers.current.set(layerId, { layer: existing.layer, key });
          continue;
        }

        if (m.getLayer(glyphMapLayerId)) m.removeLayer(glyphMapLayerId);
        const glyphLayer = new ScreenGridLayerGL<GlyphPoint, number, number[]>(options);
        m.addLayer(glyphLayer as unknown as maplibregl.CustomLayerInterface);
        glyphLayers.current.set(layerId, { layer: glyphLayer, key });
      }
    };

    syncGlyphLayers();
    return () => { cancelled = true; };
  }, [mapLayers, layerFilterKey, selectedBasemapId, selectLayer, setFeatureSelection]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;

    mapLayers.forEach((layer) => {
      const sourceId = `input-source-${layer.id}`;
      if (!m.getSource(sourceId)) return;
      const vectorSourceLayer = mvtSourceForLayer(layer)?.layerName;

      const previous = previousFeatureState.current.get(layer.id) || { highlightedFeatureIds: new Set<string>(), selectedFeatureIds: new Set<string>() };
      const current = visualAnalytics.datasets[layer.id] || { selectedFeatureIds: [] };
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
      const glyphActive = layer.visualisation?.kind === 'glyph_grid';

      m.setLayoutProperty(layerId, 'visibility', layer.visible && !glyphActive ? 'visible' : 'none');
      m.setFilter(layerId, (layer.id === visualAnalytics.comparison?.datasetId ? null : compileMapFilter(visualAnalytics.datasets[layer.id]?.filters || [])) as any);

      const isSelected = layer.id === activeLayerId;
      const compiled = compileLayerStyle(layer, {
        index: mapLayers.indexOf(layer),
        selected: isSelected,
        inactive: isInactive,
      });
      const comparisonPaint = layer.id === visualAnalytics.comparison?.datasetId
        ? applyCohortComparisonPaint(compiled.paint, visualAnalytics.cohorts, visualAnalytics.comparison, visualAnalytics.datasets[layer.id]?.filters || [])
        : compiled.paint;

      // A visualisation change can also change the layer TYPE (e.g. fill →
      // fill-extrusion). Setting the new type's paint keys on the old layer
      // throws inside MapLibre — skip; the sync effect rebuilds the layer.
      if (m.getLayer(layerId)?.type !== compiled.type) return;

      Object.entries(comparisonPaint).forEach(([key, value]) => {
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

    // isStyleLoaded() becomes false again while custom tiles are loading. The
    // style.load event is the correct readiness boundary for camera changes.
    if (!styleReady.current) {
      m.once('style.load', fitFocusedLayer);
      return () => {
        m.off('style.load', fitFocusedLayer);
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
      <MapInteractionToolbar
        selectionMode={selectionMode}
        hasLayer={mapLayers.some((layer) => layer.visible)}
        coordinates={coordinates}
        onToggleSelection={() => setSelectionMode((current) => !current)}
        onHome={() => {
          const layerId = selectedLayerId || mapLayers.find((layer) => layer.visible)?.id;
          if (layerId) focusLayer(layerId);
        }}
        onZoomIn={() => map.current?.zoomIn({ duration: 180 })}
        onZoomOut={() => map.current?.zoomOut({ duration: 180 })}
        onGeolocate={() => {
          if (!navigator.geolocation) { addToast({ type: 'warning', message: 'Geolocation is unavailable in this browser.' }); return; }
          navigator.geolocation.getCurrentPosition(
            ({ coords }) => map.current?.flyTo({ center: [coords.longitude, coords.latitude], zoom: Math.max(map.current?.getZoom() || 0, 13), duration: 700 }),
            () => addToast({ type: 'warning', message: 'Could not access your location.' }),
            { enableHighAccuracy: false },
          );
        }}
        onFullscreen={() => {
          const element = mapContainer.current?.parentElement;
          if (!element) return;
          if (document.fullscreenElement) void document.exitFullscreen(); else void element.requestFullscreen();
        }}
        onCopyCoordinates={() => {
          if (!coordinates) return;
          void navigator.clipboard?.writeText(coordinates).then(
            () => addToast({ type: 'success', message: 'Coordinates copied.' }),
            () => addToast({ type: 'warning', message: 'Could not copy coordinates.' }),
          );
        }}
      />
      {selectionBox && (
        <div
          className="pointer-events-none absolute z-20 border border-orange-500 bg-orange-300/20"
          style={{
            left: selectionBox[0][0],
            top: selectionBox[0][1],
            width: selectionBox[1][0] - selectionBox[0][0],
            height: selectionBox[1][1] - selectionBox[0][1],
          }}
        />
      )}
    </div>
  );
};
