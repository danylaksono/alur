import type { WorkflowNode } from '../store/useStore';

const NODE_WIDTH = 240;
const H_GAP = 60;

/**
 * Where to drop a newly added node: to the right of the rightmost existing
 * node, roughly aligned with it — new nodes extend the DAG in flow direction
 * instead of piling up in the top-left corner.
 */
export const nextNodePosition = (nodes: WorkflowNode[]) => {
  const steps = nodes.filter((node) => node.data.type !== 'group');
  if (!steps.length) return { x: 80, y: 80 };
  const rightmost = steps.reduce((best, node) => (node.position.x > best.position.x ? node : best), steps[0]);
  return { x: rightmost.position.x + NODE_WIDTH + H_GAP, y: rightmost.position.y };
};

/**
 * Where to drop a new group box: around the existing steps rather than after
 * them, since a box that lands in empty canvas has nothing to describe. Padded
 * so the steps sit inside it rather than on its border.
 */
export const groupBoxPosition = (nodes: WorkflowNode[]) => {
  const steps = nodes.filter((node) => node.data.type !== 'group');
  if (!steps.length) return { x: 60, y: 40 };
  const left = Math.min(...steps.map((node) => node.position.x));
  const top = Math.min(...steps.map((node) => node.position.y));
  return { x: left - 40, y: top - 60 };
};
