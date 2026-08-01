import type { Edge } from '@xyflow/react';
import type { WorkflowNode } from '../store/useStore';

/**
 * Named, reusable pieces of a workflow.
 *
 * A fragment turns a run of anonymous nodes into one operation with a name and
 * fill-in-the-blank values — `Retrofit(+N EPC on selected)` rather than four
 * Attribute nodes nobody can read a month later. The point is that ALUR ships
 * no domain vocabulary at all: the user authors it out of generic nodes, and
 * their project file carries it.
 *
 * **Not implemented with DuckDB table macros**, which the original plan
 * proposed. Tested against the engine, a macro cannot do the central job:
 * `CREATE MACRO bump(tbl, target_field, amount) AS TABLE
 *  SELECT * REPLACE (COALESCE(target_field, 0) + amount AS target_field) …`
 * fails with `Column "target_field" in REPLACE list not found in FROM clause`,
 * because macro parameters substitute expressions and not identifiers in
 * binding positions — so the column being changed can never be a parameter.
 * Macros also vanish on reload, making them session state to rebuild on every
 * project open.
 *
 * Instead a fragment expands into ordinary nodes before compilation. Every
 * existing node type works inside one for nothing, the generated SQL stays
 * inspectable, and nothing new has to be kept alive in the database.
 */

/**
 * Parameter types are limited to values that can be validated into a safe SQL
 * fragment. Free text is deliberately absent: a fragment body is interpolated
 * into SQL, and an unconstrained string parameter would be a way to smuggle
 * anything into any query built from the fragment.
 */
export type FragmentParameterType = 'number' | 'field' | 'choice';

export type FragmentParameter = {
  /** Referenced in the body as `{{id}}`. */
  id: string;
  label: string;
  type: FragmentParameterType;
  defaultValue?: string | number;
  /** For `choice`: the values the author allows. */
  options?: string[];
  description?: string;
};

export type WorkflowFragment = {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  nodes: WorkflowNode[];
  edges: Edge[];
  parameters: FragmentParameter[];
  /** Node inside the fragment whose output the fragment exposes. */
  outputNodeId: string;
  /** Nodes inside the fragment that need a connection from outside, in handle order. */
  inputNodeIds: string[];
};

export type FragmentArguments = Record<string, string | number>;

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export const FRAGMENT_PARAMETER_PATTERN = PLACEHOLDER;

/** Identifier that needs no quoting and cannot carry SQL of its own. */
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class FragmentError extends Error {}

/**
 * Turns one argument into the text that replaces its placeholder.
 *
 * Substitution is raw rather than quoted, because that is how every config key
 * it lands in already behaves — an Attribute expression is raw SQL the user
 * wrote, and `resultField` is a bare name the compiler quotes itself. Safety
 * therefore comes from validating the value, not from escaping it at the point
 * of use, which is why free text is not a parameter type.
 */
export const resolveArgument = (parameter: FragmentParameter, raw: unknown): string => {
  const value = raw === undefined || raw === '' ? parameter.defaultValue : raw;
  if (value === undefined || value === '') throw new FragmentError(`"${parameter.label}" needs a value.`);

  if (parameter.type === 'number') {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) throw new FragmentError(`"${parameter.label}" must be a number.`);
    return String(numeric);
  }

  const text = String(value);
  if (parameter.type === 'field') {
    if (!SAFE_IDENTIFIER.test(text)) {
      throw new FragmentError(`"${parameter.label}" must be a plain column name — letters, digits and underscores.`);
    }
    return text;
  }

  // choice
  if (parameter.options?.length && !parameter.options.includes(text)) {
    throw new FragmentError(`"${parameter.label}" must be one of: ${parameter.options.join(', ')}.`);
  }
  if (!SAFE_IDENTIFIER.test(text)) {
    throw new FragmentError(`"${parameter.label}" allows only plain words as options.`);
  }
  return text;
};

/** Every `{{name}}` appearing anywhere in a fragment's node configuration. */
export const placeholdersUsed = (fragment: Pick<WorkflowFragment, 'nodes'>): string[] => {
  const found = new Set<string>();
  const walk = (value: unknown) => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(PLACEHOLDER)) found.add(match[1]);
      return;
    }
    if (Array.isArray(value)) return value.forEach(walk);
    if (value && typeof value === 'object') return Object.values(value).forEach(walk);
  };
  fragment.nodes.forEach((node) => walk(node.data.config));
  return [...found];
};

