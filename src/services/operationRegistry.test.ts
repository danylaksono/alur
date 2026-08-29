import { afterEach, describe, expect, it } from 'vitest';
import type { OperationChange, OperationChangeSpec, OperationManifest, OperationProvider } from '../types/operations';
import type { DatasetDescriptor } from '../types/datasets';
import { referenceProvider } from '../providers/reference/referenceProvider';
import {
  OperationRegistrationError,
  getOperationProvider,
  operationBindingErrors,
  operationChangeErrors,
  operationManifestErrors,
  operationProviders,
  providersAcceptingChanges,
  registerOperationProvider,
  unregisterOperationProvider,
} from './operationRegistry';

const manifest = (patch: Partial<OperationManifest> = {}): OperationManifest => ({
  ...structuredClone(referenceProvider.manifest),
  id: 'test.provider',
  ...patch,
});

const provider = (value: OperationManifest): OperationProvider => ({
  manifest: value,
  create: referenceProvider.create,
});

const dataset = (patch: Partial<DatasetDescriptor> = {}): DatasetDescriptor => ({
  id: 'dataset-1',
  name: 'Units',
  sourceVersion: 1,
  source: { kind: 'table', datasetId: 'dataset-1', tableName: 'units', rowIdColumn: 'id' },
  fields: [{ name: 'id', type: 'VARCHAR' }, { name: 'name', type: 'VARCHAR' }],
  rowIdColumn: 'id',
  rowIdQuality: 'validated-unique',
  sourceUpdatedAt: 0,
  spatial: true,
  geometryKind: 'point',
  ...patch,
});

afterEach(() => {
  for (const registered of operationProviders()) unregisterOperationProvider(registered.manifest.id);
});

describe('manifest validation', () => {
  it('accepts the reference provider', () => {
    expect(operationManifestErrors(referenceProvider.manifest)).toEqual([]);
  });

  it('rejects an id that is not namespace-safe', () => {
    expect(operationManifestErrors(manifest({ id: 'Not Safe' }))).toContainEqual(
      expect.stringContaining('must be lower-case'),
    );
  });

  it('rejects a change naming an input that does not exist', () => {
    const errors = operationManifestErrors(
      manifest({ accepts: [{ ...referenceProvider.manifest.accepts[0], inputId: 'absent' }] }),
    );
    expect(errors).toContainEqual(expect.stringContaining('names input "absent"'));
  });

  it('rejects a join output with no input to join to', () => {
    const errors = operationManifestErrors(
      manifest({ outputs: [{ id: 'values', label: 'Values', kind: 'join', fields: [] }] }),
    );
    expect(errors).toContainEqual(expect.stringContaining('names no input to join to'));
  });

  it('rejects a measure naming a field no output emits', () => {
    const errors = operationManifestErrors(
      manifest({ measure: { ...referenceProvider.manifest.measure!, field: 'absent' } }),
    );
    expect(errors).toContainEqual(expect.stringContaining('does not emit'));
  });

  it('reports duplicate ids rather than silently keeping the last', () => {
    const input = referenceProvider.manifest.inputs[0];
    expect(operationManifestErrors(manifest({ inputs: [input, input] }))).toContainEqual(
      expect.stringContaining('is declared twice'),
    );
  });
});

describe('registration', () => {
  it('registers and resolves a provider', () => {
    registerOperationProvider(referenceProvider);
    expect(getOperationProvider('reference.tally')).toBe(referenceProvider);
    expect(providersAcceptingChanges()).toHaveLength(1);
  });

  it('refuses an invalid manifest instead of registering it', () => {
    expect(() => registerOperationProvider(provider(manifest({ id: 'Bad Id' })))).toThrow(OperationRegistrationError);
    expect(operationProviders()).toEqual([]);
  });

  it('refuses to register the same id twice', () => {
    registerOperationProvider(referenceProvider);
    expect(() => registerOperationProvider(referenceProvider)).toThrow(/already registered/);
  });

  it('returns null for a provider that is not installed', () => {
    // The ordinary case when opening someone else's project, not an error.
    expect(getOperationProvider('someone.elses')).toBeNull();
  });
});

describe('binding validation', () => {
  const datasets = { 'dataset-1': dataset() };

  it('accepts a complete binding', () => {
    const errors = operationBindingErrors(
      referenceProvider.manifest,
      [{ inputId: 'units', sources: [{ datasetId: 'dataset-1', fields: { key: 'id' } }] }],
      datasets,
    );
    expect(errors).toEqual([]);
  });

  it('asks for a dataset when an input is unbound', () => {
    expect(operationBindingErrors(referenceProvider.manifest, [], datasets)).toContainEqual(
      expect.stringContaining('needs a dataset'),
    );
  });

  it('treats an empty binding as unfilled, not as a deleted dataset', () => {
    // The panel seeds one empty binding per input as soon as a provider loads,
    // so getting this wrong makes every fresh provider claim its data is gone.
    const errors = operationBindingErrors(
      referenceProvider.manifest,
      [{ inputId: 'units', sources: [{ datasetId: '', fields: {} }] }],
      datasets,
    );
    expect(errors).toContainEqual(expect.stringContaining('needs a dataset'));
    expect(errors.join(' ')).not.toContain('no longer loaded');
  });

  it('asks for a column when a required role is unbound', () => {
    const errors = operationBindingErrors(
      referenceProvider.manifest,
      [{ inputId: 'units', sources: [{ datasetId: 'dataset-1', fields: {} }] }],
      datasets,
    );
    expect(errors).toContainEqual(expect.stringContaining('choose a column in'));
  });

  it('reports a bound column the dataset does not have', () => {
    const errors = operationBindingErrors(
      referenceProvider.manifest,
      [{ inputId: 'units', sources: [{ datasetId: 'dataset-1', fields: { key: 'gone' } }] }],
      datasets,
    );
    expect(errors).toContainEqual(expect.stringContaining('no column "gone"'));
  });

  it('reports a geometry kind the input cannot take', () => {
    const lines = { 'dataset-1': dataset({ geometryKind: 'line' }) };
    const strict: OperationManifest = manifest({
      inputs: [{ ...referenceProvider.manifest.inputs[0], geometry: 'polygon' }],
    });
    const errors = operationBindingErrors(strict, [{ inputId: 'units', sources: [{ datasetId: 'dataset-1', fields: { key: 'id' } }] }], lines);
    expect(errors).toContainEqual(expect.stringContaining('needs polygon geometry'));
  });

  it('reports a dataset that is no longer loaded', () => {
    const errors = operationBindingErrors(
      referenceProvider.manifest,
      [{ inputId: 'units', sources: [{ datasetId: 'gone', fields: { key: 'id' } }] }],
      datasets,
    );
    expect(errors).toContainEqual(expect.stringContaining('no longer loaded'));
  });
});

