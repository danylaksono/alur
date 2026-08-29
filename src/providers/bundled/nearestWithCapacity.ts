import type {
  OperationChange,
  OperationCreateContext,
  OperationInstance,
  OperationManifest,
  OperationProvider,
  OperationRunResult,
} from '../../types/operations';
import { asNumber, distanceKm, parseInput, representativePoint, type Point } from './geometry';

/**
 * Assign each unit of demand to the nearest supply point that still has room,
 * spilling to the next nearest when one fills up.
 *
 * The capacity is what puts this outside SQL. Nearest-neighbour alone is a
 * lateral join; nearest-*with-room* is not, because whether a supply point has
 * room depends on everything assigned to it so far, and that depends on the
 * order. A spatial join would happily overfill every site and report an answer
 * that looks right.
 *
 * Demand is served in descending weight order, so the largest units get their
 * first choice. That is a defensible convention rather than an optimum — the
 * optimal assignment is a transportation problem — and it is stated here so the
 * result is explainable rather than mysterious.
 */

const manifest: OperationManifest = {
  id: 'alur.nearest-with-capacity',
  label: 'Assign to nearest with capacity',
  description:
    'Assigns each demand unit to the closest supply point with room left, spilling to the next nearest as sites fill. Reports what each site takes on and who could not be served.',
  version: '1.0.0',
  group: 'Allocation',
  keywords: ['catchment', 'assignment', 'nearest facility', 'service area', 'capacity', 'allocation'],

  inputs: [
    {
      id: 'demand',
      label: 'Demand',
      description: 'What needs serving. Any geometry; areas are reduced to a representative point.',
      geometry: 'any',
      multiple: true,
      fields: [
        { id: 'id', label: 'Identifier', semanticType: 'identifier', required: true },
        {
          id: 'weight',
          label: 'Amount',
          semanticType: 'numeric',
          required: false,
          description: 'How much each unit needs. Left unbound, every unit counts as one.',
        },
      ],
    },
    {
      id: 'supply',
      label: 'Supply',
      description: 'The places that serve demand.',
      geometry: 'any',
      multiple: true,
      fields: [
        { id: 'id', label: 'Identifier', semanticType: 'identifier', required: true },
        { id: 'capacity', label: 'Capacity', semanticType: 'numeric', required: true },
      ],
    },
  ],

  parameters: [
    {
      id: 'maxDistanceKm',
      label: 'Maximum distance (km)',
      type: 'number',
      defaultValue: 0,
      description: 'Demand further than this from every site with room is left unserved. 0 removes the limit.',
    },
  ],

  accepts: [
    {
      id: 'add-supply',
      label: 'Add a supply point here',
      description: 'Places a new site at a point on the map, alongside those already in the data.',
      inputId: 'supply',
      referent: 'point',
      parameters: [{ id: 'capacity', label: 'Capacity', type: 'number', defaultValue: 100 }],
    },
    {
      id: 'close-supply',
      label: 'Close these supply points',
      inputId: 'supply',
      referent: 'rows',
      targetFieldRole: 'id',
      parameters: [],
    },
    {
      id: 'resize-supply',
      label: 'Change the capacity of these',
      inputId: 'supply',
      referent: 'rows',
      targetFieldRole: 'id',
      parameters: [{ id: 'factor', label: 'Capacity ×', type: 'number', defaultValue: 1 }],
    },
  ],

  outputs: [
    {
      id: 'assignment',
      label: 'Where demand went',
      kind: 'join',
      joinInputId: 'demand',
      joinFieldRole: 'id',
      fields: [
        { name: 'served', type: 'BOOLEAN' },
        { name: 'assigned_to', type: 'VARCHAR' },
        { name: 'distance_km', type: 'DOUBLE' },
        { name: 'passed_over', type: 'INTEGER' },
      ],
    },
    {
      id: 'load',
      label: 'What each site took on',
      kind: 'join',
      joinInputId: 'supply',
      joinFieldRole: 'id',
      fields: [
        { name: 'assigned', type: 'DOUBLE' },
        { name: 'capacity', type: 'DOUBLE' },
        { name: 'utilisation', type: 'DOUBLE' },
        { name: 'units_served', type: 'INTEGER' },
      ],
    },
  ],

  measure: {
    outputId: 'assignment',
    field: 'distance_km',
    label: 'Mean distance to assigned site',
    unit: 'km',
    aggregation: 'mean',
    preferredDirection: 'lower',
  },
};

