import packageJson from '../../package.json';
import {
  DEFAULT_PROVENANCE_AGENT,
  PROVENANCE_SCHEMA_VERSION,
  type ProvenanceActivity,
  type ProvenanceAgent,
  type ProvenanceEntityType,
  type ProvenanceEvent,
} from '../types/provenance';

let sequence = 0;

/**
 * Ids only need to be unique within one log. `Date.now()` alone collides when
 * several events are emitted inside a single action, so a counter carries the
 * ordering that the timestamp cannot.
 */
export const createProvenanceId = (prefix = 'prov') =>
  `${prefix}-${Date.now().toString(36)}-${(sequence++).toString(36)}`;

const ENTITY_FOR_ACTIVITY: Record<ProvenanceActivity, ProvenanceEntityType> = {
  'calculation.configured': 'calculation',
  'calculation.ran': 'calculation',
  'session.created': 'session',
  'session.renamed': 'session',
  'variant.created': 'variant',
  'variant.branched': 'variant',
  'variant.renamed': 'variant',
  'variant.deleted': 'variant',
  'project.saved': 'project',
  'project.loaded': 'project',
  'project.imported': 'project',
  'project.exported': 'project',
  'operation.created': 'operation',
  'operation.applied': 'operation',
  'operation.updated': 'operation',
  'operation.removed': 'operation',
  'workflow.ran': 'workflow',
  'sweep.ran': 'workflow',
  'filter.applied': 'dataset',
  'filter.cleared': 'dataset',
  'weights.changed': 'variant',
  'dataset.created': 'dataset',
  'history.undone': 'project',
  'history.redone': 'project',
};

const asText = (value: unknown, fallback: string) => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return fallback;
};

const asCount = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

const plural = (count: number, singular: string, pluralForm = `${singular}s`) =>
  `${count.toLocaleString()} ${count === 1 ? singular : pluralForm}`;

/** Top three by weight, as percentages — the rest is noise in a one-line summary. */
const describeWeights = (value: unknown) => {
  if (!value || typeof value !== 'object') return 'no weights';
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, raw]) => [key, Number(raw)] as const)
    .filter(([, weight]) => Number.isFinite(weight) && weight > 0)
    .sort((a, b) => b[1] - a[1]);
  if (!entries.length) return 'no weights';
  const shown = entries.slice(0, 3).map(([key, weight]) => `${key} ${Math.round(weight * 100)}%`);
  const remainder = entries.length - shown.length;
  return remainder > 0 ? `${shown.join(', ')} and ${remainder} more` : shown.join(', ');
};

/**
 * The sentence stored on the event. Generated when the event is written, not
 * when it is read, so it still describes what happened after the variant or
 * dataset it names has been deleted.
 */
export function summariseProvenance(activity: ProvenanceActivity, payload: Record<string, unknown> = {}): string {
  const name = () => asText(payload.name, 'untitled');
  const rename = () => `“${asText(payload.from, 'untitled')}” to “${asText(payload.to, 'untitled')}”`;

  switch (activity) {
    case 'session.created':
      return payload.question
        ? `Started “${name()}”, asking: ${asText(payload.question, '')}`
        : `Started “${name()}”`;
    case 'session.renamed':
      return `Renamed the line of enquiry from ${rename()}`;
    case 'variant.created':
      return `Created variant “${name()}”`;
    case 'variant.branched':
      return `Branched “${asText(payload.name, 'untitled')}” from “${asText(payload.parentName, 'untitled')}”`;
    case 'variant.renamed':
      return `Renamed variant from ${rename()}`;
    case 'variant.deleted':
      return `Deleted variant “${name()}”`;
    case 'project.saved':
      return `Saved project “${name()}”`;
    case 'project.loaded':
      return `Opened project “${name()}”`;
    case 'project.imported':
      return `Imported project “${name()}”`;
    case 'project.exported':
      return `Exported project “${name()}”`;
    case 'operation.created': {
      const steps = asCount(payload.nodeCount);
      return steps === null
        ? `Saved “${name()}” as a reusable operation`
        : `Saved “${name()}” as a reusable operation (${plural(steps, 'step')})`;
    }
    case 'operation.applied': {
      const steps = asCount(payload.nodeCount);
      return steps === null
        ? `Applied operation “${name()}”`
        : `Applied operation “${name()}” (${plural(steps, 'step')})`;
    }
    case 'operation.updated':
      return `Updated operation “${name()}”`;
    case 'operation.removed':
      return `Removed operation “${name()}”`;
    case 'workflow.ran': {
      const nodes = asCount(payload.nodeCount);
      const rows = asCount(payload.rowCount);
      const scope = nodes === null ? 'the workflow' : plural(nodes, 'node');
      return rows === null ? `Ran ${scope}` : `Ran ${scope}, producing ${plural(rows, 'row')}`;
    }
    case 'sweep.ran': {
      const variants = asCount(payload.variantCount);
      const failed = asCount(payload.failed);
      const scope = variants === null ? 'variants' : plural(variants, 'variant');
      // A partial sweep is the interesting case, so the count that failed is
      // part of the sentence rather than something to look up afterwards.
      return failed ? `Ran the workflow across ${scope}, ${failed} failing` : `Ran the workflow across ${scope}`;
    }
    case 'calculation.configured': {
      return `Set up ${asText(payload.label, 'a calculation')}`;
    }
    case 'calculation.ran': {
      const label = asText(payload.label, 'a calculation');
      const version = asText(payload.version, '');
      const datasets = asCount(payload.datasetCount);
      // The version is in the sentence rather than the payload alone: a number
      // produced by a plugin is only accountable if the account says which
      // build of it ran.
      const what = version ? `${label} ${version}` : label;
      return datasets === null
        ? `Ran ${what}`
        : `Ran ${what}, producing ${plural(datasets, 'dataset')}`;
    }
    case 'filter.applied': {
      const label = asText(payload.description, asText(payload.field, 'a condition'));
      const removed = asCount(payload.removedCount);
      return removed === null ? `Filtered on ${label}` : `Filtered on ${label}, excluding ${plural(removed, 'row')}`;
    }
    case 'filter.cleared': {
      const count = asCount(payload.count);
      if (count !== null) return `Cleared ${plural(count, 'filter')}`;
      return payload.field ? `Cleared the filter on ${asText(payload.field, 'a field')}` : 'Cleared all filters';
    }
    case 'weights.changed':
      return `Changed weights to ${describeWeights(payload.weights)}`;
    case 'dataset.created': {
      const features = asCount(payload.featureCount);
      return features === null
        ? `Created dataset “${name()}”`
        : `Created dataset “${name()}” with ${plural(features, 'feature')}`;
    }
    case 'history.undone':
      return `Undid: ${asText(payload.label, 'the last change')}`;
    case 'history.redone':
      return `Redid: ${asText(payload.label, 'the last change')}`;
    default: {
      // Exhaustiveness guard: a new activity without a sentence fails to compile.
      const unreachable: never = activity;
      return String(unreachable);
    }
  }
}

