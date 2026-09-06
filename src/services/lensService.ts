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
 * Loaded on demand, like the cartogram's solver: a session that never opens a
 * lens should not pay for one.
 */

/** How many numeric fields a lens bins by before it stops being readable. */
const MAX_LENS_FIELDS = 6;

export type LensPoints = {
  points: Array<{ position: [number, number]; values: number[] }>;
  fields: string[];
};

/**
 * The layer's points, plus the numeric fields worth binning.
 *
 * Reuses the glyph grid's extraction rather than repeating it — it already
 * handles both DuckDB-backed and attached-GeoJSON layers, applies the active
 * filters, and caps the row count.
 */
export const lensPointsForLayer = async (
  layer: MapLayer,
  filters: VisualFilter[],
): Promise<LensPoints> => {
  const metadata = metadataForLayer(layer);
  const fields = metadata.fields
    .filter((field) => field.semanticType === 'numeric')
    .slice(0, MAX_LENS_FIELDS)
    .map((field) => field.name);

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
 * Options for glyphlens, assembled from a layer's points.
 *
 * Takes metres-per-pixel rather than a radius in metres, because the disc has
 * to stay in proportion to a ring that is measured in pixels.
 */
export const lensOptionsFor = (
  centre: [number, number],
  metresPerPixel: number,
  data: LensPoints,
) => ({
  center: centre,
  // Through the style, not a `ring` option: the adapter reads the ring radius
  // from the renderer's style when it runs the pipeline.
  style: { ringRadius: RING_PX },
  selection: { type: 'disc' as const, radius: metresPerPixel * DISC_PX },
  data: data.points,
  getPosition: (point: { position: [number, number] }) => point.position,
  binning: { mode: 'angular' as const, bins: 24 },
  normalisation: { mode: 'count' as const },
  placement: { mode: 'necklace' as const },
  marks: { type: 'bar' as const },
});
