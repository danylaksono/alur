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

export type LensPoint = { position: [number, number]; values: number[]; category?: string };

export type LensPoints = {
  points: LensPoint[];
  fields: string[];
  /** Distinct values of the grouping field, most common first. Empty if none. */
  categories: string[];
};

/**
 * Everything the lens reads, as one object.
 *
 * Deliberately not part of the layer's style. A style persists in the project
 * and drives the legend; a lens is somewhere you point, and putting these next
 * to fill colour would save a transient instrument's settings into the
 * document. What does link to the layer is the *vocabulary* — the fields on
 * offer are that layer's fields, and nothing here means anything without one.
 */
export type LensConfig = {
  /** Numeric field the bars measure. Null counts points instead. */
  field: string | null;
  /** How that field aggregates over the points in a bin. */
  statistic: 'total' | 'mean';
  /** Text field whose values become the bins. Null bins by compass sector. */
  groupField: string | null;
  /**
   * Where the bars sit, from 0 (grouped in category order) to 1 (each at the
   * true mean bearing of its members). Only meaningful when grouping.
   *
   * This is the interaction glyphlens exists for: the same bars easing between
   * a sorted legend and a compass rose, which is what teaches that composition
   * and anisotropy are different questions.
   */
  morph: number;
  /** What the bar heights are expressed as. */
  normalisation: 'count' | 'share' | 'density' | 'lq';
};

export const DEFAULT_LENS_CONFIG: LensConfig = {
  field: null,
  statistic: 'total',
  groupField: null,
  morph: 0,
  normalisation: 'count',
};

/**
 * The layer a lens reads: whichever is selected, else the first visible one.
 *
 * Shared with the field picker rather than restated there, so the choice on
 * offer is always the choice the next click will actually apply.
 */
export const activeLensLayer = (layers: MapLayer[], selectedLayerId: string | null) =>
  layers.find((layer) => layer.id === selectedLayerId) || layers.find((layer) => layer.visible);

/** The numeric fields a lens can measure on this layer, in schema order. */
export const lensFieldsForLayer = (layer: MapLayer): string[] =>
  metadataForLayer(layer)
    .fields.filter((field) => field.semanticType === 'numeric')
    .slice(0, MAX_LENS_FIELDS)
    .map((field) => field.name);

/** The text fields a lens can group by. */
export const lensGroupFieldsForLayer = (layer: MapLayer): string[] =>
  metadataForLayer(layer)
    .fields.filter((field) => field.semanticType === 'categorical')
    .slice(0, MAX_LENS_FIELDS)
    .map((field) => field.name);

/**
 * Categories worth drawing, most common first.
 *
 * A necklace with a bar per distinct value is unreadable past a couple of
 * dozen, and a high-cardinality text column would produce thousands. The rest
 * are dropped rather than lumped into an "other" bar, which would be the
 * largest bar on most columns and would say nothing.
 */
const MAX_CATEGORIES = 12;

