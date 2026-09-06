import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import { findCycleNodes, nodeIdFromWorkflowError, wouldCreateCycle } from './workflowGraph';

const edge = (source: string, target: string): Edge => ({ id: `${source}-${target}`, source, target });

describe('wouldCreateCycle', () => {
  const chain = [edge('a', 'b'), edge('b', 'c')];

  it('allows an edge that extends the chain', () => {
    expect(wouldCreateCycle(chain, 'c', 'd')).toBe(false);
  });

  it('allows a branch off an existing node', () => {
    expect(wouldCreateCycle(chain, 'a', 'd')).toBe(false);
  });

  it('allows a diamond — two paths rejoining is not a cycle', () => {
    const diamond = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd')];
    expect(wouldCreateCycle(diamond, 'c', 'd')).toBe(false);
  });

  it('rejects an edge closing the loop directly', () => {
    expect(wouldCreateCycle(chain, 'c', 'a')).toBe(true);
  });

  it('rejects a one-step loop back to the immediate parent', () => {
    expect(wouldCreateCycle(chain, 'b', 'a')).toBe(true);
  });

  it('rejects a node feeding itself', () => {
    expect(wouldCreateCycle(chain, 'b', 'b')).toBe(true);
    expect(wouldCreateCycle([], 'solo', 'solo')).toBe(true);
  });

  it('terminates on a graph that already contains a cycle', () => {
    const looped = [edge('a', 'b'), edge('b', 'a')];
    expect(wouldCreateCycle(looped, 'b', 'c')).toBe(false);
  });
});

describe('findCycleNodes', () => {
  it('reports nothing for an acyclic graph', () => {
    expect(findCycleNodes(['a', 'b', 'c'], [edge('a', 'b'), edge('b', 'c')])).toEqual([]);
  });

  it('reports the nodes a topological sort cannot place', () => {
    // a is clean; b and c are locked in a loop.
    const stuck = findCycleNodes(['a', 'b', 'c'], [edge('a', 'b'), edge('b', 'c'), edge('c', 'b')]);
    expect(stuck.sort()).toEqual(['b', 'c']);
  });

  it('includes nodes stranded downstream of a cycle', () => {
    const stuck = findCycleNodes(['a', 'b', 'c'], [edge('a', 'b'), edge('b', 'a'), edge('b', 'c')]);
    expect(stuck.sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('nodeIdFromWorkflowError', () => {
  const ids = ['score-t2', 'input-1', 'filter-9'];

  it('anchors an error to the node it names', () => {
    expect(nodeIdFromWorkflowError('Score node "score-t2": Add at least one criterion.', ids)).toBe('score-t2');
  });

  it('returns null for an error that names no node', () => {
    expect(nodeIdFromWorkflowError('No nodes in the workflow.', ids)).toBeNull();
  });

  it('does not match an id that only appears unquoted', () => {
    expect(nodeIdFromWorkflowError('something about score-t2 without quotes', ids)).toBeNull();
  });
});
