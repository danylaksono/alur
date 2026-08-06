import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';

/**
 * The model behind a hand-drawn dataset.
 *
 * Until now a dataset could only enter ALUR by being loaded: every workflow
 * node transformed rows that already existed, so nothing could bring a new
 * spatial object into being. This is the smallest thing that fixes that, and
 * it is deliberately generic — points, lines, polygons and columns the analyst
 * names. Nothing here knows what a drawn feature *means*.
 *
 * Coordinates are WGS84 throughout, because that is what the map hands us and
 * reprojection belongs downstream where DuckDB's spatial extension can do it.
 */

export type DrawGeometryKind = 'point' | 'line' | 'polygon';

/** Deliberately three. A drawn column is typed enough to aggregate, no more. */
export type DrawnFieldType = 'text' | 'number' | 'boolean';

export type DrawnField = { name: string; type: DrawnFieldType };

export type DrawnFeature = {
  id: string;
  kind: DrawGeometryKind;
  /** Point: one position. Line: the vertices. Polygon: the ring, unclosed. */
  positions: Position[];
  properties: Record<string, unknown>;
};

export type DrawnLayer = {
  name: string;
  fields: DrawnField[];
  features: DrawnFeature[];
};

export const emptyDrawnLayer = (name = 'Drawn layer'): DrawnLayer => ({ name, fields: [], features: [] });

/** A line needs two points and a polygon three; anything less is not a shape. */
export const minimumVertices = (kind: DrawGeometryKind) => (kind === 'point' ? 1 : kind === 'line' ? 2 : 3);

export const canCommitDrawing = (kind: DrawGeometryKind, positions: Position[]) =>
  positions.length >= minimumVertices(kind);

export const defaultValueForField = (type: DrawnFieldType): unknown => (type === 'number' ? null : type === 'boolean' ? false : '');

/**
 * Coerces user input to the column's type. Returns `null` rather than `NaN`
 * for unparseable numbers: a blank cell is a missing value, and NaN would
 * survive into DuckDB as a number that compares false against itself.
 */
