import { describe, expect, it } from 'vitest';
import type { OperationChange, OperationInputData } from '../../types/operations';
import { phasedAllocation } from './phasedAllocation';

/**
 * Spending a budget down a ranked list.
 *
 * The assertions are about the four things that make this a planning tool rather
 * than a running total: money carries forward, yield ramps, an analyst can
 * overrule the ranking, and the result can be forced apart in space. Each one is
 * a place where the answer for a row depends on answers already given.
 */

const KM = 1 / 111.32;

const units = (rows: Array<{ id: string; priority: number; cost: number; benefit: number; lon?: number; eligible?: unknown }>) => ({
  type: 'FeatureCollection' as const,
  features: rows.map((row, index) => ({
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: [row.lon ?? index * 10 * KM, 0] },
    properties: {
      uid: row.id,
      rank: row.priority,
      price: row.cost,
      yield_pa: row.benefit,
      ...(row.eligible === undefined ? {} : { ok: row.eligible }),
    },
  })),
});

const input = (collection: GeoJSON.FeatureCollection, withEligibility = false): OperationInputData => ({
  inputId: 'units',
  fields: {
    id: 'uid',
    priority: 'rank',
    cost: 'price',
    benefit: 'yield_pa',
    ...(withEligibility ? { eligible: 'ok' } : {}),
  },
  geojson: JSON.stringify(collection),
});

const change = (changeId: string, rowIds: string[], sequence: number, values: Record<string, unknown> = {}): OperationChange => ({
  id: `op-${sequence}`,
  changeId,
  sequence,
  target: { kind: 'rows', datasetId: 'd1', rowIds },
  values,
});

const run = async (
  collection: GeoJSON.FeatureCollection,
  parameters: Record<string, unknown>,
  changes: OperationChange[] = [],
  withEligibility = false,
) => {
  const instance = await phasedAllocation.create({ inputs: [input(collection, withEligibility)], parameters });
  if (changes.length) await instance.setChanges!(changes);
  const result = await instance.evaluate();
  const rows = (result.outputs.allocation as { kind: 'join'; rows: Array<Record<string, unknown>> }).rows;
  const byId = new Map(rows.map((row) => [String(row.key), row]));
  const trajectory = (result.outputs.trajectory as { kind: 'dataset'; geojson: GeoJSON.FeatureCollection }).geojson;
  instance.dispose?.();
  return { rows, byId, trajectory, warnings: result.warnings ?? [] };
};

/** Three units of equal cost, ranked 3 > 2 > 1. */
const three = units([
  { id: 'a', priority: 3, cost: 100, benefit: 10 },
  { id: 'b', priority: 2, cost: 100, benefit: 10 },
  { id: 'c', priority: 1, cost: 100, benefit: 10 },
]);

describe('spending a recurring budget', () => {
  it('takes what the year affords, in rank order, and leaves the rest', async () => {
    const { byId } = await run(three, { startYear: 1, endYear: 1, annualBudget: 100, carryUnspent: 'no' });
    expect(byId.get('a')!.committed).toBe(true);
    expect(byId.get('b')!.committed).toBe(false);
    expect(byId.get('c')!.committed).toBe(false);
  });

  it('spreads across years rather than stopping at the first', async () => {
    const { byId } = await run(three, { startYear: 1, endYear: 3, annualBudget: 100, carryUnspent: 'no' });
    expect(byId.get('a')!.committed_year).toBe(1);
    expect(byId.get('b')!.committed_year).toBe(2);
    expect(byId.get('c')!.committed_year).toBe(3);
  });

  it('carries unspent budget forward, which is what makes it more than a running total', async () => {
    // 60/year against a cost of 100: nothing is affordable in year 1 alone, and
    // only the carry makes year 2 possible.
    const carried = await run(three, { startYear: 1, endYear: 2, annualBudget: 60, carryUnspent: 'yes' });
    expect(carried.byId.get('a')!.committed_year).toBe(2);

    const spent = await run(three, { startYear: 1, endYear: 2, annualBudget: 60, carryUnspent: 'no' });
    expect(spent.byId.get('a')!.committed).toBe(false);
  });

  it('takes the lower priority value first when asked to', async () => {
    const { byId } = await run(three, { startYear: 1, endYear: 1, annualBudget: 100, priorityDirection: 'lower' });
    expect(byId.get('c')!.committed).toBe(true);
    expect(byId.get('a')!.committed).toBe(false);
  });

  it('reports nothing rather than zero for a unit never committed', async () => {
    // Zero would read on a map as "taken, at no cost, for no return".
    const { byId } = await run(three, { startYear: 1, endYear: 1, annualBudget: 100 });
    const missed = byId.get('c')!;
    expect(missed.committed_year).toBeNull();
    expect(missed.spend).toBeNull();
    expect(missed.cumulative_benefit).toBeNull();
  });

  it('refuses a year range that runs backwards', async () => {
    await expect(run(three, { startYear: 5, endYear: 2 })).rejects.toThrow(/last year/i);
  });
});

