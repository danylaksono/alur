import type { OperationChange, OperationManifest, OperationTarget } from '../types/operations';
import type { VariantOperation } from '../types/visualAnalytics';

/**
 * The ordered list of changes a variant asserts, and the rules for reading it.
 *
 * A variant already held `operations: VariantOperation[]`, and that list already
 * survived branching, export and undo. What it lacked was an order anyone could
 * rely on — position in an array is not a contract — and a way to hand the list
 * to something outside ALUR. Both are here; neither introduces a new place where
 * state lives, which is the point. There is no cursor and no separate stack: the
 * app's own undo history owns undo, and the resolved state at any moment is a
 * pure function of the records present at that moment.
 */

/**
 * Give every record an explicit position, ordering by an existing `sequence`
 * where one is present and by array position where it is not.
 *
 * Pre-provider projects have neither sequences nor gaps, so their array order is
 * authoritative and is preserved exactly. Mixed lists — a project part-migrated
 * by a session that added one new record — sort by sequence first, which is the
 * only reading that keeps an explicit assertion ahead of an implicit one.
 */
/**
 * Renumber by current array position, taking the array as authoritative.
 *
 * Kept apart from `withSequence` because the two disagree on purpose, and a
 * single function doing both silently loses reorders: `withSequence` trusts the
 * recorded sequence and sorts by it, so running it after a deliberate move would
 * sort the record straight back to where it came from.
 */
export const resequence = (operations: VariantOperation[]): VariantOperation[] =>
  operations.map((operation, index) => (operation.sequence === index ? operation : { ...operation, sequence: index }));

export const withSequence = (operations: VariantOperation[]): VariantOperation[] =>
  resequence(
    operations
      .map((operation, index) => ({ operation, index }))
      .sort((a, b) => {
        const left = a.operation.sequence ?? a.index;
        const right = b.operation.sequence ?? b.index;
        return left === right ? a.index - b.index : left - right;
      })
      .map(({ operation }) => operation),
  );

export const nextSequence = (operations: VariantOperation[]) =>
  operations.reduce((highest, operation, index) => Math.max(highest, (operation.sequence ?? index) + 1), 0);

export const appendOperation = (operations: VariantOperation[], operation: VariantOperation): VariantOperation[] =>
  resequence([...withSequence(operations), { ...operation, createdAt: operation.createdAt ?? Date.now() }]);

export const removeOperation = (operations: VariantOperation[], operationId: string): VariantOperation[] =>
  resequence(withSequence(operations).filter((operation) => operation.id !== operationId));

/**
 * Move one record to a new position.
 *
 * Order is not cosmetic here — a provider is handed the list in sequence order
 * and may well produce a different answer for a different order, so reordering
 * is a change to the analysis and not a change to a display.
 */
export const moveOperation = (operations: VariantOperation[], operationId: string, targetIndex: number): VariantOperation[] => {
  const ordered = withSequence(operations);
  const from = ordered.findIndex((operation) => operation.id === operationId);
  if (from < 0) return ordered;

  const to = Math.max(0, Math.min(ordered.length - 1, targetIndex));
  if (from === to) return ordered;

  const next = [...ordered];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return resequence(next);
};

/** Records belonging to one provider, in order. */
export const operationsForProvider = (operations: VariantOperation[], providerId: string): VariantOperation[] =>
  withSequence(operations).filter((operation) => operation.providerId === providerId);

/**
 * The records a provider is handed, in the shape its contract expects.
 *
 * Records with no target are dropped rather than passed through: those are model
 * parameters, and a provider receives those via `setParameters`. Sending a
 * setting down the change channel would make it look like an assertion about a
 * place that has none.
 */
export const toOperationChanges = (operations: VariantOperation[], providerId: string): OperationChange[] =>
  operationsForProvider(operations, providerId)
    .filter((operation): operation is VariantOperation & { target: OperationTarget; changeId: string } =>
      Boolean(operation.target && operation.changeId))
    .map((operation, index) => ({
      id: operation.id,
      changeId: operation.changeId,
      sequence: operation.sequence ?? index,
      target: operation.target,
      values: operation.parameters,
    }));

