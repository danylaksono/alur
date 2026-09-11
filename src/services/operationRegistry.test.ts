import { describe, expect, it } from 'vitest';
import type { OperationManifest } from '../types/operations';
import type { DatasetDescriptor } from '../types/datasets';
import { referenceProvider } from '../providers/reference/referenceProvider';
import { operationBindingErrors } from './operationRegistry';

const manifest = (patch: Partial<OperationManifest> = {}): OperationManifest => ({
  ...structuredClone(referenceProvider.manifest),
  id: 'test.provider',
  ...patch,
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
