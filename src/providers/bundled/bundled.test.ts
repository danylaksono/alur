import { describe, expect, it } from 'vitest';
import { operationManifestErrors } from '../../types/operations';
import type { OperationChange, OperationInputData } from '../../types/operations';
import { BUNDLED_PLUGIN, BUNDLED_PROVIDERS } from '../index';
import { thinBySpacing } from './thinBySpacing';
import { nearestWithCapacity } from './nearestWithCapacity';
import { clusterByDistance } from './clusterByDistance';
import { distanceKm, representativePoint } from './geometry';

/**
 * The bundled plugin.
 *
 * Every calculation here is one SQL cannot express, so the assertions are about
 * the property that makes it so: the answer for one row depends on answers
 * already given for others.
 */

/** Degrees of longitude for a given distance at the equator, near enough. */
const KM = 1 / 111.32;

const points = (coords: Array<[number, number]>, properties: Array<Record<string, unknown>>) => ({
  type: 'FeatureCollection' as const,
  features: coords.map((position, index) => ({
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: position },
    properties: properties[index],
  })),
});

const input = (
  inputId: string,
  collection: GeoJSON.FeatureCollection,
  fields: Record<string, string>,
): OperationInputData => ({ inputId, fields, geojson: JSON.stringify(collection) });

const rowChange = (changeId: string, rowIds: string[], sequence: number, values: Record<string, unknown> = {}): OperationChange => ({
  id: `op-${sequence}`,
  changeId,
  sequence,
  target: { kind: 'rows', datasetId: 'dataset-1', rowIds },
  values,
});

describe('the bundled plugin', () => {
  it('declares every calculation it exports, and no more', () => {
    expect(BUNDLED_PLUGIN.calculations.map((calculation) => calculation.id).sort())
      .toEqual(BUNDLED_PROVIDERS.map((provider) => provider.manifest.id).sort());
  });

  it('ships only manifests ALUR would accept', () => {
    for (const provider of BUNDLED_PROVIDERS) {
      expect({ id: provider.manifest.id, errors: operationManifestErrors(provider.manifest) })
        .toEqual({ id: provider.manifest.id, errors: [] });
    }
  });

  it('gives every calculation a group, so the toolbox can be browsed', () => {
    for (const provider of BUNDLED_PROVIDERS) expect(provider.manifest.group).toBeTruthy();
  });
});

describe('representative point', () => {
  it('averages the vertices of an area, so a boundary can be treated as a place', () => {
    const square: GeoJSON.Polygon = {
      type: 'Polygon',
      coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
    };
    // 1, not 0.8: the ring's repeated closing vertex is counted once.
    const point = representativePoint(square)!;
    expect(point.lon).toBeCloseTo(1, 5);
    expect(point.lat).toBeCloseTo(1, 5);
  });

  it('returns null rather than a wrong answer when there is no geometry', () => {
    expect(representativePoint(null)).toBeNull();
  });
});

