import type { Edge } from '@xyflow/react';
import type { WorkflowNode } from '../store/useStore';
import { allocationErrors, summaryMeasureErrors } from './aggregationSql';
import { scoreModelErrors } from './scoreModel';
import { filterPredicateErrors } from './filterPredicates';
import { spatialFunctions } from './spatialFunctions';

/**
 * Whether a step has what it needs, answered at rest.
 *
 * ModelBuilder draws an unconfigured tool white and a configured one coloured,
 * and that single distinction is what lets you read a canvas at a glance. This
 * is the same question, asked of every node at once — which the compiler cannot
 * answer, because it stops at the first thing that stops it.
 *
 * The compiler remains the authority on whether a graph will run; where a
 * detailed check already exists there, it is imported rather than restated, so
 * the two cannot drift apart.
 */
export type NodeReadiness = { ready: true } | { ready: false; reason: string };

const READY: NodeReadiness = { ready: true };
const notReady = (reason: string): NodeReadiness => ({ ready: false, reason });

/** Sources hold a table once some step has been taken; the rest read an edge. */
const SOURCE_TYPES = new Set(['input', 'geometry', 'calculation']);

export const isSourceNode = (type: string) => SOURCE_TYPES.has(type);

/** How many incoming connections this node needs before it can do anything. */
export const requiredInputs = (node: WorkflowNode): number => {
  const { type, config } = node.data;
  if (isSourceNode(type)) return 0;
  if (type === 'join') return 2;
  if (type === 'analysis') {
    const operation = config?.operation as string | undefined;
    return spatialFunctions.find((fn) => fn.name === operation)?.requiredInputCount ?? 1;
  }
  return 1;
};

const configReadiness = (node: WorkflowNode): NodeReadiness => {
  const { type, config } = node.data;

  if (isSourceNode(type)) {
    if (config?.tableName) return READY;
    return notReady(
      type === 'geometry'
        ? 'Draw features, then create the dataset'
        : type === 'calculation'
          ? 'Run the calculation to produce a result'
          : 'Load a file to use as the source',
    );
  }

  switch (type) {
    case 'analysis':
      return config?.operation ? READY : notReady('Choose a spatial operation');

    case 'join':
      if ((config?.mode || 'spatial') !== 'attribute') return READY;
      return config?.leftKey && config?.rightKey
        ? READY
        : notReady('Choose the key field on each side');

    case 'aggregate': {
      // Dissolve merges geometry and needs no measures; the numeric mode does.
      if (config?.mode === 'dissolve') return READY;
      const errors = summaryMeasureErrors(Array.isArray(config?.measures) ? config.measures : []);
      return errors.length ? notReady(errors[0]) : READY;
    }

    case 'score': {
      const errors = scoreModelErrors(
        config?.scoreModel || { criteria: [], missingValueTreatment: 'zero' },
      );
      return errors.length ? notReady(errors[0]) : READY;
    }

    case 'allocate': {
      const errors = allocationErrors(config || {});
      return errors.length ? notReady(errors[0]) : READY;
    }

    case 'filter': {
      const mode = config?.mode || 'condition';
      if (mode === 'top-n') {
        if (!config?.field) return notReady('Choose a column to rank by');
        const count = Number(config?.count);
        return Number.isFinite(count) && count >= 1
          ? READY
          : notReady('Set how many rows to keep');
      }
      if (mode === 'criteria') {
        const errors = filterPredicateErrors(
          Array.isArray(config?.predicates) ? config.predicates : [],
        );
        return errors.length ? notReady(errors[0]) : READY;
      }
      // A map selection narrows the rows on its own, so it satisfies this node
      // whether or not a clause was typed — matching what the compiler does.
      const hasSelection = Array.isArray(config?.selectionIds) && config.selectionIds.length > 0;
      if (mode === 'selection') {
        return hasSelection ? READY : notReady('Select features on the map to filter by');
      }
      // A WHERE-mode filter compiles with no condition — it just filters
      // nothing. That is a step nobody meant to leave behind, so it reads as
      // unfinished rather than as a working no-op.
      return hasSelection || String(config?.condition || '').trim()
        ? READY
        : notReady('Write a WHERE condition');
    }

    case 'attribute':
      return String(config?.expression || '').trim()
        ? READY
        : notReady('Write an expression for the new column');

    default:
      // h3, visualisation, output and fragment carry their own defaults or are
      // validated only by the compiler; being connected is all they need here.
      return READY;
  }
};

/**
 * Readiness for one node. `incoming` is how many edges arrive at it, which the
 * caller already knows from the graph.
 */
export const nodeReadiness = (node: WorkflowNode, incoming: number): NodeReadiness => {
  // A group is a label on the canvas, not a step. It has nothing to be ready for.
  if (node.data.type === 'group') return READY;
  if (node.data.disabled) return READY;

  const needed = requiredInputs(node);
  if (incoming < needed) {
    if (needed > 1) {
      return notReady(
        node.data.type === 'join'
          ? 'Connect both inputs (A = left, B = right)'
          : `Connect ${needed} inputs`,
      );
    }
    return notReady('Connect a source');
  }

  return configReadiness(node);
};

/** Readiness for every node on the canvas, keyed by node id. */
export const workflowReadiness = (
  nodes: WorkflowNode[],
  edges: Edge[],
): Record<string, NodeReadiness> => {
  const incoming = new Map<string, number>();
  for (const edge of edges) {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  }
  return Object.fromEntries(
    nodes.map((node) => [node.id, nodeReadiness(node, incoming.get(node.id) ?? 0)]),
  );
};
