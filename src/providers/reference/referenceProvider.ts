import type {
  OperationChange,
  OperationCreateContext,
  OperationInstance,
  OperationManifest,
  OperationProvider,
  OperationRunResult,
} from '../../types/operations';

/**
 * A provider with no analytical meaning, kept so the contract has something to
 * be proved against.
 *
 * It exists for two reasons. The first is testing: every part of the contract —
 * two referents, both output kinds, geometry out, parameters, a nominated
 * measure, order-sensitivity — is exercised by something whose correct answer is
 * arithmetic anyone can check by hand. The second is documentation: this is the
 * shortest complete example of what a provider has to supply, and an author
 * writing a real one can read it in a sitting.
 *
 * What it computes is deliberately arbitrary. Do not give it meaning, and do not
 * let a real calculation grow out of it — a real one belongs in its own package,
 * which is the entire argument for the registry existing.
 */

const manifest: OperationManifest = {
  id: 'reference.tally',
  label: 'Reference tally',
  description: 'Adds recorded amounts to a starting value. For testing the operation contract; it means nothing.',
  version: '1.0.0',
  inputs: [
    {
      id: 'units',
      label: 'Units',
      description: 'Anything with an identifier. What the rows represent is not this calculation’s business.',
      geometry: 'any',
      fields: [{ id: 'key', label: 'Identifier', semanticType: 'identifier', required: true }],
    },
  ],
  parameters: [
    { id: 'start', label: 'Starting value', type: 'number', defaultValue: 0 },
  ],
  accepts: [
    {
      id: 'adjust',
      label: 'Adjust selected units',
      inputId: 'units',
      referent: 'rows',
      parameters: [{ id: 'amount', label: 'Amount', type: 'number', defaultValue: 1 }],
    },
    {
      id: 'place',
      label: 'Place a unit',
      inputId: 'units',
      referent: 'point',
      parameters: [{ id: 'amount', label: 'Amount', type: 'number', defaultValue: 1 }],
    },
  ],
  outputs: [
    {
      id: 'values',
      label: 'Value per unit',
      kind: 'join',
      joinInputId: 'units',
      fields: [{ name: 'reference_value', type: 'DOUBLE' }],
    },
    {
      id: 'placed',
      label: 'Placed units',
      kind: 'dataset',
      geometry: 'point',
      fields: [{ name: 'reference_amount', type: 'DOUBLE' }],
    },
  ],
  measure: {
    outputId: 'values',
    field: 'reference_value',
    label: 'Total value',
    aggregation: 'sum',
    preferredDirection: 'higher',
  },
};

const amountOf = (change: OperationChange) => {
  const value = Number(change.values.amount);
  return Number.isFinite(value) ? value : 0;
};

class ReferenceInstance implements OperationInstance {
  private keys: string[];
  private start = 0;
  private changes: OperationChange[] = [];

  constructor(context: OperationCreateContext) {
    const input = context.inputs.find((candidate) => candidate.inputId === 'units');
    const keyColumn = input?.fields.key ?? 'id';

    if (input?.rows) {
      this.keys = input.rows.map((row) => String(row[keyColumn]));
    } else if (input?.geojson) {
      const collection = JSON.parse(input.geojson) as GeoJSON.FeatureCollection;
      this.keys = collection.features.map((feature) => String(feature.properties?.[keyColumn]));
    } else {
      this.keys = [];
    }

    this.start = Number(context.parameters.start) || 0;
  }

  async setParameters(values: Record<string, unknown>) {
    this.start = Number(values.start) || 0;
  }

  async setChanges(changes: OperationChange[]) {
    // Replaced wholesale, never accumulated. The contract says the state equals
    // exactly this list, and a provider that appended instead would drift the
    // moment anything was undone.
    this.changes = [...changes].sort((a, b) => a.sequence - b.sequence);
  }

  async evaluate(): Promise<OperationRunResult> {
    const values = new Map(this.keys.map((key) => [key, this.start]));
    const placed: GeoJSON.Feature[] = [];

    for (const change of this.changes) {
      if (change.target.kind === 'rows') {
        for (const rowId of change.target.rowIds) {
          if (values.has(rowId)) values.set(rowId, (values.get(rowId) ?? 0) + amountOf(change));
        }
      } else {
        placed.push({
          type: 'Feature',
          geometry: change.target.geometry,
          properties: { reference_amount: amountOf(change) },
        });
      }
    }

    return {
      outputs: {
        values: {
          kind: 'join',
          rows: [...values].map(([key, value]) => ({ key, reference_value: value })),
        },
        placed: {
          kind: 'dataset',
          geojson: { type: 'FeatureCollection', features: placed },
        },
      },
    };
  }

  dispose() {
    this.keys = [];
    this.changes = [];
  }
}

export const referenceProvider: OperationProvider = {
  manifest,
  create: async (context) => new ReferenceInstance(context),
};