type Demand = { id: string; weight: number; point: Point | null; index: number };
type Supply = { id: string; capacity: number; point: Point | null; index: number; placed: boolean };

class NearestInstance implements OperationInstance {
  private maxDistanceKm = 0;
  private closed = new Set<number>();
  private factors = new Map<number, number>();
  private placed: Supply[] = [];

  constructor(
    private demand: Demand[],
    private supply: Supply[],
    private supplyById: Map<string, number>,
    private warnings: string[],
  ) {}

  async setParameters(values: Record<string, unknown>) {
    const max = asNumber(values.maxDistanceKm);
    if (max !== null) this.maxDistanceKm = Math.max(0, max);
  }

  async setChanges(changes: OperationChange[]) {
    this.closed = new Set();
    this.factors = new Map();
    this.placed = [];

    for (const change of [...changes].sort((a, b) => a.sequence - b.sequence)) {
      if (change.changeId === 'add-supply') {
        if (change.target.kind !== 'geometry' || change.target.geometry.type !== 'Point') continue;
        const [lon, lat] = change.target.geometry.coordinates;
        this.placed.push({
          id: `placed:${change.id}`,
          capacity: asNumber(change.values.capacity, 0) ?? 0,
          point: { lon, lat },
          // Negative indices keep placed sites out of the join onto the bound
          // supply dataset, which has no row for them.
          index: -(this.placed.length + 1),
          placed: true,
        });
        continue;
      }
      if (change.target.kind !== 'rows') continue;

      for (const rowId of change.target.rowIds) {
        const index = this.supplyById.get(String(rowId));
        if (index === undefined) continue;
        if (change.changeId === 'close-supply') this.closed.add(index);
        else if (change.changeId === 'resize-supply') {
          const factor = asNumber(change.values.factor, 1) ?? 1;
          this.factors.set(index, (this.factors.get(index) ?? 1) * factor);
          // Reopening is what a resize after a closure has to mean; otherwise
          // the later record could not overrule the earlier one.
          this.closed.delete(index);
        }
      }
    }
  }

