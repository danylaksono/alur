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
 * Spend a recurring budget down a ranked list, year by year.
 *
 * Not a query, and not a window function either. Whether a unit is taken in a
 * given year depends on how much of that year's budget the units above it have
 * already consumed, and how much was left unspent by the year before — so the
 * answer for one row is a function of the answers already given for others, in
 * order. `QUALIFY SUM(cost) OVER (ORDER BY rank) <= budget` gets the first year
 * and then has nothing to say about the second.
 *
 * The four things that make it a planning tool rather than a running total:
 * unspent budget carries forward, a committed unit takes time to reach its full
 * yield, an analyst can pin a unit to a year regardless of its rank, and a
 * spacing rule can stop the result piling into one place.
 */

const manifest: OperationManifest = {
  id: 'alur.phased-allocation',
  label: 'Phased allocation under a recurring budget',
  description:
    'Walks a ranked set of units year by year, committing each one when the year\'s budget can still afford it, and reports what was chosen when and what it yields over time.',
  version: '1.0.0',
  group: 'Allocation',
  keywords: ['budget', 'phasing', 'programme', 'capital', 'schedule', 'sequencing', 'portfolio', 'ramp'],

  inputs: [
    {
      id: 'units',
      label: 'Units',
      description:
        'The candidates. Any geometry; areas are reduced to a representative point, which is only used for the spacing rule.',
      geometry: 'any',
      multiple: true,
      fields: [
        { id: 'id', label: 'Identifier', semanticType: 'identifier', required: true },
        {
          id: 'priority',
          label: 'Priority',
          semanticType: 'numeric',
          required: true,
          description: 'Order of consideration. Compute it upstream however you like — a composite score, a single measure, a rank.',
        },
        {
          id: 'cost',
          label: 'Cost',
          semanticType: 'numeric',
          required: true,
          description: 'What committing this unit takes out of the budget, once.',
        },
        {
          id: 'benefit',
          label: 'Annual yield',
          semanticType: 'numeric',
          required: true,
          description: 'What this unit returns each year once committed and fully ramped.',
        },
        {
          id: 'eligible',
          label: 'Eligibility flag',
          semanticType: 'categorical',
          required: false,
          description: 'Optional. When bound, only units whose value is true, yes, y, 1 or on are considered.',
        },
      ],
    },
  ],

  parameters: [
    { id: 'startYear', label: 'First year', type: 'number', defaultValue: 1 },
    { id: 'endYear', label: 'Last year', type: 'number', defaultValue: 10 },
    { id: 'annualBudget', label: 'Budget per year', type: 'number', defaultValue: 1000000 },
    {
      id: 'carryUnspent',
      label: 'Carry unspent budget forward',
      type: 'choice',
      defaultValue: 'yes',
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
      ],
    },
    {
      id: 'rampYears',
      label: 'Years to reach full yield',
      type: 'number',
      defaultValue: 1,
      description: 'A unit committed in year 3 with a 5-year ramp returns a fifth of its yield in year 3 and all of it from year 7.',
    },
    {
      id: 'minSeparationKm',
      label: 'Minimum spacing between committed units (km)',
      type: 'number',
      defaultValue: 0,
      description: '0 disables the rule.',
    },
    {
      id: 'priorityDirection',
      label: 'Take units with the',
      type: 'choice',
      defaultValue: 'higher',
      options: [
        { value: 'higher', label: 'higher priority value first' },
        { value: 'lower', label: 'lower priority value first' },
      ],
    },
  ],

  accepts: [
    {
      id: 'commit',
      label: 'Commit these units',
      description:
        'Puts the selection ahead of everything ranked above it, in the year given. Still has to be affordable — a commitment the budget cannot cover is reported rather than granted.',
      inputId: 'units',
      referent: 'rows',
      targetFieldRole: 'id',
      parameters: [{ id: 'year', label: 'Year', type: 'number', defaultValue: 1 }],
    },
    {
      id: 'exclude',
      label: 'Rule these units out',
      description: 'Takes the selection off the table for every year.',
      inputId: 'units',
      referent: 'rows',
      targetFieldRole: 'id',
      parameters: [],
    },
    {
      id: 'revalue',
      label: 'Assert a different cost or yield',
      description: 'Multiplies the bound cost and yield for the selection. Factors from several records multiply together.',
      inputId: 'units',
      referent: 'rows',
      targetFieldRole: 'id',
      parameters: [
        { id: 'costFactor', label: 'Cost ×', type: 'number', defaultValue: 1 },
        { id: 'benefitFactor', label: 'Yield ×', type: 'number', defaultValue: 1 },
      ],
    },
  ],

  outputs: [
    {
      id: 'allocation',
      label: 'What was committed',
      kind: 'join',
      joinInputId: 'units',
      joinFieldRole: 'id',
      fields: [
        { name: 'committed', type: 'BOOLEAN' },
        { name: 'committed_year', type: 'INTEGER' },
        { name: 'spend', type: 'DOUBLE' },
        { name: 'cumulative_benefit', type: 'DOUBLE' },
      ],
    },
    {
      id: 'trajectory',
      label: 'Year by year',
      kind: 'dataset',
      geometry: 'point',
      fields: [
        { name: 'unit', type: 'VARCHAR' },
        { name: 'year', type: 'INTEGER' },
        { name: 'spend', type: 'DOUBLE' },
        { name: 'benefit', type: 'DOUBLE' },
        { name: 'cumulative_benefit', type: 'DOUBLE' },
        { name: 'committed_this_year', type: 'BOOLEAN' },
      ],
    },
  ],

  measure: {
    outputId: 'allocation',
    field: 'cumulative_benefit',
    label: 'Total yield',
    aggregation: 'sum',
    preferredDirection: 'higher',
  },
};

