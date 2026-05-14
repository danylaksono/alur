import { FEATURE_ID_PROPERTY } from '../types/visualAnalytics';

const candidateKeys = ['id', 'ID', 'fid', 'FID', 'gid', 'GID', 'objectid', 'OBJECTID'];

const normaliseFeatureId = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
};

export const featureIdForProperties = (
  properties: GeoJSON.GeoJsonProperties | null | undefined,
  fallback: string,
) => {
  const props = properties || {};
  const existing = normaliseFeatureId(props[FEATURE_ID_PROPERTY]);
  if (existing) return existing;

  for (const key of candidateKeys) {
    const value = normaliseFeatureId(props[key]);
    if (value) return value;
  }

  return fallback;
};

export const ensureFeatureIds = (
  geojson: GeoJSON.FeatureCollection,
  layerId: string,
): GeoJSON.FeatureCollection => ({
  ...geojson,
  features: geojson.features.map((feature, index) => {
    const featureId = featureIdForProperties(feature.properties, `${layerId}:${index + 1}`);
    return {
      ...feature,
      id: featureId,
      properties: {
        ...(feature.properties || {}),
        [FEATURE_ID_PROPERTY]: featureId,
      },
    };
  }),
});

export const featureIdFromMapFeature = (feature: { id?: string | number; properties?: Record<string, unknown> | null }) =>
  normaliseFeatureId((feature.properties as Record<string, unknown> | null)?.[FEATURE_ID_PROPERTY]) ||
  normaliseFeatureId(feature.id);
