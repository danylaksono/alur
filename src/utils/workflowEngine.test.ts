import { describe, it, expect } from 'vitest';
import { buildWorkflowSQL, buildUpToSQL, cteAlias } from './workflowEngine';
import type { GISNode } from '../store/useStore';
import type { Edge } from '@xyflow/react';

function makeNode(overrides: Partial<GISNode>): GISNode {
  return {
    id: 'node-1',
    type: 'input',
    position: { x: 0, y: 0 },
    data: {
      label: 'Test',
      type: 'input',
      config: {},
    },
    ...overrides,
  } as GISNode;
}

describe('cteAlias', () => {
  it('replaces special characters with underscores', () => {
    expect(cteAlias('node-123')).toBe('node_123');
  });

  it('preserves alphanumeric and underscore', () => {
    expect(cteAlias('my_node_1')).toBe('my_node_1');
  });
});

describe('buildWorkflowSQL', () => {
  it('throws when no nodes are provided', () => {
    expect(() => buildWorkflowSQL([], [])).toThrow('No nodes in the workflow.');
  });

  it('throws when input node has no tableName', () => {
    const nodes = [makeNode({ id: 'n1', data: { label: 'Src', type: 'input', config: {} } })];
    expect(() => buildWorkflowSQL(nodes, [])).toThrow('has no table');
  });

  it('generates a simple input-only workflow', () => {
    const nodes = [makeNode({ id: 'n1', data: { label: 'Src', type: 'input', config: { tableName: 'my_table' } } })];
    const result = buildWorkflowSQL(nodes, []);
    expect(result.sql).toContain('WITH n1 AS');
    expect(result.sql).toContain('SELECT * FROM "my_table"');
    expect(result.sql).toContain('LIMIT 5000');
    expect(result.sql).toContain('ST_AsGeoJSON');
  });

  it('generates a buffer analysis workflow', () => {
    const nodes: GISNode[] = [
      makeNode({ id: 'src', data: { label: 'Src', type: 'input', config: { tableName: 'london' } } }),
      makeNode({ id: 'buf', position: { x: 200, y: 0 }, data: { label: 'Buffer', type: 'analysis', config: { operation: 'ST_Buffer', distance: 500 } } }),
    ];
    const edges: Edge[] = [{ id: 'e1', source: 'src', target: 'buf', type: 'smoothstep' }];
    const result = buildWorkflowSQL(nodes, edges);
    expect(result.sql).toContain('ST_Buffer');
    expect(result.sql).toContain('500');
    expect(result.sql).toContain('geom_buffered');
  });

  it('generates a filter workflow', () => {
    const nodes: GISNode[] = [
      makeNode({ id: 'src', data: { label: 'Src', type: 'input', config: { tableName: 'data' } } }),
      makeNode({ id: 'flt', position: { x: 200, y: 0 }, data: { label: 'Filter', type: 'filter', config: { condition: 'population > 1000' } } }),
    ];
    const edges: Edge[] = [{ id: 'e1', source: 'src', target: 'flt', type: 'smoothstep' }];
    const result = buildWorkflowSQL(nodes, edges);
    expect(result.sql).toContain('WHERE population > 1000');
  });

  it('generates an aggregate workflow', () => {
    const nodes: GISNode[] = [
      makeNode({ id: 'src', data: { label: 'Src', type: 'input', config: { tableName: 'zones' } } }),
      makeNode({ id: 'agg', position: { x: 200, y: 0 }, data: { label: 'Agg', type: 'aggregate', config: { operation: 'ST_Union_Agg', groupBy: 'city' } } }),
    ];
    const edges: Edge[] = [{ id: 'e1', source: 'src', target: 'agg', type: 'smoothstep' }];
    const result = buildWorkflowSQL(nodes, edges);
    expect(result.sql).toContain('ST_Union_Agg');
    expect(result.sql).toContain('GROUP BY');
    expect(result.sql).toContain('"city"');
  });

  it('generates an attribute computation workflow', () => {
    const nodes: GISNode[] = [
      makeNode({ id: 'src', data: { label: 'Src', type: 'input', config: { tableName: 'data' } } }),
      makeNode({ id: 'attr', position: { x: 200, y: 0 }, data: { label: 'Attr', type: 'attribute', config: { expression: 'pop / area', resultField: 'density' } } }),
    ];
    const edges: Edge[] = [{ id: 'e1', source: 'src', target: 'attr', type: 'smoothstep' }];
    const result = buildWorkflowSQL(nodes, edges);
    expect(result.sql).toContain('pop / area');
    expect(result.sql).toContain('"density"');
  });

  it('generates a multi-input spatial join workflow', () => {
    const nodes: GISNode[] = [
      makeNode({ id: 'a', data: { label: 'A', type: 'input', config: { tableName: 'polygons' } } }),
      makeNode({ id: 'b', data: { label: 'B', type: 'input', config: { tableName: 'lines' } } }),
      makeNode({ id: 'inter', position: { x: 200, y: 0 }, data: { label: 'Intersect', type: 'analysis', config: { operation: 'ST_Intersection' } } }),
    ];
    const edges: Edge[] = [
      { id: 'e1', source: 'a', target: 'inter', type: 'smoothstep' },
      { id: 'e2', source: 'b', target: 'inter', type: 'smoothstep' },
    ];
    const result = buildWorkflowSQL(nodes, edges);
    expect(result.sql).toContain('ST_Intersection');
    expect(result.sql).toContain('ST_Intersects');
    expect(result.sql).toContain('geom_multi_result');
  });

  it('topologically sorts nodes correctly', () => {
    const nodes: GISNode[] = [
      makeNode({ id: 'z', position: { x: 400, y: 0 }, data: { label: 'Output', type: 'output', config: {} } }),
      makeNode({ id: 'buf', position: { x: 200, y: 0 }, data: { label: 'Buffer', type: 'analysis', config: { operation: 'ST_Buffer', distance: 100 } } }),
      makeNode({ id: 'src', data: { label: 'Src', type: 'input', config: { tableName: 'data' } } }),
    ];
    const edges: Edge[] = [
      { id: 'e1', source: 'src', target: 'buf', type: 'smoothstep' },
      { id: 'e2', source: 'buf', target: 'z', type: 'smoothstep' },
    ];
    const result = buildWorkflowSQL(nodes, edges);
    const srcIdx = result.sql.indexOf('src AS');
    const bufIdx = result.sql.indexOf('buf AS');
    expect(srcIdx).toBeLessThan(bufIdx);
    expect(result.sql).toContain('LIMIT 5000');
  });
});

