import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../store/useStore';
import { STORY_URL_PARAM, createStory, fetchStory, parseStory, serialiseStory, storyDisclosure, storyLinkFor, withoutRecordLevelEvidence } from './storyService';
import type { AlurStory } from '../types/story';
import type { ComparisonResult, ExplainCard } from '../types/visualAnalytics';

const comparisonResult = (): ComparisonResult => ({
  specId: 'spec-1',
  summaries: [{ measureId: 'rows', values: [{ operandId: 'a', value: 10, denominator: 10, missing: 0 }] }],
  distributions: [],
  categoryShares: [],
  temporalSeries: [],
  alignedRecords: [
    { key: 'E01', presentOperandIds: ['a'], values: {}, deltas: {} },
    { key: 'E02', presentOperandIds: ['a'], values: {}, deltas: {} },
  ],
  spatialSamples: [{
    operandId: 'a',
    features: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }] },
    sampled: false,
    featureCount: 1,
  }],
  warnings: [],
  generatedAt: 1,
});

const card = (patch: Partial<ExplainCard>): ExplainCard => ({
  id: 'card', sectionId: 'evidence', kind: 'note', width: 6, height: 'standard', behaviour: 'frozen', ...patch,
});

describe('story export', () => {
  beforeEach(() => {
    useStore.getState().resetWorkspace();
    useStore.setState({ toasts: [] });
  });

  it('carries the explanation and its captured values, but never the source data', () => {
    const store = useStore.getState();
    store.setExplainTitle('Flood exposure in Rotterdam');
    store.updateExplainDocument({ summary: 'Where exposure concentrates.', audience: 'City board' });
    store.updateSettings({ authorName: 'Dany' });
    store.addExplainCard(card({ id: 'note-1', kind: 'note', note: 'Context.' }));
    store.addExplainCard(card({
      id: 'table-1', kind: 'table', title: 'Sample rows',
      frozenValues: [{ id: 1, ward: 'Centrum' }, { id: 2, ward: 'Noord' }],
      provenance: { capturedAt: 1, datasetIds: ['layer-1'], sourceVersions: { 'layer-1': 7 }, filtersByDataset: {}, caveats: [] },
    }));

    const story = createStory();
    expect(story).toMatchObject({ kind: 'alur-story', version: 1, title: 'Flood exposure in Rotterdam', author: 'Dany', audience: 'City board' });
    expect(story.cards).toHaveLength(2);

    // The whole point: no workflow, no datasets, nothing to relink.
    const serialised = serialiseStory(story);
    expect(serialised).not.toContain('"workflow"');
    expect(serialised).not.toContain('"nodes"');
    expect(serialised).not.toContain('relationName');
    // Sources are cited by name, and unknown ones are labelled rather than dropped.
    expect(story.sources).toEqual([{ id: 'layer-1', name: 'Unavailable source', sourceUpdatedAt: undefined }]);

    expect(parseStory(serialised)).toMatchObject({ title: 'Flood exposure in Rotterdam', author: 'Dany' });
  });

  it('reports what a reader would receive, including row-level disclosure', () => {
    const store = useStore.getState();
    store.addExplainCard(card({ id: 'table-1', kind: 'table', title: 'Sample rows', frozenValues: [{ a: 1 }, { a: 2 }, { a: 3 }] }));
    store.addExplainCard(card({ id: 'cmp-1', kind: 'comparison', title: 'Cohorts', frozenValues: comparisonResult() }));
    store.addExplainCard(card({ id: 'map-1', kind: 'map', title: 'Overview', frozenValues: { image: 'data:image/webp;base64,AAAA', width: 10, height: 10, camera: { longitude: 0, latitude: 0, zoom: 1, bearing: 0, pitch: 0 }, basemapId: 'light', layers: [], capturedAt: 1 } }));
    store.addExplainCard(card({ id: 'kpi-1', kind: 'kpi', title: 'Uncaptured metric' }));

    const disclosure = storyDisclosure(createStory());
    expect(disclosure.recordCards).toEqual([
      { id: 'table-1', title: 'Sample rows', rowCount: 3 },
      { id: 'cmp-1', title: 'Cohorts', rowCount: 2 },
    ]);
    expect(disclosure.spatialCards).toEqual([{ id: 'cmp-1', title: 'Cohorts', featureCount: 1 }]);
    expect(disclosure.imageCards).toBe(1);
    // A card with nothing captured is surfaced, not silently shipped as a gap.
    expect(disclosure.emptyCards).toEqual([{ id: 'kpi-1', title: 'Uncaptured metric' }]);
    expect(disclosure.bytes).toBeGreaterThan(0);
  });

  it('can strip row-level evidence while keeping the aggregates', () => {
    const store = useStore.getState();
    store.addExplainCard(card({ id: 'table-1', kind: 'table', title: 'Rows', frozenValues: [{ a: 1 }] }));
    store.addExplainCard(card({ id: 'cmp-1', kind: 'comparison', title: 'Cohorts', frozenValues: comparisonResult() }));

    const stripped = withoutRecordLevelEvidence(createStory());
    const disclosure = storyDisclosure(stripped);
    expect(disclosure.recordCards).toEqual([]);
    expect(disclosure.spatialCards).toEqual([]);
    // Summaries survive, so the argument still stands without the records.
    const comparison = stripped.cards.find((item) => item.id === 'cmp-1')!.frozenValues as ComparisonResult;
    expect(comparison.summaries).toHaveLength(1);
    expect(comparison.alignedRecords).toBeUndefined();
  });

  it('strips map images that are not embedded bitmaps', () => {
    const mapCard = (image: unknown) => JSON.stringify({
      kind: 'alur-story', version: 1, title: 'Shared', sections: [], sources: [],
      cards: [{ id: 'm', sectionId: 'evidence', kind: 'map', width: 12, height: 'tall', behaviour: 'frozen', frozenValues: { image, width: 1, height: 1, camera: {}, basemapId: 'light', layers: [], capturedAt: 1 } }],
    });
    const imageOf = (text: string) => (parseStory(text).cards[0].frozenValues as { image?: string }).image;

    // A story can arrive from a stranger's link, so anything that is not a
    // self-contained bitmap must not reach an <img src>.
    expect(imageOf(mapCard('javascript:alert(1)'))).toBeUndefined();
    expect(imageOf(mapCard('https://tracker.example/pixel.png'))).toBeUndefined();
    expect(imageOf(mapCard('data:text/html;base64,PHNjcmlwdD4='))).toBeUndefined();
    expect(imageOf(mapCard(42))).toBeUndefined();
    expect(imageOf(mapCard('data:image/webp;base64,AAAA'))).toBe('data:image/webp;base64,AAAA');

    // The reader is told why the picture is missing rather than seeing a blank.
    const stripped = parseStory(mapCard('https://tracker.example/pixel.png')).cards[0].frozenValues as { failureReason?: string };
    expect(stripped.failureReason).toMatch(/not a valid embedded image/);
  });

  it('drops malformed cards and sections instead of rendering them', () => {
    const story = parseStory(JSON.stringify({
      kind: 'alur-story', version: 1, title: 'Shared', sources: [],
      sections: [{ id: 'evidence', title: 'Evidence' }, { title: 'No id' }, 'nonsense'],
      cards: [
        { id: 'ok', sectionId: 'evidence', kind: 'note', width: 6, height: 'compact', behaviour: 'frozen' },
        { sectionId: 'evidence', kind: 'note' },
        null,
      ],
    }));
    expect(story.sections).toHaveLength(1);
    expect(story.cards).toHaveLength(1);
  });

  it('builds a shareable link only from a real http(s) address', () => {
    expect(storyLinkFor('https://example.com/a.alur-story.json', 'https://alur.app/'))
      .toBe('https://alur.app/?story=https%3A%2F%2Fexample.com%2Fa.alur-story.json');
    // The param survives round-tripping back out of the link.
    const parsed = new URL(storyLinkFor('https://example.com/a.json', 'https://alur.app/'));
    expect(parsed.searchParams.get(STORY_URL_PARAM)).toBe('https://example.com/a.json');
  });

  it('refuses story links that are not http(s)', async () => {
    await expect(fetchStory('ftp://example.com/story.json')).rejects.toThrow(/HTTP or HTTPS/);
    await expect(fetchStory('javascript:alert(1)')).rejects.toThrow(/HTTP or HTTPS/);
    await expect(fetchStory('not a url at all ::::')).rejects.toThrow(/not a valid URL|HTTP or HTTPS/);
  });

  it('rejects files that are not readable stories', () => {
    expect(() => parseStory('not json')).toThrow(/not valid JSON/);
    expect(() => parseStory(JSON.stringify({ kind: 'alur-project', version: 2 }))).toThrow(/not an ALUR story/);
    expect(() => parseStory(JSON.stringify({ kind: 'alur-story' }))).toThrow(/version is missing/);
    expect(() => parseStory(JSON.stringify({ kind: 'alur-story', version: 99 }))).toThrow(/Update ALUR/);
    expect(() => parseStory(JSON.stringify({ kind: 'alur-story', version: 1, cards: [] }))).toThrow(/structure is invalid/);

    const untitled = parseStory(JSON.stringify({ kind: 'alur-story', version: 1, sections: [], cards: [] } satisfies Partial<AlurStory>));
    expect(untitled.title).toBe('Untitled story');
    expect(untitled.sources).toEqual([]);
  });
});
