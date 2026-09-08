import * as maplibregl from 'maplibre-gl';
import { duckdbService, type MvtTileSource } from './duckdb';

const PROTOCOL = 'alur-mvt';
const tileSources = new Map<string, MvtTileSource>();
let protocolRegistered = false;

const parseTileUrl = (url: string) => {
  const parsed = new URL(url);
  const pathParts = parsed.pathname.split('/').filter(Boolean);
  const hostParts = parsed.hostname ? [parsed.hostname] : [];
  const [encodedLayerId, zRaw, xRaw, yRaw] = [...hostParts, ...pathParts];
  const yClean = yRaw?.replace(/\.pbf$/i, '');

  return {
    layerId: decodeURIComponent(encodedLayerId || ''),
    z: Number(zRaw),
    x: Number(xRaw),
    y: Number(yClean),
  };
};

/**
 * MapLibre asks for every tile in the viewport at once — six or more on a
 * normal move. Handing all of them to DuckDB together is slower than feeding it
 * a couple at a time: on a 146k-polygon layer the same six zoom-13 tiles took
 * 22.6s dispatched together against 14.1s one after another, and running them
 * in pairs matched the sequential total. Queueing also puts the first tile on
 * screen far sooner, because a concurrent batch finishes all at once at the end
 * whereas a queue delivers as it goes.
 */
const MAX_CONCURRENT_TILES = 2;
let activeTileQueries = 0;
const waitingForTileSlot: Array<() => void> = [];

const withTileSlot = async <T>(run: () => Promise<T>): Promise<T> => {
  if (activeTileQueries >= MAX_CONCURRENT_TILES) {
    await new Promise<void>((resolve) => waitingForTileSlot.push(resolve));
  } else {
    activeTileQueries += 1;
  }
  try {
    return await run();
  } finally {
    // Hand the slot straight to one waiter rather than releasing and letting it
    // re-take: the count only drops when nobody is queued, so the number in
    // flight can never climb past the limit.
    const next = waitingForTileSlot.shift();
    if (next) next();
    else activeTileQueries -= 1;
  }
};

export const registerMvtProtocol = () => {
  if (protocolRegistered) return;
  maplibregl.addProtocol(PROTOCOL, async (params) => {
    const { layerId, z, x, y } = parseTileUrl(params.url);
    const source = tileSources.get(layerId);
    if (!source || !Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y)) {
      return { data: new ArrayBuffer(0) };
    }

    const tile = await withTileSlot(() => duckdbService.getMvtTile(source, z, x, y));
    return { data: tile };
  });
  protocolRegistered = true;
};

export const registerMvtTileSource = (layerId: string, source: MvtTileSource) => {
  tileSources.set(layerId, source);
};

export const unregisterMvtTileSource = (layerId: string) => {
  tileSources.delete(layerId);
};

export const mvtTileUrl = (layerId: string, styleVersion: number | string) =>
  `${PROTOCOL}://${encodeURIComponent(layerId)}/{z}/{x}/{y}.pbf?v=${styleVersion}`;
