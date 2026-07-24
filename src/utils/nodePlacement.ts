import type { WorkflowNode } from '../store/useStore';

const NODE_WIDTH = 240;
const H_GAP = 60;

/**
 * Where to drop a newly added node: to the right of the rightmost existing
 * node, roughly aligned with it — new nodes extend the DAG in flow direction
 * instead of piling up in the top-left corner.
 */
export const nextNodePosition = (nodes: WorkflowNode[]) => {
  if (!nodes.length) return { x: 80, y: 80 };
  const rightmost = nodes.reduce((best, node) => (node.position.x > best.position.x ? node : best), nodes[0]);
  return { x: rightmost.position.x + NODE_WIDTH + H_GAP, y: rightmost.position.y };
};