/**
 * A cap on the year-by-year output, not on the calculation.
 *
 * The per-unit result stays complete whatever happens here; this only bounds the
 * long-format table, which is units × years and so grows fast enough to be worth
 * a limit. Truncation is always reported.
 */
const TRAJECTORY_ROW_CAP = 500_000;

/**
 * Whether a bound eligibility column means yes.
 *
 * Deliberately generous about what a flag looks like: the column is the
 * analyst's, and it may have been a boolean, a string or a 1 on its way through
 * CSV, Parquet or a DuckDB expression.
 */
const truthy = (value: unknown) => {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;
  const text = String(value).trim().toLowerCase();
  return text === 'true' || text === 'yes' || text === 'y' || text === '1' || text === 'on';
};

type Unit = {
  id: string;
  index: number;
  priority: number | null;
  cost: number | null;
  benefit: number | null;
  eligible: boolean | null;
  point: Point | null;
};

type Disposition = { kind: 'exclude' } | { kind: 'commit'; year: number };

class PhasedAllocationInstance implements OperationInstance {
  private startYear = 1;
  private endYear = 10;
  private annualBudget = 1_000_000;
  private carryUnspent = true;
  private rampYears = 1;
  private minSeparationKm = 0;
  private direction: 'higher' | 'lower' = 'higher';

  /**
   * Rebuilt from the change list every time; never accumulated.
   *
   * Commitment and exclusion share one map because they answer the same
   * question, and the analyst may say both about the same unit. Held apart, the
   * later record could not overrule the earlier one, so "rule it out, then think
   * again and commit it" and its reverse would give the same allocation — which
   * would make the ordering the contract guarantees a fiction.
   */
  private disposition = new Map<number, Disposition>();
  private costFactor = new Map<number, number>();
  private benefitFactor = new Map<number, number>();
  private changeWarnings: string[] = [];

  constructor(
    private units: Unit[],
    private byId: Map<string, number>,
    private readonly warnings: string[],
  ) {}

  async setParameters(values: Record<string, unknown>) {
    const start = asNumber(values.startYear);
    if (start !== null) this.startYear = Math.round(start);
    const end = asNumber(values.endYear);
    if (end !== null) this.endYear = Math.round(end);

    const budget = asNumber(values.annualBudget);
    if (budget !== null) this.annualBudget = budget;

    const ramp = asNumber(values.rampYears);
    if (ramp !== null) this.rampYears = Math.max(1, Math.round(ramp));

    const separation = asNumber(values.minSeparationKm);
    if (separation !== null) this.minSeparationKm = Math.max(0, separation);

    if (values.carryUnspent !== undefined) this.carryUnspent = String(values.carryUnspent) !== 'no';
    if (values.priorityDirection !== undefined) {
      this.direction = String(values.priorityDirection) === 'lower' ? 'lower' : 'higher';
    }
  }

  async setChanges(changes: OperationChange[]) {
    this.disposition = new Map();
    this.costFactor = new Map();
    this.benefitFactor = new Map();
    this.changeWarnings = [];

    let unmatched = 0;
    let targeted = 0;

    for (const change of [...changes].sort((a, b) => a.sequence - b.sequence)) {
      if (change.target.kind !== 'rows') continue;
      for (const rowId of change.target.rowIds) {
        targeted += 1;
        const index = this.byId.get(String(rowId));
        if (index === undefined) {
          unmatched += 1;
          continue;
        }
        if (change.changeId === 'exclude') {
          this.disposition.set(index, { kind: 'exclude' });
        } else if (change.changeId === 'commit') {
          this.disposition.set(index, { kind: 'commit', year: Math.round(asNumber(change.values.year, 1) ?? 1) });
        } else if (change.changeId === 'revalue') {
          // Multiplied, not replaced: two separate assertions about the same
          // unit are two adjustments, and the second was not made in ignorance
          // of the first.
          const cost = asNumber(change.values.costFactor, 1) ?? 1;
          const benefit = asNumber(change.values.benefitFactor, 1) ?? 1;
          this.costFactor.set(index, (this.costFactor.get(index) ?? 1) * cost);
          this.benefitFactor.set(index, (this.benefitFactor.get(index) ?? 1) * benefit);
        }
      }
    }

    if (unmatched) {
      this.changeWarnings.push(
        `${unmatched} of ${targeted} selected rows matched no unit and were ignored.`,
      );
    }
  }

