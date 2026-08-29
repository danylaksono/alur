import { describe, expect, it } from 'vitest';
import type { OperationInstance } from '../types/operations';
import type { VariantOperation } from '../types/visualAnalytics';
import { referenceProvider } from '../providers/reference/referenceProvider';
import {
  appendOperation,
  exportOperations,
  importOperations,
  moveOperation,
  nextSequence,
  operationFootprint,
  operationsForProvider,
  removeOperation,
  summariseOperation,
  toOperationChanges,
  withSequence,
} from './operationRecords';

const adjust = (id: string, rowIds: string[], amount: number): VariantOperation => ({
  id,
  type: 'reference.tally',
  providerId: 'reference.tally',
  changeId: 'adjust',
  parameters: { amount },
  target: { kind: 'rows', datasetId: 'dataset-1', rowIds },
});

const place = (id: string, coordinates: [number, number], amount: number): VariantOperation => ({
  id,
  type: 'reference.tally',
  providerId: 'reference.tally',
  changeId: 'place',
  parameters: { amount },
  target: { kind: 'geometry', geometry: { type: 'Point', coordinates } },
});

const setting = (id: string): VariantOperation => ({
  id,
  type: 'reference.tally',
  providerId: 'reference.tally',
  parameters: { start: 5 },
});

const build = (operations: VariantOperation[]) =>
  operations.reduce<VariantOperation[]>((list, operation) => appendOperation(list, operation), []);

const instance = async (keys: string[], start = 0): Promise<OperationInstance> =>
  referenceProvider.create({
    inputs: [{ inputId: 'units', fields: { key: 'id' }, rows: keys.map((id) => ({ id })) }],
    parameters: { start },
  });

const valuesOf = async (session: OperationInstance) => {
  const result = await session.evaluate();
  const output = result.outputs.values;
  if (output.kind !== 'join') throw new Error('expected a join output');
  return Object.fromEntries(output.rows.map((row) => [String(row.key), Number(row.reference_value)]));
};

describe('sequencing', () => {
  it('preserves array order for records written before sequences existed', () => {
    const legacy: VariantOperation[] = [
      { id: 'a', type: 'value-change', parameters: {} },
      { id: 'b', type: 'value-change', parameters: {} },
      { id: 'c', type: 'value-change', parameters: {} },
    ];
    expect(withSequence(legacy).map((operation) => operation.id)).toEqual(['a', 'b', 'c']);
    expect(withSequence(legacy).map((operation) => operation.sequence)).toEqual([0, 1, 2]);
  });

  it('puts an explicit sequence ahead of an implicit one in a mixed list', () => {
    const mixed: VariantOperation[] = [
      { id: 'implicit', type: 'value-change', parameters: {} },
      { id: 'explicit', type: 'value-change', parameters: {}, sequence: -1 },
    ];
    expect(withSequence(mixed).map((operation) => operation.id)).toEqual(['explicit', 'implicit']);
  });

  it('appends after the highest sequence, not the array length', () => {
    const sparse: VariantOperation[] = [{ id: 'a', type: 'value-change', parameters: {}, sequence: 7 }];
    expect(nextSequence(sparse)).toBe(8);
  });

  it('closes the gap when a record is removed', () => {
    const list = build([adjust('a', ['1'], 1), adjust('b', ['2'], 1), adjust('c', ['3'], 1)]);
    const after = removeOperation(list, 'b');
    expect(after.map((operation) => operation.id)).toEqual(['a', 'c']);
    expect(after.map((operation) => operation.sequence)).toEqual([0, 1]);
  });

  it('reorders and resequences together', () => {
    const list = build([adjust('a', ['1'], 1), adjust('b', ['2'], 1), adjust('c', ['3'], 1)]);
    const after = moveOperation(list, 'c', 0);
    expect(after.map((operation) => operation.id)).toEqual(['c', 'a', 'b']);
    expect(after.map((operation) => operation.sequence)).toEqual([0, 1, 2]);
  });
});

describe('resolution for a provider', () => {
  it('keeps only the named provider’s records', () => {
    const list = build([adjust('a', ['1'], 1), { id: 'other', type: 'other.thing', providerId: 'other.thing', parameters: {} }]);
    expect(operationsForProvider(list, 'reference.tally').map((operation) => operation.id)).toEqual(['a']);
  });

  it('drops records with no target, because those are settings not assertions', () => {
    const list = build([adjust('a', ['1'], 1), setting('s'), place('p', [0, 0], 1)]);
    expect(toOperationChanges(list, 'reference.tally').map((change) => change.id)).toEqual(['a', 'p']);
  });

  it('hands changes over in sequence order', () => {
    const list = moveOperation(build([adjust('a', ['1'], 1), adjust('b', ['1'], 2)]), 'b', 0);
    expect(toOperationChanges(list, 'reference.tally').map((change) => change.sequence)).toEqual([0, 1]);
    expect(toOperationChanges(list, 'reference.tally').map((change) => change.id)).toEqual(['b', 'a']);
  });
});