export const coerceFieldValue = (value: unknown, type: DrawnFieldType): unknown => {
  if (type === 'number') {
    if (value === '' || value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value;
    return value === 'true' || value === 1 || value === '1';
  }
  return value === null || value === undefined ? '' : String(value);
};

export const createDrawnFeature = (
  kind: DrawGeometryKind,
  positions: Position[],
  fields: DrawnField[],
  id = `feature-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
): DrawnFeature => ({
  id,
  kind,
  positions: positions.map((position) => [position[0], position[1]] as Position),
  properties: Object.fromEntries(fields.map((field) => [field.name, defaultValueForField(field.type)])),
});

/** Unique, non-empty, and not the reserved geometry column. */
export const fieldNameError = (name: string, fields: DrawnField[], existing?: string): string | null => {
  const trimmed = name.trim();
  if (!trimmed) return 'A column needs a name.';
  if (trimmed.toLowerCase() === 'geometry') return '“geometry” is reserved for the shape itself.';
  if (fields.some((field) => field.name !== existing && field.name.toLowerCase() === trimmed.toLowerCase())) {
    return `There is already a column called “${trimmed}”.`;
  }
  return null;
};

export const addField = (layer: DrawnLayer, field: DrawnField): DrawnLayer => ({
  ...layer,
  fields: [...layer.fields, field],
  features: layer.features.map((feature) => ({
    ...feature,
    properties: { ...feature.properties, [field.name]: defaultValueForField(field.type) },
  })),
});

export const removeField = (layer: DrawnLayer, name: string): DrawnLayer => ({
  ...layer,
  fields: layer.fields.filter((field) => field.name !== name),
  features: layer.features.map((feature) => {
    const { [name]: _removed, ...rest } = feature.properties;
    return { ...feature, properties: rest };
  }),
});

/**
 * Renaming carries the values across, and retyping coerces them. Dropping and
 * re-adding would be simpler and would silently discard everything already
 * entered.
 */
export const updateField = (layer: DrawnLayer, name: string, patch: Partial<DrawnField>): DrawnLayer => {
  const current = layer.fields.find((field) => field.name === name);
  if (!current) return layer;
  const next: DrawnField = { ...current, ...patch };
  return {
    ...layer,
    fields: layer.fields.map((field) => (field.name === name ? next : field)),
    features: layer.features.map((feature) => {
      const { [name]: value, ...rest } = feature.properties;
      return { ...feature, properties: { ...rest, [next.name]: coerceFieldValue(value, next.type) } };
    }),
  };
};

export const addFeature = (layer: DrawnLayer, feature: DrawnFeature): DrawnLayer => ({
  ...layer,
  features: [...layer.features, feature],
});

export const removeFeature = (layer: DrawnLayer, featureId: string): DrawnLayer => ({
  ...layer,
  features: layer.features.filter((feature) => feature.id !== featureId),
});

export const setFeatureProperty = (layer: DrawnLayer, featureId: string, name: string, value: unknown): DrawnLayer => {
  const field = layer.fields.find((item) => item.name === name);
  if (!field) return layer;
  return {
    ...layer,
    features: layer.features.map((feature) =>
      feature.id === featureId ? { ...feature, properties: { ...feature.properties, [name]: coerceFieldValue(value, field.type) } } : feature,
    ),
  };
};

/** GeoJSON rings must close; the model keeps them open so editing is simpler. */
const closeRing = (positions: Position[]): Position[] => {
  const [first] = positions;
  const last = positions[positions.length - 1];
  return first && last && (first[0] !== last[0] || first[1] !== last[1]) ? [...positions, first] : positions;
};

export const geometryFor = (feature: DrawnFeature): Geometry => {
  if (feature.kind === 'point') return { type: 'Point', coordinates: feature.positions[0] };
  if (feature.kind === 'line') return { type: 'LineString', coordinates: feature.positions };
  return { type: 'Polygon', coordinates: [closeRing(feature.positions)] };
};

export const toGeoJson = (layer: DrawnLayer): FeatureCollection => ({
  type: 'FeatureCollection',
  features: layer.features.map((feature): Feature => ({
    type: 'Feature',
    id: feature.id,
    geometry: geometryFor(feature),
    // Every declared column appears on every feature, including the ones added
    // after it was drawn, so the table has no ragged rows.
    properties: Object.fromEntries(layer.fields.map((field) => [field.name, feature.properties[field.name] ?? defaultValueForField(field.type)])),
  })),
});

/** What a preview needs to render, including a shape still being drawn. */
export const previewCollection = (layer: DrawnLayer, inProgress?: { kind: DrawGeometryKind; positions: Position[] }): FeatureCollection => {
  const committed = toGeoJson(layer).features;
  if (!inProgress?.positions.length) return { type: 'FeatureCollection', features: committed };
  // An unfinished shape is drawn as whatever it currently qualifies as, so a
  // polygon reads as a line until its third vertex rather than not at all.
  const { kind, positions } = inProgress;
  const provisional: Feature = {
    type: 'Feature',
    id: '__alur_drawing',
    geometry:
      positions.length === 1 || kind === 'point'
        ? { type: 'Point', coordinates: positions[0] }
        : kind === 'polygon' && positions.length >= 3
          ? { type: 'Polygon', coordinates: [closeRing(positions)] }
          : { type: 'LineString', coordinates: positions },
    properties: { __alur_drawing: true },
  };
  return { type: 'FeatureCollection', features: [...committed, provisional] };
};

export const describeDrawnLayer = (layer: DrawnLayer) => {
  const counts = layer.features.reduce<Record<DrawGeometryKind, number>>(
    (totals, feature) => ({ ...totals, [feature.kind]: totals[feature.kind] + 1 }),
    { point: 0, line: 0, polygon: 0 },
  );
  return { total: layer.features.length, ...counts };
};
