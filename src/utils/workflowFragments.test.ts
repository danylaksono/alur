import { describe, it, expect } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { WorkflowNode } from '../store/useStore';
import {
  expandFragment,
  expandFragments,
  fragmentErrors,
  fragmentFromSelection,
  fragmentWarnings,
  placeholdersUsed,
  resolveArgument,
  FragmentError,
  type FragmentParameter,
  type WorkflowFragment,
} from './workflowFragments';

const node = (id: string, type: any, config: any = {}): WorkflowNode =>
  ({ id, position: { x: 0, y: 0 }, data: { label: id, type, config } } as WorkflowNode);
const edge = (source: string, target: string): Edge => ({ id: `${source}-${target}`, source, target });

const param = (over: Partial<FragmentParameter> = {}): FragmentParameter => ({
  id: 'amount', label: 'Amount', type: 'number', ...over,
});

const retrofit = (): WorkflowFragment => ({
  id: 'frag-1',
  name: 'Retrofit',
  createdAt: 1,
  nodes: [
    node('a', 'attribute', { expression: 'COALESCE(TRY_CAST({{column}} AS DOUBLE), 0) + {{amount}}', resultField: 'upgraded' }),
    node('b', 'filter', { mode: 'condition', condition: 'upgraded > {{amount}}' }),
  ],
  edges: [edge('a', 'b')],
  parameters: [param(), param({ id: 'column', label: 'Column', type: 'field' })],
  outputNodeId: 'b',
  inputNodeIds: ['a'],
});

describe('resolveArgument', () => {
  it('accepts a number and falls back to the default', () => {
    expect(resolveArgument(param(), 12)).toBe('12');
    expect(resolveArgument(param({ defaultValue: 5 }), undefined)).toBe('5');
    expect(resolveArgument(param({ defaultValue: 5 }), '')).toBe('5');
  });

  it('rejects a number that is not one', () => {
    // The value is interpolated straight into SQL, so this is the guard.
    expect(() => resolveArgument(param(), '1; DROP TABLE t')).toThrow(FragmentError);
    expect(() => resolveArgument(param(), 'NaN')).toThrow(/must be a number/);
  });

  it('accepts a plain column name and rejects anything that could carry SQL', () => {
    const column = param({ id: 'c', label: 'Column', type: 'field' });
    expect(resolveArgument(column, 'Gcons2023')).toBe('Gcons2023');
    expect(() => resolveArgument(column, '"a" + (SELECT 1)')).toThrow(/plain column name/);
    expect(() => resolveArgument(column, 'a; DELETE FROM t')).toThrow(FragmentError);
    expect(() => resolveArgument(column, 'a b')).toThrow(FragmentError);
  });

  it('holds a choice to its declared options', () => {
    const mode = param({ id: 'm', label: 'Mode', type: 'choice', options: ['sum', 'avg'] });
    expect(resolveArgument(mode, 'avg')).toBe('avg');
    expect(() => resolveArgument(mode, 'median')).toThrow(/one of: sum, avg/);
  });

  it('requires a value when there is no default', () => {
    expect(() => resolveArgument(param(), undefined)).toThrow(/needs a value/);
  });
});

describe('placeholdersUsed', () => {
  it('finds placeholders anywhere in a config, including nested arrays', () => {
    const fragment = {
      nodes: [
        node('a', 'attribute', { expression: '{{x}} + 1' }),
        node('b', 'aggregate', { measures: [{ fn: 'sum', field: '{{y}}' }], nested: { deep: '{{z}}' } }),
      ],
    };
    expect(placeholdersUsed(fragment).sort()).toEqual(['x', 'y', 'z']);
  });

  it('tolerates whitespace inside the braces', () => {
    expect(placeholdersUsed({ nodes: [node('a', 'attribute', { expression: '{{ spaced }}' })] })).toEqual(['spaced']);
  });
});