describe('footprint', () => {
  it('collects targeted rows per dataset and placed geometry in order', () => {
    const list = build([adjust('a', ['1', '2'], 1), place('p', [110, -7], 3), adjust('b', ['2', '3'], 1)]);
    const footprint = operationFootprint(list);
    expect(footprint.rowsByDataset['dataset-1'].sort()).toEqual(['1', '2', '3']);
    expect(footprint.placed).toHaveLength(1);
    expect(footprint.placed[0].geometry).toEqual({ type: 'Point', coordinates: [110, -7] });
  });
});

describe('lifecycle against the reference provider', () => {
  it('applies changes in order', async () => {
    const session = await instance(['1', '2']);
    await session.setChanges(toOperationChanges(build([adjust('a', ['1'], 2), adjust('b', ['1', '2'], 3)]), 'reference.tally'));
    expect(await valuesOf(session)).toEqual({ '1': 5, '2': 3 });
  });

  it('undoing and re-applying returns identical values', async () => {
    const session = await instance(['1', '2']);
    const full = build([adjust('a', ['1'], 2), adjust('b', ['1', '2'], 3), adjust('c', ['2'], 4)]);

    await session.setChanges(toOperationChanges(full, 'reference.tally'));
    const before = await valuesOf(session);

    const undone = removeOperation(full, 'c');
    await session.setChanges(toOperationChanges(undone, 'reference.tally'));
    const midway = await valuesOf(session);
    expect(midway).not.toEqual(before);

    // Re-applying the same record must land exactly where it was, which is the
    // whole reason the contract replaces the list rather than accumulating it.
    await session.setChanges(toOperationChanges(full, 'reference.tally'));
    expect(await valuesOf(session)).toEqual(before);
  });

  it('reaches the same state whether records are replayed or applied stepwise', async () => {
    const full = build([adjust('a', ['1'], 2), adjust('b', ['1'], 3)]);

    const stepwise = await instance(['1']);
    await stepwise.setChanges(toOperationChanges(build([adjust('a', ['1'], 2)]), 'reference.tally'));
    await stepwise.setChanges(toOperationChanges(full, 'reference.tally'));

    const fresh = await instance(['1']);
    await fresh.setChanges(toOperationChanges(full, 'reference.tally'));

    expect(await valuesOf(stepwise)).toEqual(await valuesOf(fresh));
  });

  it('emits placed geometry as a dataset output', async () => {
    const session = await instance(['1']);
    await session.setChanges(toOperationChanges(build([place('p', [110.3, -7.8], 9)]), 'reference.tally'));
    const result = await session.evaluate();
    const placed = result.outputs.placed;
    expect(placed.kind).toBe('dataset');
    if (placed.kind !== 'dataset') throw new Error('expected a dataset output');
    expect(placed.geojson.features).toHaveLength(1);
    expect(placed.geojson.features[0].geometry).toEqual({ type: 'Point', coordinates: [110.3, -7.8] });
    expect(placed.geojson.features[0].properties).toEqual({ reference_amount: 9 });
  });

  it('separates settings from assertions', async () => {
    const session = await instance(['1'], 0);
    await session.setChanges(toOperationChanges(build([adjust('a', ['1'], 2)]), 'reference.tally'));
    expect(await valuesOf(session)).toEqual({ '1': 2 });

    await session.setParameters({ start: 10 });
    expect(await valuesOf(session)).toEqual({ '1': 12 });
  });
});

describe('export and import', () => {
  it('round-trips and re-evaluates to the same values', async () => {
    const list = build([adjust('a', ['1'], 2), place('p', [1, 2], 5), adjust('b', ['1'], 3)]);

    const before = await instance(['1']);
    await before.setChanges(toOperationChanges(list, 'reference.tally'));
    const expected = await valuesOf(before);

    const json = JSON.parse(JSON.stringify(exportOperations(list)));
    const { operations, warnings } = importOperations(json, ['reference.tally']);
    expect(warnings).toEqual([]);

    const after = await instance(['1']);
    await after.setChanges(toOperationChanges(operations, 'reference.tally'));
    expect(await valuesOf(after)).toEqual(expected);
  });

  it('keeps records for a provider that is not installed, and says so', () => {
    const list = build([adjust('a', ['1'], 2)]);
    const { operations, warnings } = importOperations(JSON.parse(JSON.stringify(exportOperations(list))), []);
    expect(operations).toHaveLength(1);
    expect(warnings[0]).toContain('reference.tally');
  });

  it('refuses a payload that is not an operation export', () => {
    expect(() => importOperations({ kind: 'something-else' })).toThrow(/Not an operation export/);
  });

  it('refuses a version it does not know', () => {
    expect(() => importOperations({ kind: 'alur-operations', version: 99, operations: [] })).toThrow(/not supported/);
  });
});

describe('summaries', () => {
  it('reads without a decoder, using the provider’s own labels', () => {
    expect(summariseOperation(adjust('a', ['1', '2'], 1), referenceProvider.manifest)).toBe(
      'Adjust selected units on 2 units',
    );
    expect(summariseOperation(place('p', [0, 0], 1), referenceProvider.manifest)).toBe('Place a unit at a point');
    expect(summariseOperation(setting('s'), referenceProvider.manifest)).toBe('Reference tally (setting)');
  });

  it('falls back to the recorded type when the provider is absent', () => {
    expect(summariseOperation(adjust('a', ['1'], 1))).toBe('reference.tally on 1 unit');
  });
});
