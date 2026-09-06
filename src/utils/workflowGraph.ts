import type { Edge } from '@xyflow/react';

/**
 * Graph-shape questions the workflow asks before it will accept an edge.
 *
 * Kept apart from the SQL compiler so the canvas and the store can both reject
 * a bad connection without pulling the whole engine in to do it.
 */

/** Adjacency in the direction data flows: source → targets. */
const outgoing = (edges: Edge[]) => {
  const map = new Map<string, string[]>();
  for (const edge of edges) {
    map.set(edge.source, [...(map.get(edge.source) || []), edge.target]);
  }
  return map;
};

/**
 * Would adding `source → target` close a loop?
 *
 * True when the target already reaches the source, because the new edge would
 * then complete the ring. A node wired to itself counts, which is the degenerate
 * case a mis-aimed drag produces most often.
 */
export const wouldCreateCycle = (edges: Edge[], source: string, target: string): boolean => {
  if (source === target) return true;
  const adjacency = outgoing(edges);
  const seen = new Set<string>();
  const stack = [target];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === source) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(adjacency.get(id) || []));
  }
  return false;
};

/**
 * The nodes a topological sort cannot place, which is exactly the set that sits
 * on or downstream of a cycle. Returned rather than thrown so the canvas can
 * mark every affected node instead of naming only the first one found.
 */
export const findCycleNodes = (nodeIds: string[], edges: Edge[]): string[] => {
  const inDegree = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  const adjacency = outgoing(edges);
  for (const edge of edges) {
    if (!inDegree.has(edge.target)) continue;
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const queue = nodeIds.filter((id) => inDegree.get(id) === 0);
  const placed = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    placed.add(id);
    for (const next of adjacency.get(id) || []) {
      const degree = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, degree);
      if (degree === 0) queue.push(next);
    }
  }

  return nodeIds.filter((id) => !placed.has(id));
};

/**
 * Which node an engine error belongs to, or null.
 *
 * The compiler names the offending node as `"<id>"` inside its message. Matching
 * on that exact quoted form against the ids actually on the canvas is precise —
 * an id either appears in the message or it does not — and it keeps the ~28
 * throw sites in the engine free of plumbing they would otherwise all carry.
 */
export const nodeIdFromWorkflowError = (message: string, nodeIds: string[]): string | null =>
  nodeIds.find((id) => message.includes(`"${id}"`)) ?? null;
