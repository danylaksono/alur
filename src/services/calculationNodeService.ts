import type { Edge } from '@xyflow/react';
import type { WorkflowNode } from '../store/useStore';
import type { DatasetDescriptor } from '../types/datasets';
import type { OperationInputBinding, OperationManifest } from '../types/operations';
import type { VariantOperation } from '../types/visualAnalytics';
import { buildUpToSQL } from '../utils/workflowEngine';
import type { WorkflowFragment } from '../utils/workflowFragments';
import { duckdbService } from './duckdb';
import { ensureWorkflowDataset } from './datasetService';
import { operationHost } from './operationHost';
import { runOperation, type OperationRunReport } from './operationRunner';
import { operationsForProvider } from '../utils/operationRecords';
import { useStore } from '../store/useStore';

/**
 * A calculation as a step in the graph.
 *
 * ALUR compiles a whole workflow into one chain of CTEs and hands it to DuckDB.
 * A calculation cannot join that chain — it is arbitrary JavaScript running in a
 * worker, and no SELECT expresses "where you go next depends on everywhere you
 * have already been". So the graph is cut in two at the node: everything above
 * it compiles and runs as SQL, the result is read out and handed to the
 * provider, and what comes back is written to a table the node then stands for.
 *
 * That makes a calculation node behave downstream exactly like a loaded file —
 * which is why the compiler change is three lines and why every node type
 * already in the app works after one without being taught that calculations
 * exist. It also makes the phase boundary honest and visible: the node holds a
 * result until you run it again, and says so when what feeds it has moved on.
 */

/** What the node keeps. Code is resolved live; only the address of it is saved. */
export type CalculationNodeConfig = {
  /** Empty for a calculation compiled into the app, which needs no fetching. */
  pluginUrl: string;
  calculationId: string;
  /**
   * Recorded so a project opened against a newer plugin can say the version has
   * moved rather than silently running a different calculation under the same
   * id, and so the node still reads without the plugin installed.
   */
  calculationVersion?: string;
  label?: string;
  /**
   * Role bindings: input, then the upstream node supplying it, then role to
   * column. Nested this deep because an input may take several upstream nodes
   * and each names its own columns for the same roles — which is the whole point
   * of binding by role rather than by name.
   */
  fields?: Record<string, Record<string, Record<string, string>>>;
  parameters?: Record<string, unknown>;
  /** Which declared output this node passes downstream. Defaults to the first. */
  outputId?: string;
  /** Set once run. Until then the node has nothing to offer downstream. */
  tableName?: string;
  ranAt?: number;
  rowCount?: number;
  /** What the last run was against, so the node can notice it has gone stale. */
  fingerprint?: string;
};

/**
 * The handle an input's edges arrive at.
 *
 * Named after the input rather than positional so that reordering a manifest's
 * inputs cannot silently rewire a saved graph.
 */
export const calculationInputHandle = (inputId: string) => `in-${inputId}`;

/** Upstream nodes feeding one declared input, in a stable order. */
export const calculationSources = (nodeId: string, inputId: string, edges: Edge[]) => {
  const handle = calculationInputHandle(inputId);
  return edges
    .filter((edge) => edge.target === nodeId && (edge.targetHandle || '') === handle)
    .map((edge) => edge.source)
    .filter((source, index, all) => all.indexOf(source) === index)
    .sort();
};

const hash = (value: string) => {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
};

const safeTable = (value: string) => {
  const cleaned = value.replace(/[^a-zA-Z0-9_]/g, '_');
  return /^[0-9]/.test(cleaned) ? `t_${cleaned}` : cleaned;
};

/**
 * Everything a result depends on, in one string.
 *
 * Upstream is represented by its compiled SQL rather than by node ids, so any
 * edit anywhere above the node — a changed filter threshold, a reconnected edge,
 * a different source file — shows up here. The scenario is included too: the
 * same method under a different set of assertions is a different answer, and a
 * node that kept quiet about that would be the most dangerous kind of stale.
 */
