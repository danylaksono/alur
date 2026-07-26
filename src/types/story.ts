import type { ExplainCard, ExplainSection } from './visualAnalytics';
import type { LegendSpec } from './visualisation';

export const STORY_FORMAT_VERSION = 1 as const;

/** What a map card captures. Self-contained: an image plus what produced it. */
export type MapEvidenceCapture = {
  image?: string;
  width: number;
  height: number;
  camera: { longitude: number; latitude: number; zoom: number; bearing: number; pitch: number };
  basemapId: string;
  layers: Array<{ name: string; legend?: LegendSpec }>;
  capturedAt: number;
  failureReason?: string;
};

/** Named only, never their contents — enough to cite a source, not to reopen it. */
export type StorySource = {
  id: string;
  name: string;
  sourceUpdatedAt?: string | number;
};

/**
 * A finished, read-only account of an analysis.
 *
 * Deliberately NOT a project: no workflow, no datasets, no relinking. Every
 * card carries the values it was captured with, so a story renders on its own
 * without the source data or the query engine.
 */
export type AlurStory = {
  kind: 'alur-story';
  version: typeof STORY_FORMAT_VERSION;
  appVersion: string;
  exportedAt: string;
  title: string;
  summary?: string;
  audience?: string;
  /**
   * Optional attribution. Not used for anything yet, but a story already in
   * circulation cannot be retroactively attributed, so the field ships now.
   */
  author?: string;
  sections: ExplainSection[];
  cards: ExplainCard[];
  sources: StorySource[];
};

/** What a reader would receive, so the author can see it before sharing. */
export type StoryDisclosure = {
  bytes: number;
  cardCount: number;
  /** Cards whose captured values include row-level records. */
  recordCards: Array<{ id: string; title: string; rowCount: number }>;
  /** Cards embedding sampled geometry. */
  spatialCards: Array<{ id: string; title: string; featureCount: number }>;
  imageCards: number;
  sourceNames: string[];
  /** Cards that will render as a gap because nothing was captured. */
  emptyCards: Array<{ id: string; title: string }>;
};
