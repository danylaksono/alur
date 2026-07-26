import type { AlurStory } from '../types/story';
import type { ExplainCard } from '../types/visualAnalytics';

/**
 * Why two findings that look like they disagree might not.
 *
 * Most apparent disagreements between analysts are different scopes rather
 * than different answers, and the provenance to tell them apart is already
 * captured on every card. Surfacing that distinction is the whole point of
 * comparing stories: a conflict worth arguing about is one where both sides
 * looked at the same data, at the same version, asking the same question.
 */
export type DivergenceReason = 'different-sources' | 'different-source-versions' | 'different-scope';

export type ClaimComparison = {
  key: string;
  left?: ExplainCard;
  right?: ExplainCard;
  status: 'agreement' | 'conflict' | 'only-left' | 'only-right';
  reasons: DivergenceReason[];
  /** 0–1 wording overlap; 1 means the claims are textually identical. */
  similarity: number;
};

export type StoryDiff = {
  claims: ClaimComparison[];
  sharedSources: string[];
  leftOnlySources: string[];
  rightOnlySources: string[];
  counts: { agreements: number; conflicts: number; onlyLeft: number; onlyRight: number };
};

/** Wording match is deliberately crude — the UI says so rather than implying more. */
const MATCH_THRESHOLD = 0.4;

const STOPWORDS = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'of', 'in', 'on', 'to', 'and', 'or', 'for', 'with', 'that', 'this', 'it', 'be', 'by', 'at', 'as', 'from', 'no', 'not']);

const tokens = (text: string) =>
  new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter((word) => word.length > 2 && !STOPWORDS.has(word)),
  );

const jaccard = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
};

const findings = (story: AlurStory) => story.cards.filter((card) => card.kind === 'finding' && card.claim?.trim());

/** Datasets a finding rests on, following its evidence links as well as itself. */
const evidenceFor = (story: AlurStory, card: ExplainCard) => {
  const linked = (card.evidenceLinks || [])
    .map((link) => story.cards.find((item) => item.id === link.cardId))
    .filter((item): item is ExplainCard => Boolean(item));
  const cards = [card, ...linked];
  const sourceVersions = new Map<string, string | number | undefined>();
  const scopes: string[] = [];
  for (const item of cards) {
    for (const id of item.provenance?.datasetIds || []) {
      sourceVersions.set(id, item.provenance?.sourceVersions[id]);
    }
    const spec = item.provenance?.comparisonSpec;
    if (spec) {
      scopes.push(JSON.stringify({
        operands: spec.operands.map((operand) => [operand.datasetId, operand.scope.kind]).sort(),
        measures: spec.measures.map((measure) => [measure.aggregation, ...Object.values(measure.fields)]).sort(),
      }));
    }
  }
  // Sources are matched by name, since two analysts loading the same file will
  // have different local dataset ids for it.
  const names = new Set(
    [...sourceVersions.keys()].map((id) => story.sources.find((source) => source.id === id)?.name || id),
  );
  return { names, sourceVersions, scopes: scopes.sort() };
};

const divergenceReasons = (story: AlurStory, left: ExplainCard, rightStory: AlurStory, right: ExplainCard): DivergenceReason[] => {
  const a = evidenceFor(story, left);
  const b = evidenceFor(rightStory, right);
  const reasons: DivergenceReason[] = [];

  const shared = [...a.names].filter((name) => b.names.has(name));
  if (a.names.size !== b.names.size || shared.length !== a.names.size) reasons.push('different-sources');

  const versionMismatch = shared.some((name) => {
    const aId = [...a.sourceVersions.keys()].find((id) => (story.sources.find((source) => source.id === id)?.name || id) === name);
    const bId = [...b.sourceVersions.keys()].find((id) => (rightStory.sources.find((source) => source.id === id)?.name || id) === name);
    const aVersion = aId ? a.sourceVersions.get(aId) : undefined;
    const bVersion = bId ? b.sourceVersions.get(bId) : undefined;
    return aVersion !== undefined && bVersion !== undefined && aVersion !== bVersion;
  });
  if (versionMismatch) reasons.push('different-source-versions');

  if (JSON.stringify(a.scopes) !== JSON.stringify(b.scopes)) reasons.push('different-scope');
  return reasons;
};

const conflicts = (left: ExplainCard, right: ExplainCard) => {
  const a = left.conclusionStatus || 'draft';
  const b = right.conclusionStatus || 'draft';
  if (a === b) return false;
  // A draft has not committed to anything, so it cannot contradict a position.
  return a !== 'draft' && b !== 'draft';
};

/**
 * Compares two accounts of the same subject.
 *
 * Findings are paired on claim wording — crude, but transparent, and the only
 * thing available across authors who share no identifiers.
 */
export const diffStories = (left: AlurStory, right: AlurStory): StoryDiff => {
  const leftFindings = findings(left);
  const rightFindings = findings(right);
  const rightTokens = rightFindings.map((card) => tokens(card.claim || ''));
  const takenRight = new Set<number>();
  const claims: ClaimComparison[] = [];

  for (const card of leftFindings) {
    const cardTokens = tokens(card.claim || '');
    let bestIndex = -1;
    let best = 0;
    rightTokens.forEach((candidate, index) => {
      if (takenRight.has(index)) return;
      const score = jaccard(cardTokens, candidate);
      if (score > best) { best = score; bestIndex = index; }
    });

    if (bestIndex >= 0 && best >= MATCH_THRESHOLD) {
      takenRight.add(bestIndex);
      const match = rightFindings[bestIndex];
      claims.push({
        key: card.id,
        left: card,
        right: match,
        status: conflicts(card, match) ? 'conflict' : 'agreement',
        reasons: divergenceReasons(left, card, right, match),
        similarity: best,
      });
      continue;
    }
    claims.push({ key: card.id, left: card, status: 'only-left', reasons: [], similarity: 0 });
  }

  rightFindings.forEach((card, index) => {
    if (takenRight.has(index)) return;
    claims.push({ key: card.id, right: card, status: 'only-right', reasons: [], similarity: 0 });
  });

  // Conflicts first: they are the reason anyone opens this view.
  const order = { conflict: 0, agreement: 1, 'only-left': 2, 'only-right': 3 } as const;
  claims.sort((a, b) => order[a.status] - order[b.status] || b.similarity - a.similarity);

  const leftNames = new Set(left.sources.map((source) => source.name));
  const rightNames = new Set(right.sources.map((source) => source.name));

  return {
    claims,
    sharedSources: [...leftNames].filter((name) => rightNames.has(name)),
    leftOnlySources: [...leftNames].filter((name) => !rightNames.has(name)),
    rightOnlySources: [...rightNames].filter((name) => !leftNames.has(name)),
    counts: {
      agreements: claims.filter((claim) => claim.status === 'agreement').length,
      conflicts: claims.filter((claim) => claim.status === 'conflict').length,
      onlyLeft: claims.filter((claim) => claim.status === 'only-left').length,
      onlyRight: claims.filter((claim) => claim.status === 'only-right').length,
    },
  };
};
