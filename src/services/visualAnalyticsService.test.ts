import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FEATURE_ID_PROPERTY } from '../types/visualAnalytics';
import { duckdbService } from './duckdb';
import {
  __visualAnalyticsCacheSizeForTests,
  clearLayerAnalyticsCache,
  registerLayerForAnalytics,
} from './visualAnalyticsService';

const layer = (id: string): { id: string; geojson: GeoJSON.FeatureCollection } => ({
  id,
  geojson: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: { [FEATURE_ID_PROPERTY]: 'a', value: 1 },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [1, 1] },
        properties: { [FEATURE_ID_PROPERTY]: 'b', value: 2 },
      },
    ],
  },
});

describe('visual analytics cache helpers', () => {
  beforeEach(() => {
    clearLayerAnalyticsCache();
    vi.restoreAllMocks();
  });

  it('reuses registered layer tables while the layer signature is unchanged', async () => {
    const register = vi.spyOn(duckdbService, 'registerJsonRows').mockResolvedValue(undefined);

    await registerLayerForAnalytics(layer('areas'));
    await registerLayerForAnalytics(layer('areas'));

    expect(register).toHaveBeenCalledTimes(1);
    expect(__visualAnalyticsCacheSizeForTests()).toBe(1);
  });

  it('clears the in-memory layer registration cache', async () => {
    vi.spyOn(duckdbService, 'registerJsonRows').mockResolvedValue(undefined);
    await registerLayerForAnalytics(layer('areas'));

    expect(__visualAnalyticsCacheSizeForTests()).toBe(1);
    clearLayerAnalyticsCache('areas');
    expect(__visualAnalyticsCacheSizeForTests()).toBe(0);
    await registerLayerForAnalytics(layer('areas'));
    clearLayerAnalyticsCache();
    expect(__visualAnalyticsCacheSizeForTests()).toBe(0);
  });
});