describe('buildUpToSQL', () => {
  it('builds SQL up to a target node, excluding downstream nodes', () => {
    const nodes: GISNode[] = [
      makeNode({ id: 'src', data: { label: 'Src', type: 'input', config: { tableName: 'data' } } }),
      makeNode({ id: 'buf', position: { x: 200, y: 0 }, data: { label: 'Buffer', type: 'analysis', config: { operation: 'ST_Buffer', distance: 100 } } }),
      makeNode({ id: 'flt', position: { x: 400, y: 0 }, data: { label: 'Filter', type: 'filter', config: { condition: 'need > 10' } } }),
    ];
    const edges: Edge[] = [
      { id: 'e1', source: 'src', target: 'buf', type: 'smoothstep' },
      { id: 'e2', source: 'buf', target: 'flt', type: 'smoothstep' },
    ];

    // Build up to 'buf' — should include src + buf but NOT flt
    const result = buildUpToSQL(nodes, edges, 'buf');
    expect(result.sql).toContain('src AS');
    expect(result.sql).toContain('buf AS');
    expect(result.sql).not.toContain('flt AS');
  });

  it('throws for unknown target node', () => {
    const nodes = [makeNode({ id: 'src', data: { label: 'Src', type: 'input', config: { tableName: 'data' } } })];
    expect(() => buildUpToSQL(nodes, [], 'nonexistent')).toThrow('No nodes in the workflow');
  });
});