describe('change validation', () => {
  const rowsSpec = referenceProvider.manifest.accepts[0];
  const pointSpec = referenceProvider.manifest.accepts[1];

  const change = (patch: Partial<OperationChange>): OperationChange => ({
    id: 'op-1',
    changeId: 'adjust',
    sequence: 0,
    target: { kind: 'rows', datasetId: 'dataset-1', rowIds: ['a'] },
    values: { amount: 2 },
    ...patch,
  });

  it('accepts a well-formed row change', () => {
    expect(operationChangeErrors(rowsSpec, change({}))).toEqual([]);
  });

  it('rejects a row change with an empty selection', () => {
    const errors = operationChangeErrors(rowsSpec, change({ target: { kind: 'rows', datasetId: 'd', rowIds: [] } }));
    expect(errors).toContainEqual(expect.stringContaining('at least one selected row'));
  });

  it('rejects a geometry target where rows were declared', () => {
    const errors = operationChangeErrors(
      rowsSpec,
      change({ target: { kind: 'geometry', geometry: { type: 'Point', coordinates: [0, 0] } } }),
    );
    expect(errors).toContainEqual(expect.stringContaining('applies to selected rows'));
  });

  it('accepts a point placement', () => {
    const placement = change({
      changeId: 'place',
      target: { kind: 'geometry', geometry: { type: 'Point', coordinates: [110.3, -7.8] } },
    });
    expect(operationChangeErrors(pointSpec, placement)).toEqual([]);
  });

  it('rejects a polygon where a point was declared', () => {
    const placement = change({
      changeId: 'place',
      target: { kind: 'geometry', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
    });
    expect(operationChangeErrors(pointSpec, placement)).toContainEqual(expect.stringContaining('applies to a point'));
  });

  it('rejects a non-numeric value for a number parameter', () => {
    expect(operationChangeErrors(rowsSpec, change({ values: { amount: 'lots' } }))).toContainEqual(
      expect.stringContaining('must be a number'),
    );
  });

  it('requires a value only when the parameter has no default', () => {
    const required: OperationChangeSpec = {
      ...rowsSpec,
      parameters: [{ id: 'amount', label: 'Amount', type: 'number' }],
    };
    expect(operationChangeErrors(required, change({ values: {} }))).toContainEqual(
      expect.stringContaining('needs a value for Amount'),
    );
    expect(operationChangeErrors(rowsSpec, change({ values: {} }))).toEqual([]);
  });

  it('rejects a choice outside the declared options', () => {
    const spec: OperationChangeSpec = {
      ...rowsSpec,
      parameters: [{ id: 'band', label: 'Band', type: 'choice', options: ['low', 'high'] }],
    };
    expect(operationChangeErrors(spec, change({ values: { band: 'medium' } }))).toContainEqual(
      expect.stringContaining('must be one of low, high'),
    );
  });
});

describe('binding several datasets to one input', () => {
  const datasets = { 'dataset-1': dataset(), 'dataset-2': dataset() };
  const multiple: OperationManifest = manifest({
    inputs: [{ ...referenceProvider.manifest.inputs[0], multiple: true }],
  });

  it('accepts two sources when the input declares multiple', () => {
    const errors = operationBindingErrors(multiple, [{
      inputId: 'units',
      sources: [
        { datasetId: 'dataset-1', fields: { key: 'id' } },
        { datasetId: 'dataset-2', fields: { key: 'id' } },
      ],
    }], datasets);
    expect(errors).toEqual([]);
  });

  it('refuses two sources when the input does not', () => {
    const errors = operationBindingErrors(referenceProvider.manifest, [{
      inputId: 'units',
      sources: [
        { datasetId: 'dataset-1', fields: { key: 'id' } },
        { datasetId: 'dataset-2', fields: { key: 'id' } },
      ],
    }], datasets);
    expect(errors).toContainEqual(expect.stringContaining('takes one dataset'));
  });

  it('says which of the bound datasets is wrong', () => {
    // "One of your datasets is wrong" does not tell an analyst which one to fix.
    const errors = operationBindingErrors(multiple, [{
      inputId: 'units',
      sources: [
        { datasetId: 'dataset-1', fields: { key: 'id' } },
        { datasetId: 'dataset-2', fields: { key: 'gone' } },
      ],
    }], datasets);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('no column "gone"');
  });
});