export const calculationFingerprint = ({
  manifest,
  config,
  upstreamSql,
  operations,
  variantId,
}: {
  manifest: Pick<OperationManifest, 'id' | 'version' | 'inputs'>;
  config: CalculationNodeConfig;
  upstreamSql: Record<string, string[]>;
  operations: VariantOperation[];
  variantId: string;
}) =>
  hash(
    JSON.stringify({
      calculation: `${manifest.id}@${manifest.version}`,
      inputs: manifest.inputs.map((input) => [input.id, upstreamSql[input.id] ?? []]),
      fields: config.fields ?? {},
      parameters: config.parameters ?? {},
      outputId: config.outputId ?? '',
      variantId,
      // Only what this calculation is subject to. A change recorded against a
      // different provider is a real change to the scenario but not to this
      // answer, and marking the node stale for it would train people to ignore
      // the warning.
      operations: operationsForProvider(operations, manifest.id).map((operation) => ({
        changeId: operation.changeId,
        target: operation.target,
        parameters: operation.parameters,
        sequence: operation.sequence,
      })),
    }),
  );

/** The live manifest for a node, loading its plugin if it is not installed yet. */
export const resolveCalculation = async (config: CalculationNodeConfig): Promise<OperationManifest> => {
  const installed = await operationHost.installed();
  const found = installed
    .flatMap((plugin) => plugin.calculations)
    .find((manifest) => manifest.id === config.calculationId);
  if (found) return found;

  if (!config.pluginUrl) {
    throw new Error(
      `"${config.calculationId}" is not installed. This project was made with a plugin this copy of ALUR does not have.`,
    );
  }
  const loaded = await operationHost.loadPlugin(config.pluginUrl);
  const fetched = loaded.calculations.find((manifest) => manifest.id === config.calculationId);
  if (!fetched) {
    throw new Error(`${loaded.plugin.label} no longer offers "${config.calculationId}".`);
  }
  return fetched;
};

/**
 * Run one upstream branch and leave its rows in a table.
 *
 * Written to a table named for the pair rather than through the ordinary
 * materialisation path on purpose: this is scaffolding for the calculation, not
 * a result anybody asked for, and putting a map layer on screen for every branch
 * of every run would bury the answer under its own intermediates.
 */
const materialiseBranch = async (
  nodeId: string,
  sourceNodeId: string,
  nodes: WorkflowNode[],
  edges: Edge[],
  fragments: WorkflowFragment[],
): Promise<{ dataset: DatasetDescriptor; sql: string }> => {
  const workflow = buildUpToSQL(nodes, edges, sourceNodeId, { fragments });
  if (workflow.needsH3) await duckdbService.ensureH3();

  const tableName = safeTable(`alur_calcin_${nodeId}_${sourceNodeId}`);
  await duckdbService.materializeQueryAsTable(workflow.resultSql, tableName);

  const label = nodes.find((node) => node.id === sourceNodeId)?.data.label || sourceNodeId;
  const dataset = await ensureWorkflowDataset(sourceNodeId, tableName, label);

  // The descriptor the dataset service builds is deliberately geometry-blind —
  // it exists to give any table a stable row id. A calculation needs more than
  // that: whether there is geometry at all decides which shape the provider is
  // handed, and the CRS decides whether the coordinates in it mean anything.
  // Read off the fields already gathered rather than re-querying, so the two
  // cannot disagree about the same table.
  const spatial = dataset.fields.some((field) => {
    const name = field.name.toLowerCase();
    return field.type.toLowerCase() === 'geometry' || ['geometry', 'geom', 'wkb_geometry'].includes(name);
  });

  return {
    sql: workflow.resultSql,
    dataset: {
      ...dataset,
      // Scoped to this node: two calculations reading the same upstream branch
      // must not fight over one registry entry, and the bindings name this id.
      id: `calcin:${nodeId}:${sourceNodeId}`,
      spatial,
      geometryCrs: spatial ? workflow.geomCrs : undefined,
    },
  };
};