describe('expandFragment', () => {
  it('substitutes every argument into the node configuration', () => {
    const { nodes } = expandFragment(retrofit(), 'placed', { amount: 30, column: 'EPC' });
    expect(nodes[0].data.config.expression).toBe('COALESCE(TRY_CAST(EPC AS DOUBLE), 0) + 30');
    expect(nodes[1].data.config.condition).toBe('upgraded > 30');
  });

  it('namespaces ids so the same operation can be used twice', () => {
    const first = expandFragment(retrofit(), 'p1', { amount: 1, column: 'a' });
    const second = expandFragment(retrofit(), 'p2', { amount: 2, column: 'b' });
    const ids = [...first.nodes, ...second.nodes].map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(first.outputNodeId).not.toBe(second.outputNodeId);
  });

  it('rewrites inner edges to the namespaced ids', () => {
    const { edges, nodes } = expandFragment(retrofit(), 'placed', { amount: 1, column: 'a' });
    const ids = new Set(nodes.map((item) => item.id));
    expect(edges.every((item) => ids.has(item.source) && ids.has(item.target))).toBe(true);
  });

  it('refuses an argument that fails its type, rather than building the SQL', () => {
    expect(() => expandFragment(retrofit(), 'placed', { amount: 'x', column: 'a' })).toThrow(FragmentError);
  });

  it('does not mutate the stored fragment', () => {
    const fragment = retrofit();
    expandFragment(fragment, 'placed', { amount: 30, column: 'EPC' });
    expect(fragment.nodes[0].data.config.expression).toContain('{{amount}}');
  });
});

describe('expandFragments', () => {
  const library = [retrofit()];
  const graph = () => ({
    nodes: [
      node('src', 'input', { tableName: 'data' }),
      node('op', 'fragment', { fragmentId: 'frag-1', arguments: { amount: 30, column: 'EPC' } }),
      node('out', 'output', {}),
    ],
    edges: [edge('src', 'op'), edge('op', 'out')],
  });

  it('leaves a graph without fragments untouched', () => {
    const plain = { nodes: [node('src', 'input', {})], edges: [] };
    const result = expandFragments(plain.nodes, plain.edges, library);
    expect(result.nodes).toBe(plain.nodes);
    expect(result.edges).toBe(plain.edges);
    expect(result.outputByPlacement.size).toBe(0);
  });

  it('reports what replaced each placed operation, so "run up to here" still works', () => {
    const { outputByPlacement } = expandFragments(graph().nodes, graph().edges, library);
    expect(outputByPlacement.get('op')).toBe('op__b');
  });

  it('replaces the placed node with the operation\'s steps', () => {
    const { nodes } = expandFragments(graph().nodes, graph().edges, library);
    expect(nodes.some((item) => item.data.type === 'fragment')).toBe(false);
    expect(nodes.map((item) => item.id)).toContain('op__a');
    expect(nodes.map((item) => item.id)).toContain('op__b');
  });

  it('rewires upstream into the operation and downstream out of it', () => {
    const { edges } = expandFragments(graph().nodes, graph().edges, library);
    expect(edges).toContainEqual(expect.objectContaining({ source: 'src', target: 'op__a' }));
    expect(edges).toContainEqual(expect.objectContaining({ source: 'op__b', target: 'out' }));
    expect(edges.some((item) => item.source === 'op' || item.target === 'op')).toBe(false);
  });

  it('does not mutate the graph it was given', () => {
    // These edge objects belong to the store; rewiring them in place would
    // rewrite the user's canvas every time the workflow compiled.
    const original = graph();
    const before = original.edges.map((item) => `${item.source}->${item.target}`);
    expandFragments(original.nodes, original.edges, library);
    expect(original.edges.map((item) => `${item.source}->${item.target}`)).toEqual(before);
    expect(original.nodes.some((item) => item.data.type === 'fragment')).toBe(true);
  });

  it('can be compiled twice from the same graph and give the same answer', () => {
    const original = graph();
    const first = expandFragments(original.nodes, original.edges, library);
    const second = expandFragments(original.nodes, original.edges, library);
    expect(second.edges.map((item) => `${item.source}->${item.target}`).sort())
      .toEqual(first.edges.map((item) => `${item.source}->${item.target}`).sort());
  });

  it('says which operation is missing rather than compiling nonsense', () => {
    expect(() => expandFragments(graph().nodes, graph().edges, [])).toThrow(/no longer defines/);
  });

  it('expands two placements of the same operation independently', () => {
    const nodes = [
      node('src', 'input', { tableName: 'data' }),
      node('op1', 'fragment', { fragmentId: 'frag-1', arguments: { amount: 10, column: 'a' } }),
      node('op2', 'fragment', { fragmentId: 'frag-1', arguments: { amount: 20, column: 'b' } }),
    ];
    const { nodes: expanded } = expandFragments(nodes, [edge('src', 'op1'), edge('op1', 'op2')], library);
    const expressions = expanded.filter((item) => item.data.type === 'attribute').map((item) => item.data.config.expression);
    expect(expressions).toContain('COALESCE(TRY_CAST(a AS DOUBLE), 0) + 10');
    expect(expressions).toContain('COALESCE(TRY_CAST(b AS DOUBLE), 0) + 20');
  });
});

