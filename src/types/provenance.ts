/**
 * An append-only record of what the analyst did, kept separately from the state
 * those actions produced.
 *
 * ALUR already had two provenance mechanisms and neither answers "how did this
 * come to be". `analysisHistory` is an undo stack: it records *states*, and redo
 * destroys the ones it passes. `AnalysisVariant.provenance` records *derivation*,
 * but only for actions that produced a variant. An action that changed the
 * analysis without producing one — a filter applied and cleared, a weight moved
 * and moved back — left no trace in either.
 *
 * The event shape follows W3C PROV: an activity, an agent that performed it, the
 * entities it used and the entities it generated. That is deliberate. A bespoke
 * shape would have been smaller, but the log is meant to be read outside ALUR.
 */

export const PROVENANCE_SCHEMA_VERSION = 1 as const;

/**
 * What happened. Deliberately domain-neutral: nothing here names a planning
 * intervention, a policy instrument or an analytical domain, because the log is
 * a persisted format and anything written into it is written into every export.
 */
export type ProvenanceActivity =
  // Lines of enquiry. `sessionId` is null on every event until sessions exist.
  | 'session.created'
  | 'session.renamed'
  // Variants — the branchable unit of analysis.
  | 'variant.created'
  | 'variant.branched'
  | 'variant.renamed'
  | 'variant.deleted'
  // Whole-project lifecycle.
  | 'project.saved'
  | 'project.loaded'
  | 'project.imported'
  | 'project.exported'
  // Named, reusable operations the user authored. Authoring and applying are
  // separate acts — an operation can be defined once and placed many times, and
  // an account that called both "applied" could not tell them apart.
  | 'operation.created'
  | 'operation.applied'
  | 'operation.updated'
  | 'operation.removed'
  // Execution.
  | 'workflow.ran'
  | 'sweep.ran'
  // A calculation from outside ALUR. Kept apart from `workflow.ran` because it
  // names code the project does not contain: an account has to be able to say
  // which plugin, at which version, produced a number.
  | 'calculation.configured'
  | 'calculation.ran'
  // Analytical choices that leave no variant behind.
  | 'filter.applied'
  | 'filter.cleared'
  | 'weights.changed'
  | 'dataset.created'
  // Undo is itself an act the analyst performed, so it is logged rather than
  // being allowed to erase the record of what it undid.
  | 'history.undone'
  | 'history.redone';

export type ProvenanceAgent = {
  type: 'user' | 'assistant';
  id: string;
  label: string;
};

export type ProvenanceEntityType =
  | 'session'
  | 'variant'
  | 'dataset'
  | 'operation'
  | 'layer'
  | 'workflow'
  | 'project'
  | 'calculation';

export type ProvenanceEvent = {
  schemaVersion: typeof PROVENANCE_SCHEMA_VERSION;
  id: string;
  /** ISO 8601. */
  timestamp: string;
  activity: ProvenanceActivity;
  agent: ProvenanceAgent;
  /** Null until the session tier exists, and for events outside any session. */
  sessionId: string | null;
  variantId: string | null;
  entityType: ProvenanceEntityType;
  entityId: string | null;
  /** Entity ids consumed by the activity. */
  used: string[];
  /** Entity ids produced by the activity. */
  generated: string[];
  payload: Record<string, unknown>;
  /**
   * Human-readable, generated at write time rather than at read time. Written
   * once, the sentence stays true even after the entities it names are deleted.
   */
  summary: string;
  appVersion: string;
  /**
   * Present only while a continuous gesture is still collapsible. Not part of
   * the account's meaning — a reader can ignore it.
   */
  coalesceKey?: string;
};

export const DEFAULT_PROVENANCE_AGENT: ProvenanceAgent = {
  type: 'user',
  id: 'local-user',
  label: 'You',
};

export const ASSISTANT_PROVENANCE_AGENT: ProvenanceAgent = {
  type: 'assistant',
  id: 'copilot',
  label: 'Copilot',
};