  private costOf(unit: Unit) {
    return (unit.cost ?? Number.NaN) * (this.costFactor.get(unit.index) ?? 1);
  }

  private benefitOf(unit: Unit) {
    return (unit.benefit ?? 0) * (this.benefitFactor.get(unit.index) ?? 1);
  }

  /**
   * A commitment overrides eligibility, not affordability.
   *
   * An analyst asserting that a unit should be taken is a stronger statement
   * than a column saying it does not qualify — that column is an input to the
   * ranking, and overruling it is what committing means. The budget is
   * different. It is a resource that runs out, and a commitment it cannot cover
   * is a tension worth reporting rather than an instruction to overspend.
   */
  private considered(unit: Unit, committedAt: Map<number, number>) {
    const disposition = this.disposition.get(unit.index);
    if (disposition?.kind === 'exclude') return false;
    if (disposition?.kind === 'commit') return true;
    if (committedAt.has(unit.index)) return true;
    if (unit.eligible === false) return false;
    return Number.isFinite(unit.priority);
  }

  private pinnedYear(unit: Unit) {
    const disposition = this.disposition.get(unit.index);
    return disposition?.kind === 'commit' ? disposition.year : undefined;
  }

  async evaluate(): Promise<OperationRunResult> {
    const warnings = [...this.warnings, ...this.changeWarnings];
    const { startYear, endYear, rampYears, minSeparationKm } = this;

    if (!Number.isFinite(startYear) || !Number.isFinite(endYear) || endYear < startYear) {
      throw new Error('The last year must be the same as or after the first year.');
    }

    // A commitment pinned outside the run can never be taken, and would
    // otherwise look identical to one the budget refused.
    const stranded = [...this.disposition.values()].filter(
      (disposition) => disposition.kind === 'commit' && (disposition.year < startYear || disposition.year > endYear),
    ).length;
    if (stranded) {
      warnings.push(
        `${stranded} committed ${stranded === 1 ? 'unit is' : 'units are'} pinned to a year outside ${startYear}–${endYear} and cannot be taken.`,
      );
    }

    const sign = this.direction === 'lower' ? 1 : -1;
    const spacing = minSeparationKm > 0 ? new GridIndex<string>(minSeparationKm) : null;
    const committedAt = new Map<number, number>();
    const spendOf = new Map<number, number>();
    const cumulative = new Map<number, number>();
    const trajectory: Array<{
      point: Point | null;
      unit: string;
      year: number;
      spend: number;
      benefit: number;
      cumulative_benefit: number;
      committed_this_year: boolean;
    }> = [];

    let carried = 0;
    let unfundedCommitments = 0;
    let spacingRejections = 0;
    let truncated = 0;

    for (let year = startYear; year <= endYear; year += 1) {
      let budget = this.annualBudget + (this.carryUnspent ? carried : 0);

      // Sorted per year rather than once, because a unit pinned to *this* year
      // sorts ahead of everything else and that is a different order each time.
      const order = this.units
        .filter((unit) => this.considered(unit, committedAt))
        .sort((a, b) => {
          const pinned = Number(this.pinnedYear(b) === year) - Number(this.pinnedYear(a) === year);
          if (pinned) return pinned;
          const left = a.priority ?? Number.NEGATIVE_INFINITY;
          const right = b.priority ?? Number.NEGATIVE_INFINITY;
          return sign * (left - right);
        });

      for (const unit of order) {
        const already = committedAt.get(unit.index);

        if (already !== undefined) {
          // Already running: no spend, and a yield that climbs over the ramp.
          const age = year - already + 1;
          const fraction = Math.min(1, age / rampYears);
          const benefit = this.benefitOf(unit) * fraction;
          const running = (cumulative.get(unit.index) ?? 0) + benefit;
          cumulative.set(unit.index, running);
          if (trajectory.length < TRAJECTORY_ROW_CAP) {
            trajectory.push({
              point: unit.point,
              unit: unit.id,
              year,
              spend: 0,
              benefit,
              cumulative_benefit: running,
              committed_this_year: false,
            });
          } else truncated += 1;
          continue;
        }

        const pinned = this.pinnedYear(unit);
        if (pinned !== undefined && pinned !== year) continue;

        if (spacing && unit.point) {
          const point = unit.point;
          const tooClose = spacing.near(point).some((other) => distanceKm(point, other.point) < minSeparationKm);
          if (tooClose) {
            if (pinned !== undefined) spacingRejections += 1;
            continue;
          }
        }

        const cost = this.costOf(unit);
        if (!Number.isFinite(cost) || cost < 0) continue;
        if (cost > budget) {
          if (pinned !== undefined) unfundedCommitments += 1;
          continue;
        }

        budget -= cost;
        committedAt.set(unit.index, year);
        spendOf.set(unit.index, cost);
        if (spacing && unit.point) spacing.add(unit.point, unit.id);

        const benefit = this.benefitOf(unit) * Math.min(1, 1 / rampYears);
        const running = (cumulative.get(unit.index) ?? 0) + benefit;
        cumulative.set(unit.index, running);
        if (trajectory.length < TRAJECTORY_ROW_CAP) {
          trajectory.push({
            point: unit.point,
            unit: unit.id,
            year,
            spend: cost,
            benefit,
            cumulative_benefit: running,
            committed_this_year: true,
          });
        } else truncated += 1;
      }

      carried = Math.max(0, budget);
    }

    if (unfundedCommitments) {
      warnings.push(
        `${unfundedCommitments} committed ${unfundedCommitments === 1 ? 'unit' : 'units'} could not be afforded in the year they were pinned to and were not taken.`,
      );
    }
    if (spacingRejections) {
      warnings.push(
        `${spacingRejections} committed ${spacingRejections === 1 ? 'unit was' : 'units were'} rejected by the ${minSeparationKm} km spacing rule.`,
      );
    }
    if (truncated) {
      warnings.push(
        `The year-by-year output was capped at ${TRAJECTORY_ROW_CAP.toLocaleString()} rows; ${truncated.toLocaleString()} more were dropped. The per-unit result is complete.`,
      );
    }

    // Null, never zero: a unit never committed has no spend and no year, and
    // reporting those as zeroes would make it indistinguishable on a map from
    // one committed at no cost.
    const rows = this.units.map((unit) => {
      const committed = committedAt.has(unit.index);
      return {
        key: unit.id,
        committed,
        committed_year: committed ? committedAt.get(unit.index)! : null,
        spend: committed ? spendOf.get(unit.index) ?? null : null,
        cumulative_benefit: cumulative.get(unit.index) ?? null,
      };
    });

    const features: GeoJSON.Feature[] = trajectory
      .filter((row): row is typeof row & { point: Point } => Boolean(row.point))
      .map((row) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [row.point.lon, row.point.lat] },
        properties: {
          unit: row.unit,
          year: row.year,
          spend: row.spend,
          benefit: row.benefit,
          cumulative_benefit: row.cumulative_benefit,
          committed_this_year: row.committed_this_year,
        },
      }));

    return {
      outputs: {
        allocation: { kind: 'join', rows },
        trajectory: { kind: 'dataset', geojson: { type: 'FeatureCollection', features } },
      },
      warnings: warnings.length ? warnings : undefined,
    };
  }

  dispose() {
    this.units = [];
    this.byId = new Map();
  }
}

