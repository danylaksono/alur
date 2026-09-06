import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { WorkflowNode } from '../store/useStore';
import { nodeReadiness, requiredInputs, workflowReadiness } from './nodeReadiness';

const node = (type: string, config: any = {}, extra: any = {}): WorkflowNode =>
  ({ id: `${type}-1`, position: { x: 0, y: 0 }, data: { label: type, type, config, ...extra } }) as WorkflowNode;

const reason = (n: WorkflowNode, incoming = 1) => {
  const state = nodeReadiness(n, incoming);
  return state.ready ? null : state.reason;
};

describe('required inputs', () => {
  it('asks for nothing from a source', () => {
    expect(requiredInputs(node('input'))).toBe(0);
  });

  it('asks for two sides of a join', () => {
    expect(requiredInputs(node('join'))).toBe(2);
  });

  it('reads the input count off the spatial operation', () => {
    expect(requiredInputs(node('analysis', { operation: 'ST_Intersection' }))).toBe(2);
    expect(requiredInputs(node('analysis', { operation: 'ST_Buffer' }))).toBe(1);
  });
});

describe('structural readiness', () => {
  it('marks a disconnected step as needing a source', () => {
    expect(reason(node('attribute', { expression: 'a + b' }), 0)).toBe('Connect a source');
  });

  it('names both sides when a join is half-connected', () => {
    expect(reason(node('join'), 1)).toBe('Connect both inputs (A = left, B = right)');
  });

  it('does not ask a source node for an input', () => {
    expect(reason(node('input', { tableName: 'wards' }), 0)).toBeNull();
  });
});

describe('configuration readiness', () => {
  it('flags an input with no table loaded', () => {
    expect(reason(node('input'), 0)).toBe('Load a file to use as the source');
  });

  it('flags a WHERE filter with no condition, and clears once written', () => {
    expect(reason(node('filter', { mode: 'condition' }))).toBe('Write a WHERE condition');
    expect(reason(node('filter', { mode: 'condition', condition: 'need > 10' }))).toBeNull();
  });

  it('accepts a condition-mode filter driven by a map selection', () => {
    expect(reason(node('filter', { mode: 'condition', selectionIds: ['a', 'b'] }))).toBeNull();
  });

  it('flags a selection filter with nothing selected', () => {
    expect(reason(node('filter', { mode: 'selection' }))).toBe('Select features on the map to filter by');
  });

  it('flags a top-N filter missing its column or its count', () => {
    expect(reason(node('filter', { mode: 'top-n' }))).toBe('Choose a column to rank by');
    expect(reason(node('filter', { mode: 'top-n', field: 'need' }))).toBe('Set how many rows to keep');
    expect(reason(node('filter', { mode: 'top-n', field: 'need', count: 10 }))).toBeNull();
  });

  it('flags an attribute node with no expression', () => {
    expect(reason(node('attribute'))).toBe('Write an expression for the new column');
  });

  it('flags an attribute join missing its keys', () => {
    expect(reason(node('join', { mode: 'attribute' }), 2)).toBe('Choose the key field on each side');
    expect(reason(node('join', { mode: 'attribute', leftKey: 'id', rightKey: 'id' }), 2)).toBeNull();
  });

  it('treats a spatial join as ready once both sides are connected', () => {
    expect(reason(node('join', { mode: 'spatial' }), 2)).toBeNull();
  });

  it('defers to the existing score validator', () => {
    expect(reason(node('score'))).toBeTruthy();
    expect(
      reason(
        node('score', {
          scoreModel: {
            criteria: [{ id: 'c', field: 'need', weight: 1, direction: 'higher-is-better', normalisation: 'min-max' }],
            missingValueTreatment: 'zero',
          },
        }),
      ),
    ).toBeNull();
  });

  it('lets a dissolve summarise through without measures', () => {
    expect(reason(node('aggregate', { mode: 'dissolve' }))).toBeNull();
  });
});

describe('bypassed steps', () => {
  it('never reads as unfinished — it is deliberately doing nothing', () => {
    expect(reason(node('filter', { mode: 'condition' }, { disabled: true }))).toBeNull();
    expect(reason(node('attribute', {}, { disabled: true }), 0)).toBeNull();
  });
});

describe('workflowReadiness', () => {
  it('reports every node, counting the edges that arrive at each', () => {
    const nodes = [
      { ...node('input', { tableName: 'wards' }), id: 'i' },
      { ...node('filter', { mode: 'condition' }), id: 'f' },
    ] as WorkflowNode[];
    const edges: Edge[] = [{ id: 'e', source: 'i', target: 'f' }];
    const result = workflowReadiness(nodes, edges);
    expect(result.i).toEqual({ ready: true });
    expect(result.f).toEqual({ ready: false, reason: 'Write a WHERE condition' });
  });
});
