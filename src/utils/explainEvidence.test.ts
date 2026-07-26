import { describe, expect, it } from 'vitest';
import type { ExplainDocument } from '../types/visualAnalytics';
import { evaluateExplainDocument, explainHealthCounts } from './explainEvidence';

const document = (): ExplainDocument => ({
  title: 'Test',
  sections: [{ id: 'evidence', title: 'Evidence' }, { id: 'conclusion', title: 'Conclusion' }],
  cards: [
    { id: 'e1', sectionId: 'evidence', kind: 'table', width: 6, height: 'compact', behaviour: 'frozen', provenance: { capturedAt: 1, datasetIds: ['d1'], sourceVersions: { d1: 1 }, filtersByDataset: {}, caveats: [] } },
    { id: 'f1', sectionId: 'conclusion', kind: 'finding', claim: 'Claim', conclusionStatus: 'supported', width: 6, height: 'compact', behaviour: 'frozen', evidenceLinks: [] },
  ],
});

describe('Explain evidence health', () => {
  it('flags unsupported findings and missing takeaways without blocking authoring', () => {
    const issues = evaluateExplainDocument(document(), { d1: 1 });
    expect(issues.map((issue) => issue.id)).toContain('unsupported-f1');
    expect(issues.map((issue) => issue.id)).toContain('takeaway-e1');
    expect(explainHealthCounts(issues)).toMatchObject({ errors: 1, suggestions: 1 });
  });

  it('detects stale and missing sources and accepts linked support', () => {
    const value = document();
    value.cards[1].evidenceLinks = [{ cardId: 'e1', role: 'supports' }];
    expect(evaluateExplainDocument(value, { d1: 2 }).some((issue) => issue.id.startsWith('stale-'))).toBe(true);
    expect(evaluateExplainDocument(value, {}).some((issue) => issue.id.startsWith('missing-'))).toBe(true);
    expect(evaluateExplainDocument(value, { d1: 1 }).some((issue) => issue.id === 'unsupported-f1')).toBe(false);
  });
});