/**
 * An identifier for data that has none.
 *
 * A required identifier role is the one binding an analyst usually cannot
 * satisfy: mid-pipeline data rarely carries a unique column, and demanding one
 * would make most calculations unusable on most graphs. The dataset service has
 * already established a row id for exactly this reason, so the shell supplies it
 * rather than making the analyst invent one.
 *
 * Only ever a fallback. A real identifier — a UPRN, a ward code — is worth
 * choosing, because it is what makes a result joinable back to anything else,
 * and an explicit binding always wins.
 */
export const withRowIdFallback = (
  input: OperationManifest['inputs'][number],
  fields: Record<string, string>,
  dataset: DatasetDescriptor,
) => {
  const filled = { ...fields };
  for (const role of input.fields) {
    if (filled[role.id]) continue;
    if (role.required && role.semanticType === 'identifier') filled[role.id] = dataset.rowIdColumn;
  }
  return filled;
};

export type CalculationNodeRun = {
  tableName: string;
  datasetId: string;
  rowCount: number;
  fingerprint: string;
  report: OperationRunReport;
};

/**
 * One pass of the phase boundary: compile above, calculate, write below.
 *
 * Reads the store directly rather than taking the graph as an argument, for the
 * same reason `commitDrawnLayer` does — the node is a button, and threading five
 * slices of state through it would only invite them to disagree.
 */
export const runCalculationNode = async (nodeId: string): Promise<CalculationNodeRun> => {
  const state = useStore.getState();
  const node = state.nodes.find((candidate) => candidate.id === nodeId);
  if (!node || node.data.type !== 'calculation') {
    throw new Error(`"${nodeId}" is not a calculation node.`);
  }

  const config = (node.data.config || {}) as CalculationNodeConfig;
  const manifest = await resolveCalculation(config);

  const variants = state.visualAnalytics.variants;
  const activeSessionId = state.visualAnalytics.activeSessionId;
  const scoped = activeSessionId
    ? variants.filter((variant) => variant.sessionId === activeSessionId)
    : variants;
  const variant = scoped[0];

  const datasets: Record<string, DatasetDescriptor> = {};
  const bindings: OperationInputBinding[] = [];
  const upstreamSql: Record<string, string[]> = {};

  for (const input of manifest.inputs) {
    const sources = calculationSources(nodeId, input.id, state.edges);
    if (!sources.length) {
      throw new Error(`${input.label} has nothing connected to it. Draw an edge into that handle first.`);
    }
    if (sources.length > 1 && !input.multiple) {
      throw new Error(`${input.label} takes one source, but ${sources.length} are connected.`);
    }

    upstreamSql[input.id] = [];
    const bound: OperationInputBinding['sources'] = [];
    for (const sourceNodeId of sources) {
      const branch = await materialiseBranch(nodeId, sourceNodeId, state.nodes, state.edges, state.fragments);
      datasets[branch.dataset.id] = branch.dataset;
      upstreamSql[input.id].push(branch.sql);
      bound.push({
        datasetId: branch.dataset.id,
        fields: withRowIdFallback(input, config.fields?.[input.id]?.[sourceNodeId] ?? {}, branch.dataset),
      });
    }
    bindings.push({ inputId: input.id, sources: bound });
  }

  /**
   * Row-targeted changes cannot be translated for a node run, so they are held
   * back rather than applied to the wrong rows.
   *
   * A `rows` change names the dataset the analyst had selected — a loaded file.
   * What a node reads is a mid-pipeline branch with its own row numbering, and
   * there is no general way to say which row of the file a filtered, joined,
   * re-numbered row corresponds to. `resolveRowTargets` needs the original
   * descriptor to do that translation and does not have it here, so passing
   * these through would silently apply the analyst's assertion to whichever
   * rows happened to land on those numbers. Dropping them and saying so is the
   * only honest option until a node can carry an identity back to its source;
   * the dialog, which binds loaded datasets directly, applies them correctly.
   */
  const scenario = operationsForProvider(variant?.operations ?? [], manifest.id);
  const targeted = scenario.filter((operation) => operation.target?.kind === 'rows');
  const applicable = scenario.filter((operation) => operation.target?.kind !== 'rows');

  const report = await runOperation(
    {
      providerUrl: config.pluginUrl,
      manifest,
      bindings,
      datasets,
      parameters: config.parameters ?? {},
      operations: applicable,
    },
    // The node's own label, which defaults to the calculation's but can be
    // renamed — two steps running the same calculation should not produce two
    // identically named datasets.
    { runLabel: node.data.label },
  );

  const outputId = config.outputId || manifest.outputs[0]?.id;
  const produced = report.created.find((created) => created.outputId === outputId) ?? report.created[0];
  if (!produced) {
    throw new Error(
      `${manifest.label} ran but produced no dataset for this node to pass on.${report.warnings.length ? ` ${report.warnings[0]}` : ''}`,
    );
  }

  if (targeted.length) {
    report.warnings.push(
      `${targeted.length} change${targeted.length === 1 ? '' : 's'} recorded on selected rows ${targeted.length === 1 ? 'was' : 'were'} not applied: a node reads a mid-pipeline result, which cannot be matched back to the rows you selected in the source data. Run this calculation from the toolbox to apply them.`,
    );
  }

  const rowCount = await duckdbService.getTableFeatureCount(produced.tableName);
  const fingerprint = calculationFingerprint({
    manifest,
    config,
    upstreamSql,
    operations: variant?.operations ?? [],
    variantId: variant?.id ?? '',
  });


  const store = useStore.getState();
  store.updateNode(nodeId, {
    ...config,
    calculationVersion: manifest.version,
    label: manifest.label,
    outputId: produced.outputId,
    tableName: produced.tableName,
    rowCount,
    ranAt: Date.now(),
    fingerprint,
  });
  // Makes the node's result addressable the way every other run path does, so a
  // variant built on this node knows which dataset it just produced.
  store.registerWorkflowNodeOutput(nodeId, produced.tableName);
  store.recordProvenance({
    activity: 'calculation.ran',
    entityId: nodeId,
    used: Object.keys(datasets),
    generated: [produced.tableName],
    payload: {
      nodeId,
      calculationId: manifest.id,
      calculationVersion: manifest.version,
      outputId: produced.outputId,
      rowCount,
      variantId: variant?.id,
    },
  });

  return { tableName: produced.tableName, datasetId: produced.tableName, rowCount, fingerprint, report };
};