/**
 * What the analyst has asserted about, grouped for display.
 *
 * Not a comparison of results — ALUR has `comparisonService` for that, and it
 * does the job properly against real relations. This answers the cheaper
 * question the map needs on every edit: which units carry an assertion, and
 * where the analyst put something that was not there before.
 */
export type OperationFootprint = {
  /** Dataset id to the row ids some record targets. */
  rowsByDataset: Record<string, string[]>;
  /** Geometry a record placed, in sequence order. */
  placed: Array<{ operationId: string; changeId?: string; geometry: GeoJSON.Geometry }>;
};

export const operationFootprint = (operations: VariantOperation[]): OperationFootprint => {
  const rowsByDataset: Record<string, Set<string>> = {};
  const placed: OperationFootprint['placed'] = [];

  for (const operation of withSequence(operations)) {
    const target = operation.target;
    if (!target) continue;
    if (target.kind === 'rows') {
      const bucket = (rowsByDataset[target.datasetId] ??= new Set());
      for (const rowId of target.rowIds) bucket.add(rowId);
    } else {
      placed.push({ operationId: operation.id, changeId: operation.changeId, geometry: target.geometry });
    }
  }

  return {
    rowsByDataset: Object.fromEntries(Object.entries(rowsByDataset).map(([datasetId, ids]) => [datasetId, [...ids]])),
    placed,
  };
};

export const OPERATION_EXPORT_VERSION = 1 as const;

export type OperationExport = {
  kind: 'alur-operations';
  version: typeof OPERATION_EXPORT_VERSION;
  exportedAt: string;
  /** Recorded so an import can say which provider it needs, before running it. */
  providerIds: string[];
  operations: VariantOperation[];
};

export const exportOperations = (operations: VariantOperation[]): OperationExport => {
  const ordered = withSequence(operations);
  return {
    kind: 'alur-operations',
    version: OPERATION_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    providerIds: [...new Set(ordered.map((operation) => operation.providerId).filter((id): id is string => Boolean(id)))],
    operations: ordered,
  };
};

export type OperationImport = { operations: VariantOperation[]; warnings: string[] };

/**
 * Read an exported list back.
 *
 * Missing providers are a warning and not an error. In an open ecosystem the
 * ordinary case is opening someone else's work without their calculation
 * installed, and the right response is to keep the record — which is the
 * citable artifact — and say what cannot be run, rather than to refuse the file.
 */
export const importOperations = (
  value: unknown,
  knownProviderIds: string[] = [],
): OperationImport => {
  if (!value || typeof value !== 'object') throw new Error('Not an operation export.');
  const payload = value as Partial<OperationExport>;
  if (payload.kind !== 'alur-operations') throw new Error('Not an operation export.');
  if (payload.version !== OPERATION_EXPORT_VERSION) {
    throw new Error(`Operation export version ${String(payload.version)} is not supported.`);
  }
  if (!Array.isArray(payload.operations)) throw new Error('The export carries no operations.');

  const warnings: string[] = [];
  const known = new Set(knownProviderIds);
  for (const providerId of payload.providerIds ?? []) {
    if (!known.has(providerId)) warnings.push(`No calculation named "${providerId}" is registered; its operations are kept but cannot be run.`);
  }

  for (const operation of payload.operations) {
    if (!operation?.id || !operation?.type) throw new Error('An operation record is missing an id or a type.');
  }

  return { operations: withSequence(payload.operations), warnings };
};

/**
 * A one-line account of what a record asserts, generated from the provider's own
 * declaration so the history reads without a decoder.
 */
export const summariseOperation = (operation: VariantOperation, manifest?: OperationManifest): string => {
  const spec = manifest?.accepts.find((change) => change.id === operation.changeId);
  const label = spec?.label ?? manifest?.label ?? operation.type;
  const target = operation.target;

  if (!target) return `${label} (setting)`;
  if (target.kind === 'rows') {
    return `${label} on ${target.rowIds.length} ${target.rowIds.length === 1 ? 'unit' : 'units'}`;
  }
  return `${label} at a ${target.geometry.type.toLowerCase()}`;
};
