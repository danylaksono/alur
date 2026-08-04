import type { AnalysisVariant } from '../types/visualAnalytics';

/**
 * Reconstructs how a set of scenarios came to be.
 *
 * Every branch already records its parent and its parameters; nothing here
 * infers anything. The work is turning that into the two things a reader
 * actually asks of a scenario — *what did you assume* and *how does this one
 * differ from the one it came from* — neither of which was displayed anywhere
 * despite both being captured from the start.
 */

export type VariantDifference = {
  /** Dotted path into the variant's parameters, humanised where possible. */
  path: string;
  before: unknown;
  after: unknown;
};

export type VariantTreeNode = {
  variant: AnalysisVariant;
  depth: number;
  children: VariantTreeNode[];
  /** Empty for a root, or when a branch has not been edited yet. */
  differencesFromParent: VariantDifference[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * Names an array element by its own identity rather than its position.
 *
 * `criteria.0.weight` tells a reader nothing and changes meaning when a
 * criterion is inserted above it; `criteria.Gcons2023.weight` says what moved.
 * Generic on purpose — score criteria, summary measures and filter predicates
 * all carry one of these keys.
 */
const elementKey = (element: unknown, index: number) => {
  if (isRecord(element)) {
    for (const key of ['field', 'label', 'name', 'id']) {
      const value = element[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
  }
  return String(index);
};

const flatten = (value: unknown, prefix: string, into: Map<string, unknown>) => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, `${prefix}.${elementKey(item, index)}`, into));
    return;
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) flatten(item, prefix ? `${prefix}.${key}` : key, into);
    return;
  }
  into.set(prefix, value);
};

/**
 * Every leaf value that defines what a variant does.
 *
 * Operations are keyed by type rather than by id, because a branch gets fresh
 * operation ids — keying by id would report every operation as replaced rather
 * than as edited, which is the opposite of useful.
 */
export const flattenVariantParameters = (variant: AnalysisVariant): Map<string, unknown> => {
  const flat = new Map<string, unknown>();
  flatten(variant.parameters, 'parameters', flat);
  variant.operations.forEach((operation, index) => {
    const seenBefore = variant.operations.slice(0, index).filter((item) => item.type === operation.type).length;
    const key = seenBefore ? `${operation.type} ${seenBefore + 1}` : operation.type;
    flatten(operation.parameters, key, flat);
  });
  return flat;
};

const same = (a: unknown, b: unknown) =>
  a === b || (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b));

/** What changed between a variant and the one it branched from. */
export const variantDifferences = (child: AnalysisVariant, parent: AnalysisVariant | undefined): VariantDifference[] => {
  if (!parent) return [];
  const before = flattenVariantParameters(parent);
  const after = flattenVariantParameters(child);
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  return paths
    .filter((path) => !same(before.get(path), after.get(path)))
    .map((path) => ({ path, before: before.get(path), after: after.get(path) }));
};

/**
 * The variant forest, parents before children.
 *
 * A variant whose parent is missing is treated as a root rather than dropped:
 * losing a scenario from the account because its ancestor was deleted would be
 * worse than showing it without its origin.
 */
export const buildVariantTree = (variants: AnalysisVariant[]): VariantTreeNode[] => {
  const byId = new Map(variants.map((variant) => [variant.id, variant]));
  const childrenOf = new Map<string, AnalysisVariant[]>();
  const roots: AnalysisVariant[] = [];

  for (const variant of variants) {
    const parentId = variant.parentVariantId;
    if (parentId && byId.has(parentId)) {
      childrenOf.set(parentId, [...(childrenOf.get(parentId) || []), variant]);
    } else {
      roots.push(variant);
    }
  }

  const byCreation = (a: AnalysisVariant, b: AnalysisVariant) => a.createdAt - b.createdAt;
  const seen = new Set<string>();
  const build = (variant: AnalysisVariant, depth: number): VariantTreeNode => {
    // A parent cycle would otherwise recurse forever. It should not happen, but
    // this data survives hand-edited project files.
    seen.add(variant.id);
    return {
      variant,
      depth,
      differencesFromParent: variantDifferences(variant, variant.parentVariantId ? byId.get(variant.parentVariantId) : undefined),
      children: (childrenOf.get(variant.id) || []).filter((child) => !seen.has(child.id)).sort(byCreation).map((child) => build(child, depth + 1)),
    };
  };

  return roots.sort(byCreation).map((root) => build(root, 0));
};

/** Depth-first order, which is how the tree reads top to bottom. */
export const flattenVariantTree = (nodes: VariantTreeNode[]): VariantTreeNode[] =>
  nodes.flatMap((node) => [node, ...flattenVariantTree(node.children)]);

/**
 * Variants whose result is one of the datasets a card was built from.
 *
 * This is the link that lets a chart or table state the assumptions behind it:
 * the card records which datasets it used, and a variant records which dataset
 * it produced.
 */
export const variantsBehindDatasets = (variants: AnalysisVariant[], datasetIds: string[]): AnalysisVariant[] => {
  if (!datasetIds.length) return [];
  const wanted = new Set(datasetIds);
  return variants.filter((variant) => variant.workflowOutputDatasetId && wanted.has(variant.workflowOutputDatasetId));
};

/** Assumptions from every variant behind a card, de-duplicated in order. */
export const assumptionsBehindDatasets = (variants: AnalysisVariant[], datasetIds: string[]): string[] => {
  const seen = new Set<string>();
  const assumptions: string[] = [];
  for (const variant of variantsBehindDatasets(variants, datasetIds)) {
    for (const assumption of variant.assumptions) {
      const text = assumption.trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      assumptions.push(text);
    }
  }
  return assumptions;
};

export type VariantLineageRow = {
  id: string;
  name: string;
  depth: number;
  hasResult: boolean;
  assumptions: string[];
  differences: VariantDifference[];
};

export type VariantLineageSnapshot = {
  capturedAt: number;
  rows: VariantLineageRow[];
};

/**
 * A serialisable, flattened lineage.
 *
 * Flattened because a story is read in a browser that has none of this state —
 * it must travel inside the card, and depth carries the nesting that the tree
 * shape would otherwise have to.
 */
export const variantLineageSnapshot = (
  variants: AnalysisVariant[],
  hasResult: (variant: AnalysisVariant) => boolean,
  capturedAt = 0,
): VariantLineageSnapshot => ({
  capturedAt,
  rows: flattenVariantTree(buildVariantTree(variants)).map((node) => ({
    id: node.variant.id,
    name: node.variant.name,
    depth: node.depth,
    hasResult: hasResult(node.variant),
    assumptions: node.variant.assumptions,
    differences: node.differencesFromParent,
  })),
});

export const isVariantLineageSnapshot = (value: unknown): value is VariantLineageSnapshot =>
  Boolean(value) && typeof value === 'object' && Array.isArray((value as VariantLineageSnapshot).rows);

/** Short, readable rendering of a value inside a difference. */
export const formatVariantValue = (value: unknown): string => {
  if (value === undefined) return '—';
  if (value === null) return 'none';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
};
