import type { MapLayer } from '../store/useStore';
import type { VisualFilter } from '../types/visualAnalytics';
import { queryLayerGlyphPoints } from './glyphGridService';
import { metadataForLayer } from '../utils/datasetMetadata';

/**
 * Multivariate lenses over a layer's points.
 *
 * A lens is not a way of styling a layer, which is why it is not a
 * visualisation kind: it is an instrument you put down somewhere and move
 * about, reporting on the neighbourhood under it. That puts it in the same
 * category as box select — a map tool — and it is wired as one.
 *
 * glyphlens itself is loaded on demand, like the cartogram's solver: a session
 * that never opens a lens should not pay for the renderer.
 */

/**
 * How many numeric fields a lens carries.
 *
 * Only one drives the bars at a time, but they are all extracted in the single
 * query, so switching between them is free — no re-query, no wait.
 */
const MAX_LENS_FIELDS = 6;

/** Compass sectors the necklace divides into. */
const ANGULAR_BINS = 24;

export type LensPoints = {
  points: Array<{ position: [number, number]; values: number[] }>;
  fields: string[];
};

/**
 * The layer a lens reads: whichever is selected, else the first visible one.
 *
 * Shared with the field picker rather than restated there, so the choice on
 * offer is always the choice the next click will actually apply.
 */
export const activeLensLayer = (layers: MapLayer[], selectedLayerId: string | null) =>
  layers.find((layer) => layer.id === selectedLayerId) || layers.find((layer) => layer.visible);

/** The numeric fields a lens can read on this layer, in schema order. */
export const lensFieldsForLayer = (layer: MapLayer): string[] =>
  metadataForLayer(layer)
    .fields.filter((field) => field.semanticType === 'numeric')
    .slice(0, MAX_LENS_FIELDS)
    .map((field) => field.name);

/**
 * The layer's points, carrying every field a lens can read.
 *
 * Reuses the glyph grid's extraction rather than repeating it — it already
 * handles both DuckDB-backed and attached-GeoJSON layers, applies the active
 * filters, and caps the row count.
 */
export const lensPointsForLayer = async (
  layer: MapLayer,
  filters: VisualFilter[],
): Promise<LensPoints> => {
  const fields = lensFieldsForLayer(layer);

  const points = await queryLayerGlyphPoints({
    layer,
    filters,
    // The extraction is driven by a visualisation object; this one exists only
    // to ask for those fields, and is never rendered.
    vis: {
      kind: 'glyph_grid',
      mode: 'grid',
      cellSize: 48,
      glyph: 'bars',
      fields,
      aggregate: 'sum',
      palette: [],
      opacity: 1,
    } as any,
  });

  return { points: points.map((p) => ({ position: p.position, values: p.values })), fields };
};

/**
 * Size of the instrument, in screen pixels.
 *
 * The ring is fixed in pixels by design — panning and zooming move the dashed
 * geographic boundary inside it, never the layout. glyphlens defaults to a
 * 150px ring, with bars radiating a further `ring * 0.55` and labels beyond
 * that; on a map pane that reads as an overlay rather than as a lens. These
 * keep the whole instrument inside about 170px of radius.
 */
const RING_PX = 92;
/** Radius of the disc it reads, kept comfortably inside the ring. */
const DISC_PX = 60;

/**
 * What the bars measure, per compass sector.
 *
 * No field counts the points lying that way; a field totals it over them. Both
 * are extensive readings, so what the necklace shows is the same question
 * either way — which side of here is this concentrated on.
 *
 * A mean would be the other question worth asking ("is it *higher* to the
 * north", regardless of how much is there) and glyphlens has the spec for it:
 * `measure: { value, kind: 'intensive' }`. It cannot be used yet. `aggregate`
 * multiplies by `it.weight`, which the areal and corridor selectors set but the
 * point selector does not, so the weighted mean divides by NaN and every bin
 * comes back 0. The plain `value` path below is written defensively
 * (`it.weight ?? 1`) and is unaffected. Worth a fix upstream in this library.
 *
 * The shape is constant, with `value` explicitly undefined for the count case,
 * because the adapter's `update` merges nested options rather than replacing
 * them — returning a binning without the key would leave the previous field in
 * place, and the lens would never come back to counting.
 */
export const lensBinningFor = (data: LensPoints, field: string | null) => {
  const index = field ? data.fields.indexOf(field) : -1;
  return {
    mode: 'angular' as const,
    bins: ANGULAR_BINS,
    value:
      index < 0 ? undefined : (point: { values: number[] }) => point.values[index],
  };
};

/**
 * Options for glyphlens, assembled from a layer's points.
 *
 * Takes metres-per-pixel rather than a radius in metres, because the disc has
 * to stay in proportion to a ring that is measured in pixels.
 */
export const lensOptionsFor = (
  centre: [number, number],
  metresPerPixel: number,
  data: LensPoints,
  field: string | null = null,
) => ({
  center: centre,
  // Through the style, not a `ring` option: the adapter reads the ring radius
  // from the renderer's style when it runs the pipeline.
  style: { ringRadius: RING_PX },
  selection: { type: 'disc' as const, radius: metresPerPixel * DISC_PX },
  data: data.points,
  getPosition: (point: { position: [number, number] }) => point.position,
  binning: lensBinningFor(data, field),
  normalisation: { mode: 'count' as const },
  placement: { mode: 'necklace' as const },
  marks: { type: 'bar' as const },
});