export const fragmentErrors = (fragment: WorkflowFragment): string[] => {
  const errors: string[] = [];
  if (!fragment.name.trim()) errors.push('Give the operation a name.');
  if (!fragment.nodes.length) errors.push('An operation needs at least one step.');
  if (fragment.nodes.some((node) => node.data.type === 'input')) {
    // An input node loads a specific file; baking one in would make the
    // fragment a copy of one dataset rather than an operation over any.
    errors.push('Data source steps cannot be part of a reusable operation — connect the operation to your data instead.');
  }

  const ids = fragment.parameters.map((parameter) => parameter.id);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate) errors.push(`Two values are both called "${duplicate}".`);
  if (fragment.parameters.some((parameter) => !SAFE_IDENTIFIER.test(parameter.id))) {
    errors.push('Value names must be letters, digits and underscores.');
  }

  const declared = new Set(ids);
  const undeclared = placeholdersUsed(fragment).filter((name) => !declared.has(name));
  if (undeclared.length) errors.push(`${undeclared.map((name) => `{{${name}}}`).join(', ')} is used but not declared as a value.`);

  return errors;
};

/** Worth telling the author about, but not worth refusing to save over. */
export const fragmentWarnings = (fragment: WorkflowFragment): string[] => {
  const used = placeholdersUsed(fragment);
  const unused = fragment.parameters.filter((parameter) => !used.includes(parameter.id));
  return unused.length
    ? [`${unused.map((parameter) => `"${parameter.label}"`).join(', ')} ${unused.length === 1 ? 'is' : 'are'} declared but never used, so nothing will change when set.`]
    : [];
};

const substituteString = (value: string, resolved: Map<string, string>) =>
  value.replace(PLACEHOLDER, (whole, name: string) => {
    const replacement = resolved.get(name);
    if (replacement === undefined) throw new FragmentError(`This operation refers to a value called "${name}" that it does not define.`);
    return replacement;
  });

const substituteConfig = (value: unknown, resolved: Map<string, string>): unknown => {
  if (typeof value === 'string') return substituteString(value, resolved);
  if (Array.isArray(value)) return value.map((item) => substituteConfig(item, resolved));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substituteConfig(item, resolved)]));
  }
  return value;
};

/** Ids of expanded nodes are namespaced by the placed node so two uses never collide. */
export const expandedNodeId = (placedNodeId: string, innerNodeId: string) => `${placedNodeId}__${innerNodeId}`;

export type FragmentExpansion = {
  nodes: WorkflowNode[];
  edges: Edge[];
  /** Expanded node the fragment's consumers should read from. */
  outputNodeId: string;
  /** Expanded nodes that take the placed node's incoming connections, in order. */
  inputNodeIds: string[];
};

/**
 * Rewrites a fragment into ordinary nodes for one placement on the canvas.
 *
 * Node ids are namespaced so the same operation can appear twice in a workflow
 * without its two copies compiling into the same CTE.
 */
export const expandFragment = (
  fragment: WorkflowFragment,
  placedNodeId: string,
  args: FragmentArguments,
): FragmentExpansion => {
  const resolved = new Map<string, string>();
  for (const parameter of fragment.parameters) {
    resolved.set(parameter.id, resolveArgument(parameter, args[parameter.id]));
  }

  const nodes = fragment.nodes.map((node) => ({
    ...node,
    id: expandedNodeId(placedNodeId, node.id),
    data: {
      ...node.data,
      label: node.data.label,
      config: substituteConfig(node.data.config, resolved),
    },
  })) as WorkflowNode[];

  const edges = fragment.edges.map((edge) => ({
    ...edge,
    id: `${placedNodeId}__${edge.id}`,
    source: expandedNodeId(placedNodeId, edge.source),
    target: expandedNodeId(placedNodeId, edge.target),
  }));

  return {
    nodes,
    edges,
    outputNodeId: expandedNodeId(placedNodeId, fragment.outputNodeId),
    inputNodeIds: fragment.inputNodeIds.map((id) => expandedNodeId(placedNodeId, id)),
  };
};

