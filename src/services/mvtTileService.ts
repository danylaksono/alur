import * as maplibregl from 'maplibre-gl';
import { duckdbService, type MvtTileSource } from './duckdb';

const PROTOCOL = 'ymnngis-mvt';
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

export const registerMvtProtocol = () => {
  if (protocolRegistered) return;
  maplibregl.addProtocol(PROTOCOL, async (params) => {
    const { layerId, z, x, y } = parseTileUrl(params.url);
    const source = tileSources.get(layerId);
    if (!source || !Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y)) {
      return { data: new ArrayBuffer(0) };
    }

    const tile = await duckdbService.getMvtTile(source, z, x, y);
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
