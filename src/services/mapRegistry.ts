import type * as maplibregl from 'maplibre-gl';

/**
 * The live map instance, so features outside the map component (evidence
 * capture, exports) can reach it without prop-drilling or relying on the
 * DEV-only `window.__alurMap` handle.
 */
let currentMap: maplibregl.Map | null = null;

export const registerMap = (map: maplibregl.Map | null) => {
  currentMap = map;
};

export const getMap = () => currentMap;

export type MapSnapshot = {
  /** WebP data URI of the rendered canvas; absent when capture failed. */
  image?: string;
  width: number;
  height: number;
  camera: { longitude: number; latitude: number; zoom: number; bearing: number; pitch: number };
  capturedAt: number;
  failureReason?: string;
};

/**
 * Grabs what the map is currently showing as an image.
 *
 * Reading a WebGL canvas needs `preserveDrawingBuffer` at map construction —
 * without it the buffer is cleared after compositing and toDataURL returns an
 * empty frame. MapView sets it for exactly this reason.
 */
export const captureMapSnapshot = async (quality = 0.82): Promise<MapSnapshot | null> => {
  const map = currentMap;
  if (!map) return null;

  const canvas = map.getCanvas();
  const camera = {
    longitude: map.getCenter().lng,
    latitude: map.getCenter().lat,
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  };
  const base: MapSnapshot = {
    width: canvas.width,
    height: canvas.height,
    camera,
    capturedAt: Date.now(),
  };

  try {
    // Force a fresh paint so the buffer holds the current frame, then read it
    // in the same tick before the browser composites again.
    await new Promise<void>((resolve) => {
      map.once('render', () => resolve());
      map.triggerRepaint();
      // Never hang the capture if the map is idle and emits no render event.
      window.setTimeout(resolve, 400);
    });

    const image = canvas.toDataURL('image/webp', quality);
    // A canvas tainted by a cross-origin basemap throws; an empty buffer
    // yields a uselessly short data URI instead, so both are checked.
    if (!image || image.length < 512) {
      return { ...base, failureReason: 'The map image could not be read from the canvas.' };
    }
    return { ...base, image };
  } catch (error: unknown) {
    return { ...base, failureReason: error instanceof Error ? error.message : 'The map image could not be captured.' };
  }
};
