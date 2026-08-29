import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { WorkflowNode } from '../store/useStore';
import type { OperationManifest } from '../types/operations';
import type { VariantOperation } from '../types/visualAnalytics';
import {
  calculationFingerprint,
  calculationInputHandle,
  calculationSources,
  calculationStaleness,
  withRowIdFallback,
  type CalculationNodeConfig,
} from './calculationNodeService';
import type { DatasetDescriptor } from '../types/datasets';

/**
 * Wiring and staleness.
 *
 * The fingerprint carries the whole weight of the node's honesty: a calculation
 * runs once and keeps its answer, so the only thing standing between the analyst
 * and a map that quietly no longer follows from its inputs is this comparison
 * noticing. So the tests are mostly about what must and must not change it.
 */

const manifest = {
  id: 'test.calc',
  version: '1.0.0',
  inputs: [
    { id: 'units', label: 'Units', geometry: 'any', fields: [], multiple: true },
    { id: 'sites', label: 'Sites', geometry: 'point', fields: [] },
  ],
} as unknown as OperationManifest;

const node = (overrides: Partial<WorkflowNode>): WorkflowNode =>
  ({
    id: 'n',
    type: 'input',
    position: { x: 0, y: 0 },
    data: { label: 'Node', type: 'input', config: {} },
    ...overrides,
  }) as WorkflowNode;

const source = (id: string, tableName: string) =>
  node({ id, data: { label: id, type: 'input', config: { tableName } } });

const edge = (id: string, from: string, to: string, handle?: string): Edge =>
  ({ id, source: from, target: to, ...(handle ? { targetHandle: handle } : {}) }) as Edge;

const config: CalculationNodeConfig = {
  pluginUrl: '',
  calculationId: 'test.calc',
  fields: { units: { a: { id: 'ref' } } },
  parameters: { radiusKm: 0.3 },
};

const fingerprint = (overrides: Partial<Parameters<typeof calculationFingerprint>[0]> = {}) =>
  calculationFingerprint({
    manifest,
    config,
    upstreamSql: { units: ['SELECT * FROM a'], sites: ['SELECT * FROM b'] },
    operations: [],
    variantId: 'v1',
    ...overrides,
  });

describe('wiring a calculation into the graph', () => {
  it('names each handle after its input, so reordering a manifest cannot rewire a saved graph', () => {
    expect(calculationInputHandle('units')).toBe('in-units');
    expect(calculationInputHandle('sites')).toBe('in-sites');
  });

  it('reads only the edges arriving at the handle asked about', () => {
    const edges = [
      edge('e1', 'a', 'calc', 'in-units'),
      edge('e2', 'b', 'calc', 'in-sites'),
      edge('e3', 'c', 'other', 'in-units'),
    ];
    expect(calculationSources('calc', 'units', edges)).toEqual(['a']);
    expect(calculationSources('calc', 'sites', edges)).toEqual(['b']);
    expect(calculationSources('calc', 'missing', edges)).toEqual([]);
  });

  it('orders several sources for one input the same way every time', () => {
    // A run's result must not depend on the order edges happened to be drawn in.
    const drawn = [edge('e1', 'z', 'calc', 'in-units'), edge('e2', 'a', 'calc', 'in-units')];
    const redrawn = [edge('e2', 'a', 'calc', 'in-units'), edge('e1', 'z', 'calc', 'in-units')];
    expect(calculationSources('calc', 'units', drawn)).toEqual(['a', 'z']);
    expect(calculationSources('calc', 'units', redrawn)).toEqual(['a', 'z']);
  });

  it('counts one upstream node once, however many edges reach the same handle', () => {
    const edges = [edge('e1', 'a', 'calc', 'in-units'), edge('e2', 'a', 'calc', 'in-units')];
    expect(calculationSources('calc', 'units', edges)).toEqual(['a']);
  });
});