describe('thin by minimum spacing', () => {
  // Four points in a line, 1 km apart, with priority decreasing left to right.
  const collection = points(
    [[0, 0], [KM, 0], [2 * KM, 0], [3 * KM, 0]],
    [{ id: 'a', score: 4 }, { id: 'b', score: 3 }, { id: 'c', score: 2 }, { id: 'd', score: 1 }],
  );
  const inputs = [input('units', collection, { id: 'id', priority: 'score' })];

  const run = async (parameters: Record<string, unknown>, changes: OperationChange[] = []) => {
    const instance = await thinBySpacing.create({ inputs, parameters });
    await instance.setChanges(changes);
    const result = await instance.evaluate();
    instance.dispose();
    return result.outputs.selection as { kind: 'join'; rows: Array<Record<string, unknown>> };
  };

  it('keeps everything when the spacing rule is off', async () => {
    const { rows } = await run({ minSpacingKm: 0 });
    expect(rows.every((row) => row.kept)).toBe(true);
  });

  it('drops what sits inside the spacing of something already kept', async () => {
    // 1.5 km spacing over points 1 km apart: a, then b is too close, then c.
    const { rows } = await run({ minSpacingKm: 1.5 });
    expect(rows.map((row) => row.kept)).toEqual([true, false, true, false]);
  });

  it('names what displaced a dropped candidate', async () => {
    const { rows } = await run({ minSpacingKm: 1.5 });
    expect(rows[1].displaced_by).toBe('a');
  });

  it('reverses which survive when the ranking direction reverses', async () => {
    // The property that makes this sequential: the answer is a function of the
    // order, not of any per-row predicate.
    const { rows } = await run({ minSpacingKm: 1.5, direction: 'lower' });
    expect(rows.map((row) => row.kept)).toEqual([false, true, false, true]);
  });

  it('takes a forced keep before the ranking, displacing the better-ranked', async () => {
    const { rows } = await run({ minSpacingKm: 1.5 }, [rowChange('keep', ['b'], 0)]);
    expect(rows.map((row) => row.kept)).toEqual([false, true, false, true]);
    expect(rows[0].displaced_by).toBe('b');
  });

  it('lets a later record overrule an earlier one about the same unit', async () => {
    const kept = await run({ minSpacingKm: 0 }, [rowChange('drop', ['a'], 0), rowChange('keep', ['a'], 1)]);
    const dropped = await run({ minSpacingKm: 0 }, [rowChange('keep', ['a'], 0), rowChange('drop', ['a'], 1)]);
    expect(kept.rows[0].kept).toBe(true);
    expect(dropped.rows[0].kept).toBe(false);
  });

  it('stops at the limit and says it stopped early', async () => {
    const instance = await thinBySpacing.create({ inputs, parameters: { minSpacingKm: 0, limit: 2 } });
    await instance.setChanges([]);
    const result = await instance.evaluate();
    const rows = (result.outputs.selection as { rows: Array<Record<string, unknown>> }).rows;
    expect(rows.filter((row) => row.kept)).toHaveLength(2);
    expect(result.warnings?.[0]).toContain('Stopped after keeping 2');
  });

  it('reports no spacing rather than zero for the first unit kept', async () => {
    // Zero would read on a map as the worst possible spacing, when in fact
    // there was nothing to measure against.
    const { rows } = await run({ minSpacingKm: 1.5 });
    expect(rows[0].nearest_kept_km).toBeNull();
  });
});

describe('assign to nearest with capacity', () => {
  // Two sites at either end, four demand units strung between them.
  const demand = points(
    [[0, 0], [KM, 0], [2 * KM, 0], [3 * KM, 0]],
    [{ id: 'd1', people: 10 }, { id: 'd2', people: 10 }, { id: 'd3', people: 10 }, { id: 'd4', people: 10 }],
  );
  const supply = points([[0, 0], [3 * KM, 0]], [{ id: 's1', places: 20 }, { id: 's2', places: 20 }]);

  const inputs = [
    input('demand', demand, { id: 'id', weight: 'people' }),
    input('supply', supply, { id: 'id', capacity: 'places' }),
  ];

  const run = async (parameters: Record<string, unknown> = {}, changes: OperationChange[] = []) => {
    const instance = await nearestWithCapacity.create({ inputs, parameters });
    await instance.setChanges(changes);
    const result = await instance.evaluate();
    instance.dispose();
    return {
      assignment: (result.outputs.assignment as { rows: Array<Record<string, unknown>> }).rows,
      load: (result.outputs.load as { rows: Array<Record<string, unknown>> }).rows,
      warnings: result.warnings ?? [],
    };
  };

  it('sends each unit to its nearest site while there is room', async () => {
    const { assignment } = await run();
    expect(assignment.map((row) => row.assigned_to)).toEqual(['s1', 's1', 's2', 's2']);
  });

  it('never exceeds a site’s capacity', async () => {
    // The whole reason this is not a spatial join: a join would put all four
    // nearest-matches on whichever site won and report a plausible, wrong answer.
    const { load } = await run();
    for (const row of load) expect(row.assigned as number).toBeLessThanOrEqual(row.capacity as number);
  });

  it('spills to the next nearest and counts what it passed over', async () => {
    // Halving the first site leaves room for one unit, so the second has to pass
    // over its nearest — which is the behaviour a spatial join cannot produce.
    const { assignment } = await run({}, [rowChange('resize-supply', ['s1'], 0, { factor: 0.5 })]);
    expect(assignment[0].assigned_to).toBe('s1');
    expect(assignment[1].assigned_to).toBe('s2');
    expect(assignment[1].passed_over).toBe(1);
  });

  it('leaves demand unserved rather than overfilling, and says so', async () => {
    const { assignment, warnings } = await run({}, [rowChange('close-supply', ['s2'], 0)]);
    expect(assignment.filter((row) => row.served)).toHaveLength(2);
    expect(warnings.join(' ')).toContain('could not be served');
  });

  it('honours a maximum distance', async () => {
    const { assignment } = await run({ maxDistanceKm: 0.5 });
    expect(assignment.map((row) => row.served)).toEqual([true, false, false, true]);
  });

  it('takes a supply point placed on the map', async () => {
    const place: OperationChange = {
      id: 'op-place', changeId: 'add-supply', sequence: 0,
      target: { kind: 'geometry', geometry: { type: 'Point', coordinates: [1.5 * KM, 0] } },
      values: { capacity: 40 },
    };
    const { assignment } = await run({}, [rowChange('close-supply', ['s1'], 1), place]);
    expect(assignment.filter((row) => row.assigned_to?.toString().startsWith('placed:'))).not.toHaveLength(0);
  });

  it('lets a resize reopen a site closed earlier in the list', async () => {
    const { load } = await run({}, [rowChange('close-supply', ['s1'], 0), rowChange('resize-supply', ['s1'], 1, { factor: 1 })]);
    expect(load.find((row) => row.key === 's1')!.capacity).toBe(20);
  });

  it('warns before running when capacity cannot cover demand', async () => {
    const short = [
      input('demand', demand, { id: 'id', weight: 'people' }),
      input('supply', points([[0, 0]], [{ id: 's1', places: 5 }]), { id: 'id', capacity: 'places' }),
    ];
    const instance = await nearestWithCapacity.create({ inputs: short, parameters: {} });
    await instance.setChanges([]);
    const result = await instance.evaluate();
    expect(result.warnings?.join(' ')).toContain('below total demand');
  });
});

