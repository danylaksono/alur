import type {
  OperationChange,
  OperationCreateContext,
  OperationInstance,
  OperationManifest,
  OperationProvider,
  OperationRunResult,
} from '../../types/operations';
import { GridIndex, asNumber, distanceKm, parseInput, representativePoint, type Point } from './geometry';

/**
 * Walk a ranked set, keeping each candidate only if nothing already kept is too
 * close to it.
 *
 * This belongs in a calculation rather than a workflow node because it cannot be
 * written as one `SELECT`. Whether a candidate survives depends on which
 * candidates survived before it, so the answer is a sequential pass, not a
 * predicate — a window function can rank, but it cannot ask what the ranking has
 * already committed to. It is the single most common reason an analyst has to
 * leave a query builder and write a script.
 *
 * Greedy in rank order, and deliberately not an optimal dispersion. A candidate
 * dropped for sitting near a better-ranked one is not reconsidered later. That is
 * what a sequential selection is, and it is why the answer depends on the
 * ranking — which is the property that makes it explainable.
 */

const manifest: OperationManifest = {
  id: 'alur.thin-by-spacing',
  label: 'Thin by minimum spacing',
  description:
    'Walks candidates in rank order and keeps each one only if nothing already kept lies within a given distance. Use it when a ranked shortlist clusters and you need it spread out.',
  version: '1.0.0',
  group: 'Selection',
  keywords: ['dispersion', 'spacing', 'thinning', 'declustering', 'spread', 'minimum distance'],

  inputs: [
    {
      id: 'units',
      label: 'Candidates',
      description:
        'What is being chosen between. Any geometry; areas are reduced to a representative point.',
      geometry: 'any',
      multiple: true,
      fields: [
        { id: 'id', label: 'Identifier', semanticType: 'identifier', required: true },
        {
          id: 'priority',
          label: 'Rank by',
          semanticType: 'numeric',
          required: true,
          description: 'Candidates are considered in the order this column gives.',
        },
      ],
    },
  ],

  parameters: [
    { id: 'minSpacingKm', label: 'Minimum spacing (km)', type: 'number', defaultValue: 1 },
    {
      id: 'direction',
      label: 'Consider first the',
      type: 'choice',
      defaultValue: 'higher',
      options: [
        { value: 'higher', label: 'highest ranked' },
        { value: 'lower', label: 'lowest ranked' },
      ],
    },
    {
      id: 'limit',
      label: 'Stop after keeping',
      type: 'number',
      defaultValue: 0,
      description: '0 keeps as many as the spacing allows.',
    },
  ],

  accepts: [
    {
      id: 'keep',
      label: 'Keep these regardless',
      description:
        'Considered before everything else, so they survive the spacing rule and displace whatever sits near them.',
      inputId: 'units',
      referent: 'rows',
      targetFieldRole: 'id',
      parameters: [],
    },
    {
      id: 'drop',
      label: 'Rule these out',
      inputId: 'units',
      referent: 'rows',
      targetFieldRole: 'id',
      parameters: [],
    },
  ],

  outputs: [
    {
      id: 'selection',
      label: 'What survived',
      kind: 'join',
      joinInputId: 'units',
      joinFieldRole: 'id',
      fields: [
        { name: 'kept', type: 'BOOLEAN' },
        { name: 'keep_order', type: 'INTEGER' },
        { name: 'nearest_kept_km', type: 'DOUBLE' },
        { name: 'displaced_by', type: 'VARCHAR' },
      ],
    },
  ],

  measure: {
    outputId: 'selection',
    field: 'nearest_kept_km',
    label: 'Mean spacing achieved',
    unit: 'km',
    aggregation: 'mean',
    preferredDirection: 'higher',
  },
};

type Unit = { id: string; priority: number | null; point: Point | null; index: number };

class ThinInstance implements OperationInstance {
  private minSpacingKm = 1;
  private direction: 'higher' | 'lower' = 'higher';
  private limit = 0;
  /** Rebuilt from the change list every time; never accumulated. */
  private disposition = new Map<number, 'keep' | 'drop'>();

  constructor(private units: Unit[], private byId: Map<string, number>, private warnings: string[]) {}

  async setParameters(values: Record<string, unknown>) {
    const spacing = asNumber(values.minSpacingKm);
    if (spacing !== null) this.minSpacingKm = Math.max(0, spacing);
    const limit = asNumber(values.limit);
    if (limit !== null) this.limit = Math.max(0, Math.round(limit));
    if (values.direction !== undefined) {
      this.direction = String(values.direction) === 'lower' ? 'lower' : 'higher';
    }
  }