  async evaluate(): Promise<OperationRunResult> {
    const warnings = [...this.warnings];

    const sites = [
      ...this.supply
        .filter((site) => !this.closed.has(site.index) && site.point)
        .map((site) => ({ ...site, capacity: site.capacity * (this.factors.get(site.index) ?? 1) })),
      ...this.placed.filter((site) => site.point),
    ];

    if (!sites.length) {
      warnings.push('No supply point is open, so nothing could be assigned.');
    }

    const remaining = new Map(sites.map((site) => [site.index, site.capacity]));
    const takenBy = new Map<number, { amount: number; units: number }>();
    const assigned = new Map<number, { site: string; distance: number; passedOver: number }>();

    // Largest demand first: a convention, not an optimum, and stated in the
    // manifest so the result can be explained rather than guessed at.
    const ordered = [...this.demand].filter((unit) => unit.point).sort((a, b) => b.weight - a.weight);
    let withoutGeometry = this.demand.length - ordered.length;

    for (const unit of ordered) {
      const reachable = sites
        .map((site) => ({ site, distance: distanceKm(unit.point!, site.point!) }))
        .filter((candidate) => !this.maxDistanceKm || candidate.distance <= this.maxDistanceKm)
        .sort((a, b) => a.distance - b.distance);

      let passedOver = 0;
      for (const candidate of reachable) {
        const left = remaining.get(candidate.site.index) ?? 0;
        if (left < unit.weight) {
          passedOver += 1;
          continue;
        }
        remaining.set(candidate.site.index, left - unit.weight);
        const running = takenBy.get(candidate.site.index) ?? { amount: 0, units: 0 };
        takenBy.set(candidate.site.index, { amount: running.amount + unit.weight, units: running.units + 1 });
        assigned.set(unit.index, { site: candidate.site.id, distance: candidate.distance, passedOver });
        break;
      }
    }

    if (withoutGeometry) {
      warnings.push(`${withoutGeometry} demand unit${withoutGeometry === 1 ? '' : 's'} carried no usable geometry and could not be assigned.`);
    }
    const unserved = this.demand.length - assigned.size;
    if (unserved) {
      warnings.push(`${unserved} of ${this.demand.length} demand units could not be served within the capacity available.`);
    }

    const assignmentRows = this.demand.map((unit) => {
      const outcome = assigned.get(unit.index);
      return {
        key: unit.id,
        served: Boolean(outcome),
        assigned_to: outcome ? outcome.site : null,
        distance_km: outcome ? outcome.distance : null,
        passed_over: outcome ? outcome.passedOver : null,
      };
    });

    const loadRows = this.supply.map((site) => {
      const capacity = this.closed.has(site.index) ? 0 : site.capacity * (this.factors.get(site.index) ?? 1);
      const taken = takenBy.get(site.index);
      return {
        key: site.id,
        assigned: taken ? taken.amount : 0,
        capacity,
        utilisation: capacity > 0 ? (taken ? taken.amount : 0) / capacity : null,
        units_served: taken ? taken.units : 0,
      };
    });

    for (const site of this.placed) {
      const taken = takenBy.get(site.index);
      if (!taken) continue;
      warnings.push(
        `A placed supply point took on ${taken.amount} across ${taken.units} unit${taken.units === 1 ? '' : 's'}; placed sites have no row in the supply dataset, so they appear only here.`,
      );
    }

    return {
      outputs: {
        assignment: { kind: 'join', rows: assignmentRows },
        load: { kind: 'join', rows: loadRows },
      },
      warnings: warnings.length ? warnings : undefined,
    };
  }

  dispose() {
    this.demand = [];
    this.supply = [];
    this.supplyById = new Map();
  }
}

export const nearestWithCapacity: OperationProvider = {
  manifest,
  async create({ inputs, parameters }: OperationCreateContext) {
    const demandInput = inputs.find((candidate) => candidate.inputId === 'demand');
    const supplyInput = inputs.find((candidate) => candidate.inputId === 'supply');
    const demandCollection = parseInput(demandInput?.geojson, 'The demand');
    const supplyCollection = parseInput(supplyInput?.geojson, 'The supply');

    const warnings: string[] = [];

    const demand: Demand[] = demandCollection.features.map((feature, index) => {
      const properties = feature.properties ?? {};
      const weightField = demandInput!.fields.weight;
      return {
        id: String(properties[demandInput!.fields.id] ?? index),
        weight: weightField ? asNumber(properties[weightField], 1) ?? 1 : 1,
        point: representativePoint(feature.geometry),
        index,
      };
    });

    const supplyById = new Map<string, number>();
    const supply: Supply[] = supplyCollection.features.map((feature, index) => {
      const properties = feature.properties ?? {};
      const id = String(properties[supplyInput!.fields.id] ?? index);
      if (!supplyById.has(id)) supplyById.set(id, index);
      return {
        id,
        capacity: asNumber(properties[supplyInput!.fields.capacity], 0) ?? 0,
        point: representativePoint(feature.geometry),
        index,
        placed: false,
      };
    });

    if (!demand.length) throw new Error('The demand input carried no features.');
    if (!supply.length) throw new Error('The supply input carried no features.');

    const totalCapacity = supply.reduce((sum, site) => sum + site.capacity, 0);
    const totalDemand = demand.reduce((sum, unit) => sum + unit.weight, 0);
    if (totalCapacity < totalDemand) {
      warnings.push(
        `Total capacity (${totalCapacity}) is below total demand (${totalDemand}), so some units cannot be served whatever the distances.`,
      );
    }

    const instance = new NearestInstance(demand, supply, supplyById, warnings);
    if (parameters && Object.keys(parameters).length) await instance.setParameters(parameters);
    return instance;
  },
};