describe('what makes a held result stale', () => {
  it('is stable when nothing has moved', () => {
    expect(fingerprint()).toBe(fingerprint());
  });

  it('changes when the data above the node changes', () => {
    expect(fingerprint({ upstreamSql: { units: ['SELECT * FROM a WHERE x > 1'], sites: ['SELECT * FROM b'] } }))
      .not.toBe(fingerprint());
  });

  it('changes when a setting changes', () => {
    expect(fingerprint({ config: { ...config, parameters: { radiusKm: 0.5 } } })).not.toBe(fingerprint());
  });

  it('changes when a role is bound to a different column', () => {
    expect(fingerprint({ config: { ...config, fields: { units: { a: { id: 'other' } } } } })).not.toBe(fingerprint());
  });

  it('changes when the plugin version moves under the same id', () => {
    expect(fingerprint({ manifest: { ...manifest, version: '2.0.0' } })).not.toBe(fingerprint());
  });

  it('changes when the scenario does, because the same method under new assertions is a new answer', () => {
    const change: VariantOperation = {
      id: 'op1',
      type: 'custom',
      providerId: 'test.calc',
      changeId: 'exclude',
      parameters: {},
      sequence: 1,
    };
    expect(fingerprint({ operations: [change] })).not.toBe(fingerprint());
    expect(fingerprint({ variantId: 'v2' })).not.toBe(fingerprint());
  });

  it('ignores a change recorded against a different calculation', () => {
    // Real change to the scenario, but not to this answer. Flagging it would
    // teach people that the stale warning does not mean anything.
    const elsewhere: VariantOperation = {
      id: 'op2',
      type: 'custom',
      providerId: 'other.calc',
      changeId: 'commit',
      parameters: {},
      sequence: 1,
    };
    expect(fingerprint({ operations: [elsewhere] })).toBe(fingerprint());
  });
});

describe('reporting staleness on the canvas', () => {
  const graph = (tableName: string, fingerprintValue?: string) => ({
    nodes: [
      source('a', 'units_table'),
      source('b', 'sites_table'),
      node({
        id: 'calc',
        type: 'calculation',
        data: {
          label: 'Calc',
          type: 'calculation',
          config: { ...config, tableName, fingerprint: fingerprintValue },
        },
      }),
    ],
    edges: [edge('e1', 'a', 'calc', 'in-units'), edge('e2', 'b', 'calc', 'in-sites')],
  });

  const check = (nodes: WorkflowNode[], edges: Edge[]) =>
    calculationStaleness({
      nodeId: 'calc',
      nodes,
      edges,
      fragments: [],
      manifest,
      operations: [],
      variantId: 'v1',
    });

  it('says nothing about a node that has never been run', () => {
    const { nodes, edges } = graph('calc_out');
    expect(check(nodes, edges)).toBeNull();
  });

  it('notices an edit above the node', () => {
    const { nodes, edges } = graph('calc_out', 'stamped-earlier');
    const before = check(nodes, edges)!;
    expect(before.stale).toBe(true);

    // Re-stamp with what the graph actually hashes to, then move a source.
    const current = nodes.map((item) =>
      item.id === 'calc'
        ? { ...item, data: { ...item.data, config: { ...(item.data.config as object), fingerprint: before.fingerprint } } }
        : item,
    ) as WorkflowNode[];
    expect(check(current, edges)!.stale).toBe(false);

    const moved = current.map((item) =>
      item.id === 'a' ? { ...item, data: { ...item.data, config: { tableName: 'different_table' } } } : item,
    ) as WorkflowNode[];
    expect(check(moved, edges)!.stale).toBe(true);
  });

  it('holds its tongue when the graph cannot be compiled at all', () => {
    // An upstream source still loading is not staleness, and a node that cried
    // wolf every time a file was opened would be ignored when it mattered.
    const { edges } = graph('calc_out', 'stamped-earlier');
    const loading = [
      node({ id: 'a', data: { label: 'a', type: 'input', config: {} } }),
      source('b', 'sites_table'),
      node({
        id: 'calc',
        type: 'calculation',
        data: { label: 'Calc', type: 'calculation', config: { ...config, tableName: 'calc_out', fingerprint: 'x' } },
      }),
    ];
    expect(check(loading, edges)).toBeNull();
  });
});

describe('binding an identifier the data does not have', () => {
  const input = {
    id: 'units',
    label: 'Units',
    fields: [
      { id: 'id', label: 'Identifier', semanticType: 'identifier', required: true },
      { id: 'ref', label: 'Reference', semanticType: 'identifier', required: false },
      { id: 'cost', label: 'Cost', semanticType: 'numeric', required: true },
    ],
  } as unknown as OperationManifest['inputs'][number];

  const dataset = { rowIdColumn: '__alur_row_id' } as DatasetDescriptor;

  it('fills a required identifier from the row id, so a connected node can just be run', () => {
    // Mid-pipeline data rarely carries a unique column. Requiring one would make
    // most calculations unusable on most graphs.
    expect(withRowIdFallback(input, {}, dataset)).toEqual({ id: '__alur_row_id' });
  });

  it('never overrides a column the analyst chose', () => {
    // A real identifier is what makes a result joinable back to anything else.
    expect(withRowIdFallback(input, { id: 'uprn' }, dataset)).toEqual({ id: 'uprn' });
  });

  it('leaves optional and non-identifier roles alone', () => {
    // A row number is a meaningful identifier and a meaningless cost, and an
    // optional role left blank was left blank on purpose.
    const filled = withRowIdFallback(input, {}, dataset);
    expect(filled.ref).toBeUndefined();
    expect(filled.cost).toBeUndefined();
  });
});
