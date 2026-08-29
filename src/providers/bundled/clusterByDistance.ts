import type {
  OperationCreateContext,
  OperationInstance,
  OperationManifest,
  OperationProvider,
  OperationRunResult,
} from '../../types/operations';
import { GridIndex, asNumber, distanceKm, parseInput, representativePoint, type Point } from './geometry';

/**
 * Group points that are densely packed together, leaving sparse ones ungrouped.
 *
 * DBSCAN. It is here rather than as a workflow node for the usual reason —
 * cluster membership is transitive, so it is a graph traversal and not a
 * predicate over rows. SQL can express it only with a recursive CTE, which is
 * both slower and considerably harder to read than the twenty lines below.
 *
 * This calculation accepts no changes, and that is worth noticing: a calculation
 * with nothing to assert is a perfectly ordinary member of the toolbox. Not
 * everything an analyst runs is a scenario.
 */

const manifest: OperationManifest = {
  id: 'alur.cluster-by-distance',
  label: 'Cluster by distance',
  description:
    'Groups features that sit within a given distance of enough neighbours, and marks the rest as ungrouped. Density-based, so clusters take whatever shape the data has.',
  version: '1.0.0',
  group: 'Clustering',
  keywords: ['dbscan', 'density', 'cluster', 'hotspot', 'grouping', 'neighbourhood'],

  inputs: [
    {
      id: 'units',
      label: 'Features',
      description: 'Any geometry; areas are reduced to a representative point.',
      geometry: 'any',
      multiple: true,
      fields: [{ id: 'id', label: 'Identifier', semanticType: 'identifier', required: true }],
    },
  ],

  parameters: [
    { id: 'radiusKm', label: 'Neighbourhood radius (km)', type: 'number', defaultValue: 1 },
    {
      id: 'minPoints',
      label: 'Minimum neighbours to form a cluster',
      type: 'number',
      defaultValue: 4,
      description: 'Counting the feature itself.',
    },
  ],

  accepts: [],

  outputs: [
    {
      id: 'clusters',
      label: 'Cluster membership',
      kind: 'join',
      joinInputId: 'units',
      joinFieldRole: 'id',
      fields: [
        { name: 'cluster', type: 'INTEGER' },
        { name: 'cluster_size', type: 'INTEGER' },
        { name: 'neighbours', type: 'INTEGER' },
        { name: 'is_core', type: 'BOOLEAN' },
      ],
    },
  ],

  measure: {
    outputId: 'clusters',
    field: 'cluster_size',
    label: 'Mean cluster size',
    aggregation: 'mean',
    preferredDirection: 'higher',
  },
};

type Unit = { id: string; point: Point | null; index: number };

class ClusterInstance implements OperationInstance {
  private radiusKm = 1;
  private minPoints = 4;

  constructor(private units: Unit[], private warnings: string[]) {}

  async setParameters(values: Record<string, unknown>) {
    const radius = asNumber(values.radiusKm);
    if (radius !== null) this.radiusKm = Math.max(0, radius);
    const min = asNumber(values.minPoints);
    if (min !== null) this.minPoints = Math.max(1, Math.round(min));
  }

  /** Nothing to assert; the contract still requires the method to exist. */
  async setChanges() {}

  async evaluate(): Promise<OperationRunResult> {
    const warnings = [...this.warnings];
    const placed = this.units.filter((unit) => unit.point);
    if (placed.length < this.units.length) {
      const missing = this.units.length - placed.length;
      warnings.push(`${missing} feature${missing === 1 ? '' : 's'} carried no usable geometry and could not be clustered.`);
    }

    const index = new GridIndex<Unit>(Math.max(this.radiusKm, 1e-6));
    for (const unit of placed) index.add(unit.point!, unit);

    const neighboursOf = (unit: Unit) =>
      index.near(unit.point!).filter((candidate) => distanceKm(unit.point!, candidate.point) <= this.radiusKm)
        .map((candidate) => candidate.value);

    const neighbourCount = new Map<number, number>();
    const cluster = new Map<number, number>();
    const core = new Set<number>();
    let next = 0;

    for (const unit of placed) {
      const found = neighboursOf(unit);
      neighbourCount.set(unit.index, found.length);
      if (found.length >= this.minPoints) core.add(unit.index);
    }

    // Breadth-first from each unvisited core point. Density-reachability is
    // transitive through core points only, which is what keeps two clusters
    // joined by a single sparse point from merging.
    for (const unit of placed) {
      if (!core.has(unit.index) || cluster.has(unit.index)) continue;
      const id = (next += 1);
      const queue = [unit];
      cluster.set(unit.index, id);

      while (queue.length) {
        const current = queue.pop()!;
        if (!core.has(current.index)) continue;
        for (const neighbour of neighboursOf(current)) {
          if (cluster.has(neighbour.index)) continue;
          cluster.set(neighbour.index, id);
          queue.push(neighbour);
        }
      }
    }

    const sizes = new Map<number, number>();
    for (const id of cluster.values()) sizes.set(id, (sizes.get(id) ?? 0) + 1);

    if (!next) {
      warnings.push(
        `Nothing formed a cluster: no feature has ${this.minPoints} neighbours within ${this.radiusKm} km. Widen the radius or lower the minimum.`,
      );
    }

    // Null, never zero, for an ungrouped feature: cluster 0 would be a cluster.
    const rows = this.units.map((unit) => {
      const id = cluster.get(unit.index);
      return {
        key: unit.id,
        cluster: id ?? null,
        cluster_size: id ? sizes.get(id) ?? null : null,
        neighbours: neighbourCount.get(unit.index) ?? null,
        is_core: core.has(unit.index),
      };
    });

    return { outputs: { clusters: { kind: 'join', rows } }, warnings: warnings.length ? warnings : undefined };
  }

  dispose() {
    this.units = [];
  }
}

export const clusterByDistance: OperationProvider = {
  manifest,
  async create({ inputs, parameters }: OperationCreateContext) {
    const input = inputs.find((candidate) => candidate.inputId === 'units');
    const collection = parseInput(input?.geojson, 'The features');

    const seen = new Set<string>();
    const warnings: string[] = [];
    const units: Unit[] = collection.features.map((feature, index) => {
      const properties = feature.properties ?? {};
      const id = String(properties[input!.fields.id] ?? index);
      seen.add(id);
      return { id, point: representativePoint(feature.geometry), index };
    });

    if (!units.length) throw new Error('The features input carried no features.');
    if (seen.size !== units.length) {
      warnings.push(`The identifier column is not unique — ${units.length - seen.size} duplicate value${units.length - seen.size === 1 ? '' : 's'}.`);
    }

    const instance = new ClusterInstance(units, warnings);
    if (parameters && Object.keys(parameters).length) await instance.setParameters(parameters);
    return instance;
  },
};