const topCategories = (points: LensPoint[]): string[] => {
  const counts = new Map<string, number>();
  for (const point of points) {
    if (!point.category) continue;
    counts.set(point.category, (counts.get(point.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_CATEGORIES)
    .map(([value]) => value);
};

/**
 * The layer's points, carrying every field a lens can read.
 *
 * Reuses the glyph grid's extraction rather than repeating it — it already
 * handles both DuckDB-backed and attached-GeoJSON layers, applies the active
 * filters, and caps the row count.
 *
 * Re-queried only when the grouping field changes, because that is the one
 * choice that changes what has to come out of the database. Every numeric
 * field comes back in the same pass, so switching measure or statistic is
 * arithmetic on what is already here.
 */
export const lensPointsForLayer = async (
  layer: MapLayer,
  filters: VisualFilter[],
  groupField: string | null = null,
): Promise<LensPoints> => {
  const fields = lensFieldsForLayer(layer);

  const points = await queryLayerGlyphPoints({
    layer,
    filters,
    categoryField: groupField ?? undefined,
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

  const lensPoints: LensPoint[] = points.map((p) => ({
    position: p.position,
    values: p.values,
    ...(p.category === undefined ? {} : { category: p.category }),
  }));
  return { points: lensPoints, fields, categories: topCategories(lensPoints) };
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
 * How the enclosed points are decomposed, and what each bin measures.
 *
 * Two different questions, and the grouping field is what picks between them.
 * Without one, bins are compass sectors and the lens answers "which way is
 * this concentrated" — anisotropy. With one, bins are the categories of that
 * field and it answers "what is this neighbourhood made of" — composition,
 * which is the necklace map proper and the multivariate reading.
 *
 * `total` sums the field over a bin's members; `mean` averages them. The
 * distinction is not cosmetic: a total is an extensive quantity and a mean an
 * intensive one, and glyphlens makes you say which because guessing produces a
 * plausible map that is false.
 *
 * Every key is always present, `undefined` where it does not apply, because
 * the adapter's `update` merges nested options rather than replacing them —
 * omitting a key leaves the previous value in place, so a lens could never go
 * back from a field to counting, or from grouped to compass sectors.
 */
export const lensBinningFor = (data: LensPoints, config: LensConfig) => {
  const index = config.field ? data.fields.indexOf(config.field) : -1;
  const value = index < 0 ? undefined : (point: LensPoint) => point.values[index];
  const grouped = Boolean(config.groupField) && data.categories.length > 0;

  return {
    mode: grouped ? ('categorical' as const) : ('angular' as const),
    bins: ANGULAR_BINS,
    // Fixed order, so the bars keep their identity as the lens is moved and as
    // the morph runs — and so a category absent from this neighbourhood shows
    // as an empty slot rather than silently closing the ring up.
    categories: grouped ? data.categories : undefined,
    category: grouped ? (point: LensPoint) => point.category ?? '' : undefined,
    // A count needs neither: `bin` counts when given no value and no measure.
    value: config.statistic === 'total' ? value : undefined,
    measure: value && config.statistic === 'mean'
      ? { value, kind: 'intensive' as const }
      : undefined,
  };
};

/**
 * Where the bars sit on the ring.
 *
 * Grouped bins carry the mean bearing of their members, so they can be eased
 * from category order out to the direction those members actually lie in.
 * Compass sectors already are that direction, so there is nothing to morph
 * between and a plain necklace is right.
 *
 * Grouped bins use `morph` across the whole range, including 0, rather than
 * falling back to `necklace` there. `necklace` places a bin at its preferred
 * position, and for a categorical bin that preference is already the mean
 * bearing — so `necklace` is the compass-rose end, not the grouped one. Only
 * `morph` can reach the evenly-spaced block layout, and treating 0 as a
 * special case made both ends of the slider draw the same thing.
 */
export const lensPlacementFor = (data: LensPoints, config: LensConfig) =>
  config.groupField && data.categories.length > 0
    ? { mode: 'morph' as const, morph: config.morph }
    : { mode: 'necklace' as const };

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
  config: LensConfig = DEFAULT_LENS_CONFIG,
) => ({
  center: centre,
  // Through the style, not a `ring` option: the adapter reads the ring radius
  // from the renderer's style when it runs the pipeline.
  style: { ringRadius: RING_PX },
  selection: { type: 'disc' as const, radius: metresPerPixel * DISC_PX },
  data: data.points,
  getPosition: (point: LensPoint) => point.position,
  binning: lensBinningFor(data, config),
  // `lq` needs no baseline from here: glyphlens builds one from the ring of
  // points just outside the lens, which is what makes it read as "unusually
  // full of, for around here" rather than against some global average.
  normalisation: { mode: config.normalisation },
  placement: lensPlacementFor(data, config),
  marks: { type: 'bar' as const },
});
