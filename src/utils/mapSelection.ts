import { featureIdFromMapFeature } from './featureIdentity';

export type SelectionOperation = 'replace' | 'add' | 'subtract';

export const combineFeatureSelection = (
  current: string[],
  incoming: string[],
  operation: SelectionOperation,
) => {
  const selected = new Set(current.map(String));
  if (operation === 'replace') return [...new Set(incoming.map(String).filter(Boolean))];
  incoming.map(String).filter(Boolean).forEach((id) => {
    if (operation === 'add') selected.add(id);
    else selected.delete(id);
  });
  return [...selected];
};

export const featureIdsFromRenderedFeatures = (
  features: Array<{ id?: string | number; properties?: Record<string, unknown> | null }>,
) => [...new Set(features.map(featureIdFromMapFeature).filter((id): id is string => Boolean(id)))];

export const screenSelectionBox = (
  start: { x: number; y: number },
  end: { x: number; y: number },
) => [
  [Math.min(start.x, end.x), Math.min(start.y, end.y)],
  [Math.max(start.x, end.x), Math.max(start.y, end.y)],
] as [[number, number], [number, number]];