/**
 * Replaces every fragment node in a graph with its expansion.
 *
 * Runs before compilation, so the rest of the engine never learns that
 * fragments exist — which is the whole reason every node type works inside one
 * without being taught to.
 */
export const expandFragments = (
  nodes: WorkflowNode[],
  edges: Edge[],
  library: WorkflowFragment[],
): { nodes: WorkflowNode[]; edges: Edge[]; outputByPlacement: Map<string, string> } => {
  const placements = nodes.filter((node) => node.data.type === 'fragment');
  const outputByPlacement = new Map<string, string>();
  if (!placements.length) return { nodes, edges, outputByPlacement };

  const byId = new Map(library.map((fragment) => [fragment.id, fragment]));
  const expandedNodes: WorkflowNode[] = [];
  // Copies, not references: rewiring below reassigns `source`/`target`, and
  // these objects belong to the store. Mutating them would quietly rewrite the
  // user's canvas every time the workflow was compiled.
  const expandedEdges: Edge[] = edges.map((edge) => ({ ...edge }));

  for (const placement of placements) {
    const fragment = byId.get(placement.data.config?.fragmentId);
    if (!fragment) {
      throw new Error(`"${placement.data.label || placement.id}" refers to an operation this project no longer defines.`);
    }
    const expansion = expandFragment(fragment, placement.id, placement.data.config?.arguments || {});
    expandedNodes.push(...expansion.nodes);
    expandedEdges.push(...expansion.edges);
    // "Run up to this operation" targets the placed node, which no longer
    // exists after expansion; callers use this to find what replaced it.
    outputByPlacement.set(placement.id, expansion.outputNodeId);

    // Rewire: what fed the placed node now feeds the fragment's input steps,
    // and what read from it now reads from the fragment's output step.
    const incoming = expandedEdges.filter((edge) => edge.target === placement.id);
    incoming.forEach((edge, index) => {
      const target = expansion.inputNodeIds[index] ?? expansion.inputNodeIds[0];
      if (target) edge.target = target;
    });
    expandedEdges
      .filter((edge) => edge.source === placement.id)
      .forEach((edge) => { edge.source = expansion.outputNodeId; });
  }

  const placementIds = new Set(placements.map((node) => node.id));
  return {
    nodes: [...nodes.filter((node) => !placementIds.has(node.id)), ...expandedNodes],
    edges: expandedEdges.filter((edge) => !placementIds.has(edge.source) && !placementIds.has(edge.target)),
    outputByPlacement,
  };
};

/**
 * Builds a fragment from a selected run of nodes.
 *
 * The output step is the one nothing else in the selection reads from; the
 * input steps are those whose upstream lies outside it. Deriving both from the
 * graph means the user selects nodes and gets a usable operation, rather than
 * having to nominate its ends.
 */
export const fragmentFromSelection = (
  nodes: WorkflowNode[],
  edges: Edge[],
  selectedIds: string[],
  details: { id: string; name: string; description?: string; parameters?: FragmentParameter[]; createdAt: number },
): WorkflowFragment => {
  const selected = new Set(selectedIds);
  const inner = nodes.filter((node) => selected.has(node.id));
  if (!inner.length) throw new FragmentError('Select the steps to save first.');

  const innerEdges = edges.filter((edge) => selected.has(edge.source) && selected.has(edge.target));
  const consumed = new Set(innerEdges.map((edge) => edge.source));
  const outputs = inner.filter((node) => !consumed.has(node.id));
  if (outputs.length > 1) {
    throw new FragmentError('Select steps that end in a single result — this selection has more than one loose end.');
  }

  const fed = new Set(innerEdges.map((edge) => edge.target));
  const inputs = inner.filter((node) => !fed.has(node.id) && node.data.type !== 'input');

  return {
    id: details.id,
    name: details.name.trim(),
    description: details.description?.trim() || undefined,
    createdAt: details.createdAt,
    nodes: inner,
    edges: innerEdges,
    parameters: details.parameters || [],
    outputNodeId: outputs[0].id,
    inputNodeIds: inputs.map((node) => node.id),
  };
};