describe('fragmentFromSelection', () => {
  const nodes = [
    node('src', 'input', { tableName: 'data' }),
    node('a', 'attribute', {}),
    node('b', 'filter', {}),
    node('out', 'output', {}),
  ];
  const edges = [edge('src', 'a'), edge('a', 'b'), edge('b', 'out')];

  it('derives the operation\'s ends from the graph', () => {
    const fragment = fragmentFromSelection(nodes, edges, ['a', 'b'], { id: 'f', name: 'Op', createdAt: 1 });
    expect(fragment.outputNodeId).toBe('b');
    expect(fragment.inputNodeIds).toEqual(['a']);
    expect(fragment.nodes.map((item) => item.id)).toEqual(['a', 'b']);
    expect(fragment.edges).toHaveLength(1);
  });

  it('refuses a selection with more than one loose end', () => {
    const branched = [...nodes, node('c', 'filter', {})];
    expect(() => fragmentFromSelection(branched, [...edges, edge('a', 'c')], ['a', 'b', 'c'], { id: 'f', name: 'Op', createdAt: 1 }))
      .toThrow(/single result/);
  });

  it('refuses an empty selection', () => {
    expect(() => fragmentFromSelection(nodes, edges, [], { id: 'f', name: 'Op', createdAt: 1 })).toThrow(FragmentError);
  });
});

describe('fragmentErrors', () => {
  it('accepts a well-formed operation', () => {
    expect(fragmentErrors(retrofit())).toEqual([]);
  });

  it('rejects an operation containing a data source', () => {
    const fragment = { ...retrofit(), nodes: [node('i', 'input', { tableName: 'x' })], outputNodeId: 'i' };
    expect(fragmentErrors(fragment).join(' ')).toMatch(/Data source steps cannot be part/);
  });

  it('catches a placeholder with no matching value', () => {
    const fragment = retrofit();
    fragment.parameters = [param()];
    expect(fragmentErrors(fragment).join(' ')).toContain('{{column}}');
  });

  it('catches two values sharing a name', () => {
    const fragment = { ...retrofit(), parameters: [param(), param()] };
    expect(fragmentErrors(fragment).join(' ')).toMatch(/both called "amount"/);
  });

  it('requires a name', () => {
    expect(fragmentErrors({ ...retrofit(), name: '  ' }).join(' ')).toMatch(/name/i);
  });
});

describe('fragmentWarnings', () => {
  it('reports a declared value nothing uses, without blocking the save', () => {
    const fragment = { ...retrofit(), parameters: [...retrofit().parameters, param({ id: 'spare', label: 'Spare' })] };
    expect(fragmentErrors(fragment)).toEqual([]);
    expect(fragmentWarnings(fragment).join(' ')).toContain('"Spare"');
  });

  it('says nothing when every value is used', () => {
    expect(fragmentWarnings(retrofit())).toEqual([]);
  });
});