export const phasedAllocation: OperationProvider = {
  manifest,
  async create({ inputs, parameters }: OperationCreateContext) {
    const input = inputs.find((candidate) => candidate.inputId === 'units');
    const collection = parseInput(input?.geojson, 'The units');
    const fields = input!.fields;

    const warnings: string[] = [];
    const byId = new Map<string, number>();
    const units: Unit[] = collection.features.map((feature, index) => {
      const properties = feature.properties ?? {};
      const id = String(properties[fields.id] ?? index);
      if (!byId.has(id)) byId.set(id, index);
      return {
        id,
        index,
        priority: asNumber(properties[fields.priority]),
        cost: asNumber(properties[fields.cost]),
        benefit: asNumber(properties[fields.benefit]),
        // Unbound is not the same as false. Without the column every unit is
        // considered; with it, only those the column says yes to.
        eligible: fields.eligible ? truthy(properties[fields.eligible]) : null,
        point: representativePoint(feature.geometry),
      };
    });

    if (!units.length) throw new Error('The units input carried no features.');
    if (byId.size !== units.length) {
      const duplicates = units.length - byId.size;
      warnings.push(
        `The identifier column is not unique — ${duplicates} duplicate value${duplicates === 1 ? '' : 's'}. Selections will reach only the first row of each.`,
      );
    }

    const instance = new PhasedAllocationInstance(units, byId, warnings);
    if (parameters && Object.keys(parameters).length) await instance.setParameters(parameters);
    return instance;
  },
};