export type ProvenanceEventInput = {
  activity: ProvenanceActivity;
  agent?: ProvenanceAgent;
  sessionId?: string | null;
  variantId?: string | null;
  entityType?: ProvenanceEntityType;
  entityId?: string | null;
  used?: string[];
  generated?: string[];
  payload?: Record<string, unknown>;
  /** Overrides the generated sentence. Rarely needed. */
  summary?: string;
  /**
   * Collapses a continuous gesture into the one action it represents. Dragging
   * a weight slider arrives as dozens of state updates; the account should say
   * the analyst changed a weight, not replay every frame on the way there.
   * Events sharing a key within {@link PROVENANCE_COALESCE_WINDOW_MS} replace
   * their predecessor, so the log keeps where the gesture landed.
   */
  coalesceKey?: string;
  /** Injectable for deterministic tests. */
  timestamp?: string;
  id?: string;
};

export function createProvenanceEvent(input: ProvenanceEventInput): ProvenanceEvent {
  const payload = input.payload || {};
  const entityType = input.entityType || ENTITY_FOR_ACTIVITY[input.activity];
  return {
    ...(input.coalesceKey ? { coalesceKey: input.coalesceKey } : {}),
    schemaVersion: PROVENANCE_SCHEMA_VERSION,
    id: input.id || createProvenanceId('prov-event'),
    timestamp: input.timestamp || new Date().toISOString(),
    activity: input.activity,
    agent: input.agent || DEFAULT_PROVENANCE_AGENT,
    sessionId: input.sessionId ?? null,
    variantId: input.variantId ?? null,
    entityType,
    entityId: input.entityId ?? input.variantId ?? input.sessionId ?? null,
    used: input.used ? [...input.used] : [],
    generated: input.generated ? [...input.generated] : [],
    payload,
    summary: input.summary || summariseProvenance(input.activity, payload),
    appVersion: packageJson.version,
  };
}

/**
 * The log is append-only, but it is not unbounded: a long session would
 * otherwise grow the project file without limit. Trimming from the front keeps
 * the most recent account intact, which is what the lineage view reads.
 */
export const PROVENANCE_EVENT_LIMIT = 5000;

/** Matches the undo stack's window, so a gesture is one entry in both records. */
export const PROVENANCE_COALESCE_WINDOW_MS = 700;

export function appendProvenanceEvent(events: ProvenanceEvent[], event: ProvenanceEvent): ProvenanceEvent[] {
  const latest = events[events.length - 1];
  const continuesGesture =
    Boolean(event.coalesceKey) &&
    latest?.coalesceKey === event.coalesceKey &&
    Date.parse(event.timestamp) - Date.parse(latest.timestamp) <= PROVENANCE_COALESCE_WINDOW_MS;
  // Replacing keeps where the gesture landed rather than where it started.
  const next = continuesGesture ? [...events.slice(0, -1), event] : [...events, event];
  return next.length > PROVENANCE_EVENT_LIMIT ? next.slice(next.length - PROVENANCE_EVENT_LIMIT) : next;
}

/**
 * Guards a frozen account read back from a story file, which is arbitrary JSON
 * written by an older build. Only the fields the account renders are checked —
 * a story missing `used`/`generated` should still be readable.
 */
export const isProvenanceAccount = (value: unknown): value is ProvenanceEvent[] =>
  Array.isArray(value) &&
  value.every(
    (event) =>
      Boolean(event) &&
      typeof event === 'object' &&
      typeof (event as ProvenanceEvent).id === 'string' &&
      typeof (event as ProvenanceEvent).activity === 'string' &&
      typeof (event as ProvenanceEvent).timestamp === 'string' &&
      typeof (event as ProvenanceEvent).summary === 'string',
  );

/** Events belonging to one line of enquiry, oldest first. */
export const eventsForSession = (events: ProvenanceEvent[], sessionId: string | null) =>
  events.filter((event) => event.sessionId === sessionId);

/** Events that touched one variant, either as subject or as an input. */
export const eventsForVariant = (events: ProvenanceEvent[], variantId: string) =>
  events.filter(
    (event) =>
      event.variantId === variantId ||
      event.entityId === variantId ||
      event.used.includes(variantId) ||
      event.generated.includes(variantId),
  );