  /**
   * Keeping and dropping share one map, so the later record about a unit wins.
   * Holding them apart would make "rule it out, then think again" produce the
   * same answer as its reverse, and the ordering the contract guarantees would
   * be a fiction.
   */
  async setChanges(changes: OperationChange[]) {
    this.disposition = new Map();
    for (const change of [...changes].sort((a, b) => a.sequence - b.sequence)) {
      if (change.target.kind !== 'rows') continue;
      const verdict = change.changeId === 'keep' ? 'keep' : 'drop';
      for (const rowId of change.target.rowIds) {
        const index = this.byId.get(String(rowId));
        if (index !== undefined) this.disposition.set(index, verdict);
      }
    }
  }

  async evaluate(): Promise<OperationRunResult> {
    const warnings = [...this.warnings];
    const sign = this.direction === 'lower' ? 1 : -1;

    const eligible = this.units.filter((unit) => this.disposition.get(unit.index) !== 'drop');
    const ordered = [...eligible].sort((a, b) => {
      // A forced keep is considered before the ranking, so it survives the rule
      // and displaces what sits near it rather than competing with it.
      const forced = Number(this.disposition.get(b.index) === 'keep') - Number(this.disposition.get(a.index) === 'keep');
      if (forced) return forced;
      const left = a.priority ?? Number.NEGATIVE_INFINITY;
      const right = b.priority ?? Number.NEGATIVE_INFINITY;
      return sign * (left - right);
    });

    const index = new GridIndex<string>(Math.max(this.minSpacingKm, 1e-6));
    const kept = new Map<number, { order: number; nearest: number | null }>();
    const displaced = new Map<number, { by: string; distance: number }>();
    let order = 0;
    let withoutGeometry = 0;

    for (const unit of ordered) {
      if (this.limit && order >= this.limit) break;
      if (!unit.point) {
        withoutGeometry += 1;
        continue;
      }

      let closest: { id: string; distance: number } | null = null;
      if (this.minSpacingKm > 0) {
        for (const candidate of index.near(unit.point)) {
          const distance = distanceKm(unit.point, candidate.point);
          if (!closest || distance < closest.distance) closest = { id: candidate.value, distance };
        }
      }

      if (closest && closest.distance < this.minSpacingKm) {
        displaced.set(unit.index, { by: closest.id, distance: closest.distance });
        continue;
      }

      order += 1;
      kept.set(unit.index, { order, nearest: closest ? closest.distance : null });
      index.add(unit.point, unit.id);
    }

    if (withoutGeometry) {
      warnings.push(
        `${withoutGeometry} candidate${withoutGeometry === 1 ? '' : 's'} carried no usable geometry and could not be placed, so ${withoutGeometry === 1 ? 'it was' : 'they were'} not kept.`,
      );
    }
    if (this.limit && order >= this.limit) {
      warnings.push(`Stopped after keeping ${this.limit}; more candidates would have fitted.`);
    }

    // Null, never zero: a candidate that was never compared to anything has no
    // spacing, and reporting that as 0 km would make it look like the worst
    // possible result on a map.
    const rows = this.units.map((unit) => {
      const survived = kept.get(unit.index);
      const pushed = displaced.get(unit.index);
      return {
        key: unit.id,
        kept: Boolean(survived),
        keep_order: survived ? survived.order : null,
        nearest_kept_km: survived ? survived.nearest : pushed ? pushed.distance : null,
        displaced_by: pushed ? pushed.by : null,
      };
    });

    return { outputs: { selection: { kind: 'join', rows } }, warnings: warnings.length ? warnings : undefined };
  }

  dispose() {
    this.units = [];
    this.byId = new Map();
  }
}

export const thinBySpacing: OperationProvider = {
  manifest,
  async create({ inputs, parameters }: OperationCreateContext) {
    const input = inputs.find((candidate) => candidate.inputId === 'units');
    const collection = parseInput(input?.geojson, 'The candidates');
    const fields = input!.fields;

    const warnings: string[] = [];
    const byId = new Map<string, number>();
    const units: Unit[] = collection.features.map((feature, index) => {
      const properties = feature.properties ?? {};
      const id = String(properties[fields.id] ?? index);
      if (!byId.has(id)) byId.set(id, index);
      return { id, priority: asNumber(properties[fields.priority]), point: representativePoint(feature.geometry), index };
    });

    if (!units.length) throw new Error('The candidates input carried no features.');
    if (byId.size !== units.length) {
      warnings.push(
        `The identifier column is not unique — ${units.length - byId.size} duplicate value${units.length - byId.size === 1 ? '' : 's'}. Selections will reach only the first row of each.`,
      );
    }

    const instance = new ThinInstance(units, byId, warnings);
    if (parameters && Object.keys(parameters).length) await instance.setParameters(parameters);
    return instance;
  },
};
