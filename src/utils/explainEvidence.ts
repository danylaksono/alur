import type { ExplainCard, ExplainDocument } from '../types/visualAnalytics';

export type ExplainHealthIssue = {
  id: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  cardId?: string;
  sectionId?: string;
};

const evidenceKinds = new Set<ExplainCard['kind']>(['chart', 'kpi', 'table', 'comparison', 'map']);

export const isExplainEvidenceCard = (card: ExplainCard) => evidenceKinds.has(card.kind);

export const evaluateExplainDocument = (
  document: ExplainDocument,
  currentSourceVersions: Record<string, string | number | undefined> = {},
): ExplainHealthIssue[] => {
  const issues: ExplainHealthIssue[] = [];
  const cards = new Map(document.cards.map((card) => [card.id, card]));

  for (const section of document.sections) {
    const sectionCards = document.cards.filter((card) => card.sectionId === section.id);
    if (!sectionCards.length && section.presentationVisibility === 'always') issues.push({ id: `empty-always-${section.id}`, severity: 'warning', sectionId: section.id, message: `${section.title} is forced visible but contains no content.` });
  }

  for (const card of document.cards) {
    if (isExplainEvidenceCard(card) && !card.takeaway?.trim()) issues.push({ id: `takeaway-${card.id}`, severity: 'info', cardId: card.id, message: 'Evidence has no stated takeaway.' });
    for (const datasetId of card.provenance?.datasetIds || []) {
      if (!(datasetId in currentSourceVersions)) issues.push({ id: `missing-${card.id}-${datasetId}`, severity: 'error', cardId: card.id, message: 'An evidence source is missing.' });
      else if (card.provenance?.sourceVersions[datasetId] !== undefined && card.provenance.sourceVersions[datasetId] !== currentSourceVersions[datasetId]) issues.push({ id: `stale-${card.id}-${datasetId}`, severity: 'warning', cardId: card.id, message: 'Evidence was captured from an older source version.' });
    }
    if (card.kind !== 'finding') continue;
    const links = card.evidenceLinks || [];
    if (!card.claim?.trim()) issues.push({ id: `claim-${card.id}`, severity: 'warning', cardId: card.id, message: 'Finding has no claim.' });
    for (const link of links) if (!cards.has(link.cardId)) issues.push({ id: `broken-link-${card.id}-${link.cardId}`, severity: 'error', cardId: card.id, message: 'Finding links to evidence that no longer exists.' });
    const supporting = links.filter((link) => link.role === 'supports' && cards.has(link.cardId));
    const contradicting = links.filter((link) => link.role === 'contradicts' && cards.has(link.cardId));
    if (card.conclusionStatus === 'supported' && !supporting.length) issues.push({ id: `unsupported-${card.id}`, severity: 'error', cardId: card.id, message: 'Finding is marked supported but has no supporting evidence.' });
    if (card.conclusionStatus === 'supported' && contradicting.length && !card.caveat?.trim()) issues.push({ id: `uncaveated-${card.id}`, severity: 'warning', cardId: card.id, message: 'Supported finding has contradictory evidence but no caveat.' });
  }

  const conclusion = document.sections.find((section) => section.id === 'conclusion');
  if (conclusion && !document.cards.some((card) => card.sectionId === conclusion.id)) issues.push({ id: 'empty-conclusion', severity: 'warning', sectionId: conclusion.id, message: 'No conclusion has been recorded.' });
  return issues;
};

export const explainHealthCounts = (issues: ExplainHealthIssue[]) => ({
  errors: issues.filter((issue) => issue.severity === 'error').length,
  warnings: issues.filter((issue) => issue.severity === 'warning').length,
  suggestions: issues.filter((issue) => issue.severity === 'info').length,
});
