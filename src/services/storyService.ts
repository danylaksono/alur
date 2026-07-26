import packageJson from '../../package.json';
import { useStore } from '../store/useStore';
import {
  STORY_FORMAT_VERSION,
  type AlurStory,
  type MapEvidenceCapture,
  type StoryDisclosure,
  type StorySource,
} from '../types/story';
import type { ComparisonResult, ExplainCard } from '../types/visualAnalytics';
import { downloadText, filenameTimestamp, safeFilename } from '../utils/download';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const cardTitle = (card: ExplainCard) => card.title || card.claim || card.kind;

/**
 * Sources are cited by name and version only. A story is a finished account,
 * not a way to redistribute someone's data.
 */
const storySources = (cards: ExplainCard[], registry = useStore.getState().datasetRegistry): StorySource[] => {
  const ids = new Set(cards.flatMap((card) => card.provenance?.datasetIds || []));
  return [...ids].map((id) => ({
    id,
    name: registry[id]?.name || 'Unavailable source',
    sourceUpdatedAt: registry[id]?.sourceUpdatedAt,
  }));
};

export const createStory = (state = useStore.getState(), exportedAt = new Date()): AlurStory => {
  const explain = state.visualAnalytics.explain;
  const cards = structuredClone(explain.cards);
  return {
    kind: 'alur-story',
    version: STORY_FORMAT_VERSION,
    appVersion: packageJson.version,
    exportedAt: exportedAt.toISOString(),
    title: explain.title,
    summary: explain.summary,
    audience: explain.audience,
    author: state.settings.authorName || undefined,
    sections: structuredClone(explain.sections),
    cards,
    sources: storySources(cards, state.datasetRegistry),
  };
};

/** Strips every card down to what a reader needs, dropping row-level records. */
export const withoutRecordLevelEvidence = (story: AlurStory): AlurStory => ({
  ...story,
  cards: story.cards.map((card) => {
    if (card.kind === 'table') return { ...card, frozenValues: undefined };
    if (card.kind !== 'comparison' || !isRecord(card.frozenValues)) return card;
    const result = card.frozenValues as unknown as ComparisonResult;
    return {
      ...card,
      frozenValues: { ...result, alignedRecords: undefined, spatialSamples: undefined, differenceSpatialSample: undefined },
    };
  }),
});

export const storyDisclosure = (story: AlurStory): StoryDisclosure => {
  const recordCards: StoryDisclosure['recordCards'] = [];
  const spatialCards: StoryDisclosure['spatialCards'] = [];
  const emptyCards: StoryDisclosure['emptyCards'] = [];
  let imageCards = 0;

  for (const card of story.cards) {
    const title = cardTitle(card);
    if (card.kind === 'table') {
      const rows = Array.isArray(card.frozenValues) ? card.frozenValues.length : 0;
      if (rows) recordCards.push({ id: card.id, title, rowCount: rows });
      else emptyCards.push({ id: card.id, title });
      continue;
    }
    if (card.kind === 'comparison') {
      if (!isRecord(card.frozenValues)) { emptyCards.push({ id: card.id, title }); continue; }
      const result = card.frozenValues as unknown as ComparisonResult;
      const aligned = result.alignedRecords?.length || 0;
      if (aligned) recordCards.push({ id: card.id, title, rowCount: aligned });
      const features = [...(result.spatialSamples || []), ...(result.differenceSpatialSample ? [result.differenceSpatialSample] : [])]
        .reduce((total, sample) => total + (sample.features?.features.length || 0), 0);
      if (features) spatialCards.push({ id: card.id, title, featureCount: features });
      continue;
    }
    if (card.kind === 'map') {
      const capture = card.frozenValues as MapEvidenceCapture | undefined;
      if (capture?.image) imageCards += 1;
      else emptyCards.push({ id: card.id, title });
      continue;
    }
    if ((card.kind === 'chart' || card.kind === 'kpi') && card.frozenValues === undefined) {
      emptyCards.push({ id: card.id, title });
    }
  }

  return {
    bytes: new Blob([JSON.stringify(story)]).size,
    cardCount: story.cards.length,
    recordCards,
    spatialCards,
    imageCards,
    sourceNames: story.sources.map((source) => source.name),
    emptyCards,
  };
};

export const serialiseStory = (story: AlurStory) => JSON.stringify(story, null, 2);

export const downloadStory = (story: AlurStory) => {
  const fileName = `${safeFilename(story.title, 'alur-story')}-${filenameTimestamp(new Date(story.exportedAt))}.alur-story.json`;
  downloadText(serialiseStory(story), fileName, 'application/json;charset=utf-8');
};

export const parseStory = (text: string): AlurStory => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('The story file is not valid JSON.');
  }
  if (!isRecord(value) || value.kind !== 'alur-story') throw new Error('This is not an ALUR story file.');
  if (typeof value.version !== 'number') throw new Error('The story version is missing.');
  if (value.version > STORY_FORMAT_VERSION) {
    throw new Error(`This story uses version ${value.version}, but this ALUR build supports up to version ${STORY_FORMAT_VERSION}. Update ALUR to read it.`);
  }
  if (!Array.isArray(value.sections) || !Array.isArray(value.cards)) throw new Error('The story structure is invalid.');

  return {
    ...(value as unknown as AlurStory),
    title: typeof value.title === 'string' && value.title.trim() ? value.title : 'Untitled story',
    sources: Array.isArray(value.sources) ? (value.sources as StorySource[]) : [],
  };
};