describe('cluster by distance', () => {
  // Two tight groups of four, far apart, plus one isolated point between them.
  const collection = points(
    [
      [0, 0], [0.1 * KM, 0], [0.2 * KM, 0], [0.1 * KM, 0.1 * KM],
      [50 * KM, 0], [50.1 * KM, 0], [50.2 * KM, 0], [50.1 * KM, 0.1 * KM],
      [25 * KM, 0],
    ],
    Array.from({ length: 9 }, (_, index) => ({ id: `p${index}` })),
  );
  const inputs = [input('units', collection, { id: 'id' })];

  const run = async (parameters: Record<string, unknown>) => {
    const instance = await clusterByDistance.create({ inputs, parameters });
    await instance.setChanges([]);
    const result = await instance.evaluate();
    instance.dispose();
    return {
      rows: (result.outputs.clusters as { rows: Array<Record<string, unknown>> }).rows,
      warnings: result.warnings ?? [],
    };
  };

  it('finds the two dense groups and leaves the isolated point ungrouped', async () => {
    const { rows } = await run({ radiusKm: 1, minPoints: 4 });
    const clusters = rows.map((row) => row.cluster);
    expect(new Set(clusters.slice(0, 4)).size).toBe(1);
    expect(new Set(clusters.slice(4, 8)).size).toBe(1);
    expect(clusters[0]).not.toBe(clusters[4]);
    expect(clusters[8]).toBeNull();
  });

  it('reports an ungrouped feature as null, never as cluster zero', async () => {
    // Zero is a cluster number. An ungrouped point has no cluster at all.
    const { rows } = await run({ radiusKm: 1, minPoints: 4 });
    expect(rows[8].cluster).toBeNull();
    expect(rows[8].cluster_size).toBeNull();
  });

  it('gives every member of a cluster its size', async () => {
    const { rows } = await run({ radiusKm: 1, minPoints: 4 });
    expect(rows.slice(0, 4).map((row) => row.cluster_size)).toEqual([4, 4, 4, 4]);
  });

  it('says why nothing clustered rather than returning a silent empty result', async () => {
    const { rows, warnings } = await run({ radiusKm: 0.001, minPoints: 4 });
    expect(rows.every((row) => row.cluster === null)).toBe(true);
    expect(warnings.join(' ')).toContain('Nothing formed a cluster');
  });

  it('merges the groups once the radius reaches across the gap', async () => {
    const { rows } = await run({ radiusKm: 30, minPoints: 4 });
    expect(new Set(rows.map((row) => row.cluster)).size).toBe(1);
  });
});

describe('distance', () => {
  it('measures roughly a kilometre for a kilometre of longitude at the equator', () => {
    expect(distanceKm({ lon: 0, lat: 0 }, { lon: KM, lat: 0 })).toBeCloseTo(1, 2);
  });
});