describe('the ramp', () => {
  it('pays a fraction in the year of commitment and the whole yield once matured', async () => {
    const one = units([{ id: 'a', priority: 1, cost: 10, benefit: 100 }]);
    const { byId } = await run(one, { startYear: 1, endYear: 4, annualBudget: 10, rampYears: 4 });
    // Committed in year 1 with a 4-year ramp: 25 + 50 + 75 + 100.
    expect(byId.get('a')!.cumulative_benefit).toBeCloseTo(250, 6);
  });

  it('pays in full from the first year when there is no ramp', async () => {
    const one = units([{ id: 'a', priority: 1, cost: 10, benefit: 100 }]);
    const { byId } = await run(one, { startYear: 1, endYear: 3, annualBudget: 10, rampYears: 1 });
    expect(byId.get('a')!.cumulative_benefit).toBeCloseTo(300, 6);
  });

  it('records a row per unit per year, with spend only in the year of commitment', async () => {
    const one = units([{ id: 'a', priority: 1, cost: 10, benefit: 100 }]);
    const { trajectory } = await run(one, { startYear: 1, endYear: 3, annualBudget: 10 });
    const years = trajectory.features.map((feature) => feature.properties!);
    expect(years).toHaveLength(3);
    expect(years.map((row) => row.spend)).toEqual([10, 0, 0]);
    expect(years.map((row) => row.committed_this_year)).toEqual([true, false, false]);
  });
});

describe('eligibility', () => {
  it('considers every unit when no flag is bound', async () => {
    const { byId } = await run(three, { startYear: 1, endYear: 1, annualBudget: 100 });
    expect(byId.get('a')!.committed).toBe(true);
  });

  it('skips units the bound flag says no to, however they spell it', async () => {
    const mixed = units([
      { id: 'a', priority: 3, cost: 100, benefit: 10, eligible: 'no' },
      { id: 'b', priority: 2, cost: 100, benefit: 10, eligible: 'TRUE' },
      { id: 'c', priority: 1, cost: 100, benefit: 10, eligible: 1 },
    ]);
    const { byId } = await run(mixed, { startYear: 1, endYear: 1, annualBudget: 100 }, [], true);
    expect(byId.get('a')!.committed).toBe(false);
    expect(byId.get('b')!.committed).toBe(true);
  });
});

