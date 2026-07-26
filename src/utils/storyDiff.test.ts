import { describe, expect, it } from 'vitest';
import { diffStories } from './storyDiff';
import type { AlurStory } from '../types/story';
import type { ExplainCard } from '../types/visualAnalytics';

const finding = (id: string, claim: string, patch: Partial<ExplainCard> = {}): ExplainCard => ({
  id, sectionId: 'conclusion', kind: 'finding', width: 6, height: 'standard', behaviour: 'frozen',
  claim, conclusionStatus: 'supported', ...patch,
});

const story = (patch: Partial<AlurStory>): AlurStory => ({
  kind: 'alur-story', version: 1, appVersion: '0.1.0', exportedAt: '2026-07-26T00:00:00.000Z',
  title: 'Story', sections: [{ id: 'conclusion', title: 'Conclusion' }], cards: [], sources: [], ...patch,
});

const evidence = (id: string, datasetId: string, version: number): ExplainCard => ({
  id, sectionId: 'evidence', kind: 'kpi', width: 6, height: 'compact', behaviour: 'frozen',
  provenance: { capturedAt: 1, datasetIds: [datasetId], sourceVersions: { [datasetId]: version }, filtersByDataset: {}, caveats: [] },
});

describe('story diff', () => {
  it('pairs findings by wording and separates agreement from conflict', () => {
    const mine = story({ cards: [
      finding('a', 'Flood exposure concentrates in the northern wards'),
      finding('b', 'Older housing stock correlates with higher risk'),
      finding('c', 'Only I looked at drainage capacity'),
    ] });
    const theirs = story({ cards: [
      finding('x', 'Flood exposure concentrates in northern wards', { conclusionStatus: 'contested' }),
      finding('y', 'Older housing stock correlates with higher risk'),
      finding('z', 'Only they examined evacuation routes'),
    ] });

    const diff = diffStories(mine, theirs);
    expect(diff.counts).toEqual({ agreements: 1, conflicts: 1, onlyLeft: 1, onlyRight: 1 });
    // Conflicts sort first — they are why anyone opens the view.
    expect(diff.claims[0].status).toBe('conflict');
    expect(diff.claims[0].left?.id).toBe('a');
    expect(diff.claims[0].right?.id).toBe('x');
    expect(diff.claims[0].similarity).toBeGreaterThan(0.4);
  });

  it('flags a conflict as genuine only when both sides used the same inputs and question', () => {
    const base = (cardId: string, datasetId: string, version: number, status: ExplainCard['conclusionStatus']) => story({
      sources: [{ id: datasetId, name: 'need_london.parquet', sourceUpdatedAt: version }],
      cards: [
        evidence(`ev-${cardId}`, datasetId, version),
        finding(cardId, 'Northern wards carry the highest exposure', { conclusionStatus: status, evidenceLinks: [{ cardId: `ev-${cardId}`, role: 'supports' }] }),
      ],
    });

    // Same source, same version — a real disagreement about interpretation.
    const genuine = diffStories(base('a', 'layer-1', 7, 'supported'), base('b', 'layer-9', 7, 'contested'));
    expect(genuine.claims[0].status).toBe('conflict');
    expect(genuine.claims[0].reasons).toEqual([]);

    // Same source read at different versions — not a disagreement, different inputs.
    const stale = diffStories(base('a', 'layer-1', 7, 'supported'), base('b', 'layer-9', 9, 'contested'));
    expect(stale.claims[0].status).toBe('conflict');
    expect(stale.claims[0].reasons).toContain('different-source-versions');
  });

  it('notices when the two sides did not read the same datasets', () => {
    const mine = story({
      sources: [{ id: 'l1', name: 'london.parquet' }],
      cards: [evidence('ev1', 'l1', 1), finding('a', 'Exposure is rising steadily', { evidenceLinks: [{ cardId: 'ev1', role: 'supports' }] })],
    });
    const theirs = story({
      sources: [{ id: 'l2', name: 'manchester.parquet' }],
      cards: [evidence('ev2', 'l2', 1), finding('b', 'Exposure is rising steadily', { conclusionStatus: 'contested', evidenceLinks: [{ cardId: 'ev2', role: 'supports' }] })],
    });

    const diff = diffStories(mine, theirs);
    expect(diff.claims[0].reasons).toContain('different-sources');
    expect(diff.sharedSources).toEqual([]);
    expect(diff.leftOnlySources).toEqual(['london.parquet']);
    expect(diff.rightOnlySources).toEqual(['manchester.parquet']);
  });

  it('matches sources by name, since two analysts give the same file different ids', () => {
    const withId = (datasetId: string, cardId: string) => story({
      sources: [{ id: datasetId, name: 'shared.parquet', sourceUpdatedAt: 4 }],
      cards: [evidence(`ev-${cardId}`, datasetId, 4), finding(cardId, 'The same conclusion exactly', { evidenceLinks: [{ cardId: `ev-${cardId}`, role: 'supports' }] })],
    });
    const diff = diffStories(withId('local-abc', 'a'), withId('local-xyz', 'b'));
    expect(diff.claims[0].reasons).toEqual([]);
    expect(diff.sharedSources).toEqual(['shared.parquet']);
  });

  it('does not treat an uncommitted draft as contradicting a position', () => {
    const mine = story({ cards: [finding('a', 'Risk is concentrated downstream', { conclusionStatus: 'supported' })] });
    const theirs = story({ cards: [finding('b', 'Risk is concentrated downstream', { conclusionStatus: 'draft' })] });
    expect(diffStories(mine, theirs).claims[0].status).toBe('agreement');
  });

  it('ignores cards that are not findings and handles empty accounts', () => {
    const notes = story({ cards: [{ id: 'n', sectionId: 'evidence', kind: 'note', note: 'Some context', width: 6, height: 'compact', behaviour: 'frozen' }] });
    const diff = diffStories(notes, story({}));
    expect(diff.claims).toEqual([]);
    expect(diff.counts).toEqual({ agreements: 0, conflicts: 0, onlyLeft: 0, onlyRight: 0 });
  });

  it('does not pair one finding against several', () => {
    const mine = story({ cards: [finding('a', 'Northern wards show the highest exposure')] });
    const theirs = story({ cards: [
      finding('x', 'Northern wards show the highest exposure'),
      finding('y', 'Northern wards show the highest exposure levels'),
    ] });
    const diff = diffStories(mine, theirs);
    expect(diff.counts.onlyRight).toBe(1);
    expect(diff.claims.filter((claim) => claim.left).length).toBe(1);
  });
});
