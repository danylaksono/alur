import type { WorkflowNode } from '../store/useStore';

/**
 * Lets a node config name a value instead of holding one.
 *
 * A variant already carried `parameters`, but nothing read them: a variant was
 * a *shape* of graph, so exploring five thresholds meant five near-identical
 * graphs. A config that says `{ threshold: { $param: 'cutoff' } }` makes the
 * graph a specification and the variant the thing that fills it in — which is
 * what lets one workflow be run across many variants.
 *
 * Deliberately not an expression language. A reference names a parameter and
 * nothing more; anything cleverer belongs in a node the analyst can see.
 */
export type ParameterReference = {
  $param: string;
  /**
   * Used when the parameter is not supplied. Without one, adding a reference
   * would make the workflow unrunnable outside a sweep — which is a trap, not
   * a safeguard.
   */
  default?: unknown;
};

export const isParameterReference = (value: unknown): value is ParameterReference =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value) && typeof (value as ParameterReference).$param === 'string';

export class MissingParameterError extends Error {}

const resolveValue = (value: unknown, parameters: Record<string, unknown>, nodeId: string): unknown => {
  if (isParameterReference(value)) {
    if (value.$param in parameters) return parameters[value.$param];
    if ('default' in value) return value.default;
    throw new MissingParameterError(
      `Node "${nodeId}" needs a value for "${value.$param}". Set it on the variant being run, or give the reference a default.`,
    );
  }
  if (Array.isArray(value)) return value.map((item) => resolveValue(item, parameters, nodeId));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, resolveValue(item, parameters, nodeId)]));
  }
  return value;
};

/**
 * Substitutes every reference in every node config. Runs after fragments are
 * expanded, so a saved operation's internal steps can reference parameters too.
 */
export const resolveNodeParameters = (nodes: WorkflowNode[], parameters: Record<string, unknown> = {}): WorkflowNode[] => {
  if (!nodes.some((node) => configUsesParameters(node.data.config))) return nodes;
  return nodes.map((node) =>
    configUsesParameters(node.data.config)
      ? { ...node, data: { ...node.data, config: resolveValue(node.data.config, parameters, node.id) } }
      : node,
  );
};

const configUsesParameters = (value: unknown): boolean => {
  if (isParameterReference(value)) return true;
  if (Array.isArray(value)) return value.some(configUsesParameters);
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).some(configUsesParameters);
  return false;
};

/**
 * Indicative values for the editor's previews and schema probes.
 *
 * Those surfaces compile the graph continuously while it is being built, long
 * before any sweep runs. Compiling strictly there meant a node whose parameter
 * had no default broke every downstream preview and column list — the analyst
 * could not see the shape of the thing they were configuring. Taking the first
 * variant that defines each value is arbitrary but honest: a preview has always
 * been one view of the data, not the result.
 */
export const indicativeParameters = (variants: Array<{ parameters?: Record<string, unknown> }>): Record<string, unknown> => {
  const values: Record<string, unknown> = {};
  for (const variant of variants) {
    for (const [key, value] of Object.entries(variant.parameters || {})) {
      if (!(key in values)) values[key] = value;
    }
  }
  return values;
};

/** Every parameter the graph names, for showing what a sweep can vary. */
export const parametersUsed = (nodes: WorkflowNode[]): string[] => {
  const found = new Set<string>();
  const walk = (value: unknown) => {
    if (isParameterReference(value)) { found.add(value.$param); return; }
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (value && typeof value === 'object') Object.values(value as Record<string, unknown>).forEach(walk);
  };
  nodes.forEach((node) => walk(node.data.config));
  return [...found].sort();
};