describe('what the analyst asserts', () => {
  it('puts a committed unit ahead of everything ranked above it', async () => {
    const { byId } = await run(three, { startYear: 1, endYear: 1, annualBudget: 100 }, [
      change('commit', ['c'], 1, { year: 1 }),
    ]);
    expect(byId.get('c')!.committed).toBe(true);
    expect(byId.get('a')!.committed).toBe(false);
  });

  it('honours the year a commitment is pinned to', async () => {
    const { byId } = await run(three, { startYear: 1, endYear: 3, annualBudget: 100 }, [
      change('commit', ['c'], 1, { year: 3 }),
    ]);
    expect(byId.get('c')!.committed_year).toBe(3);
  });

  it('overrides eligibility, because a column saying "no" is an input the analyst may overrule', async () => {
    const barred = units([{ id: 'a', priority: 1, cost: 10, benefit: 5, eligible: 'no' }]);
    const { byId } = await run(barred, { startYear: 1, endYear: 1, annualBudget: 100 }, [
      change('commit', ['a'], 1, { year: 1 }),
    ], true);
    expect(byId.get('a')!.committed).toBe(true);
  });

  it('does not override affordability, and says so rather than overspending', async () => {
    const dear = units([{ id: 'a', priority: 1, cost: 5000, benefit: 5 }]);
    const { byId, warnings } = await run(dear, { startYear: 1, endYear: 1, annualBudget: 100 }, [
      change('commit', ['a'], 1, { year: 1 }),
    ]);
    expect(byId.get('a')!.committed).toBe(false);
    expect(warnings.join(' ')).toMatch(/could not be afforded/);
  });

  it('warns when a commitment is pinned outside the run', async () => {
    const { warnings } = await run(three, { startYear: 1, endYear: 3, annualBudget: 100 }, [
      change('commit', ['a'], 1, { year: 9 }),
    ]);
    expect(warnings.join(' ')).toMatch(/pinned to a year outside 1–3/);
  });

  it('takes a ruled-out unit off the table', async () => {
    const { byId } = await run(three, { startYear: 1, endYear: 1, annualBudget: 100 }, [
      change('exclude', ['a'], 1),
    ]);
    expect(byId.get('a')!.committed).toBe(false);
    expect(byId.get('b')!.committed).toBe(true);
  });

  it('lets the later record win, in both directions', async () => {
    // The contract guarantees an ordered list. If exclusion and commitment were
    // held apart, these two would give the same answer and that ordering would
    // be a fiction.
    const committedLast = await run(three, { startYear: 1, endYear: 1, annualBudget: 100 }, [
      change('exclude', ['c'], 1),
      change('commit', ['c'], 2, { year: 1 }),
    ]);
    expect(committedLast.byId.get('c')!.committed).toBe(true);

    const excludedLast = await run(three, { startYear: 1, endYear: 1, annualBudget: 100 }, [
      change('commit', ['c'], 1, { year: 1 }),
      change('exclude', ['c'], 2),
    ]);
    expect(excludedLast.byId.get('c')!.committed).toBe(false);
  });

  it('rebuilds state from the whole list, so removing a record undoes exactly it', async () => {
    const withChange = await run(three, { startYear: 1, endYear: 1, annualBudget: 100 }, [
      change('exclude', ['a'], 1),
    ]);
    const without = await run(three, { startYear: 1, endYear: 1, annualBudget: 100 }, []);
    expect(withChange.byId.get('a')!.committed).toBe(false);
    expect(without.byId.get('a')!.committed).toBe(true);
  });

  it('multiplies a revaluation into cost, so an unaffordable unit becomes affordable', async () => {
    const dear = units([{ id: 'a', priority: 1, cost: 200, benefit: 10 }]);
    const asIs = await run(dear, { startYear: 1, endYear: 1, annualBudget: 100 });
    expect(asIs.byId.get('a')!.committed).toBe(false);

    const halved = await run(dear, { startYear: 1, endYear: 1, annualBudget: 100 }, [
      change('revalue', ['a'], 1, { costFactor: 0.4, benefitFactor: 1 }),
    ]);
    expect(halved.byId.get('a')!.committed).toBe(true);
    expect(halved.byId.get('a')!.spend).toBeCloseTo(80, 6);
  });

  it('compounds revaluations, because two assertions are two adjustments', async () => {
    const one = units([{ id: 'a', priority: 1, cost: 10, benefit: 100 }]);
    const { byId } = await run(one, { startYear: 1, endYear: 1, annualBudget: 100 }, [
      change('revalue', ['a'], 1, { costFactor: 1, benefitFactor: 0.5 }),
      change('revalue', ['a'], 2, { costFactor: 1, benefitFactor: 0.5 }),
    ]);
    expect(byId.get('a')!.cumulative_benefit).toBeCloseTo(25, 6);
  });

  it('reports selected rows that match no unit rather than absorbing them', async () => {
    const { warnings } = await run(three, { startYear: 1, endYear: 1, annualBudget: 100 }, [
      change('exclude', ['a', 'nonexistent'], 1),
    ]);
    expect(warnings.join(' ')).toMatch(/1 of 2 selected rows matched no unit/);
  });
});

describe('the spacing rule', () => {
  it('skips a unit too close to one already committed', async () => {
    const close = units([
      { id: 'a', priority: 3, cost: 10, benefit: 10, lon: 0 },
      { id: 'b', priority: 2, cost: 10, benefit: 10, lon: 0.2 * KM },
      { id: 'c', priority: 1, cost: 10, benefit: 10, lon: 50 * KM },
    ]);
    const { byId } = await run(close, { startYear: 1, endYear: 1, annualBudget: 1000, minSeparationKm: 1 });
    expect(byId.get('a')!.committed).toBe(true);
    expect(byId.get('b')!.committed).toBe(false);
    expect(byId.get('c')!.committed).toBe(true);
  });

  it('takes everything affordable when the rule is off', async () => {
    const close = units([
      { id: 'a', priority: 3, cost: 10, benefit: 10, lon: 0 },
      { id: 'b', priority: 2, cost: 10, benefit: 10, lon: 0.2 * KM },
    ]);
    const { rows } = await run(close, { startYear: 1, endYear: 1, annualBudget: 1000, minSeparationKm: 0 });
    expect(rows.every((row) => row.committed)).toBe(true);
  });
});