/**
 * Whether a node's held result still answers the graph it sits in.
 *
 * Cheap enough to call while rendering: it compiles the upstream SQL, which is
 * string work over a graph that is already in memory, and never touches DuckDB.
 * Returning `null` for "cannot tell yet" matters — an upstream source still
 * loading must not be reported as staleness, or the node would cry wolf every
 * time a file is opened.
 */
export const calculationStaleness = ({
  nodeId,
  nodes,
  edges,
  fragments,
  manifest,
  operations,
  variantId,
}: {
  nodeId: string;
  nodes: WorkflowNode[];
  edges: Edge[];
  fragments: WorkflowFragment[];
  manifest: Pick<OperationManifest, 'id' | 'version' | 'inputs'> | null;
  operations: VariantOperation[];
  variantId: string;
}): { stale: boolean; fingerprint: string } | null => {
  const node = nodes.find((candidate) => candidate.id === nodeId);
  const config = (node?.data.config || {}) as CalculationNodeConfig;
  if (!manifest || !config.fingerprint) return null;

  const upstreamSql: Record<string, string[]> = {};
  try {
    for (const input of manifest.inputs) {
      upstreamSql[input.id] = calculationSources(nodeId, input.id, edges).map(
        (sourceNodeId) => buildUpToSQL(nodes, edges, sourceNodeId, { fragments }).resultSql,
      );
    }
  } catch {
    return null;
  }

  const fingerprint = calculationFingerprint({ manifest, config, upstreamSql, operations, variantId });
  return { stale: fingerprint !== config.fingerprint, fingerprint };
};
