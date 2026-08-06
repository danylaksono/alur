import { describe, it, expect } from 'vitest';
import { resolutionForCellSize } from './hexbinService';

// Average H3 cell edge length in metres per resolution, as the engine reports
// it. Kept here only as test input — the service asks DuckDB for these.
const EDGES = [
  1281256.011, 483056.8391, 182512.9565, 68979.22179, 26071.75968, 9854.090990,
  3724.532667, 1406.475763, 531.4140558, 200.7867445, 75.86378287, 28.66315720,
  10.83086944, 4.092010473, 1.546099657, 0.584169303,
];

describe('resolutionForCellSize', () => {
  it('picks the resolution whose cells are nearest the requested size', () => {
    expect(resolutionForCellSize(531, EDGES)).toBe(8);
    expect(resolutionForCellSize(1406, EDGES)).toBe(7);
    expect(resolutionForCellSize(200, EDGES)).toBe(9);
  });

  it('never maps a larger requested cell onto a finer grid', () => {
    const offered = [5000, 2000, 1000, 500, 250, 100];
    const chosen = offered.map((size) => resolutionForCellSize(size, EDGES));
    expect(chosen).toEqual([...chosen].sort((a, b) => a - b));
  });

  it('collapses neighbouring cell sizes onto one resolution, which the caller must surface', () => {
    // H3 resolutions step by a factor of about 2.6, so the panel's 2km and 1km
    // options genuinely produce the same grid. This is a property of H3, not a
    // bug to fix here — but it has to be reported rather than hidden, which is
    // why generateHexbins returns the edge length actually used.
    expect(resolutionForCellSize(2000, EDGES)).toBe(resolutionForCellSize(1000, EDGES));
    expect(resolutionForCellSize(5000, EDGES)).not.toBe(resolutionForCellSize(2000, EDGES));
  });

  it('compares in log space so the coarse end does not swamp small sizes', () => {
    // On a linear scale resolution 0 is ~1,281km wide, so every size under a
    // few hundred kilometres would sit closer to it than to anything else.
    expect(resolutionForCellSize(100, EDGES)).toBeGreaterThan(8);
    expect(resolutionForCellSize(10, EDGES)).toBeGreaterThan(11);
  });

  it('clamps to the coarsest and finest the grid offers', () => {
    expect(resolutionForCellSize(50_000_000, EDGES)).toBe(0);
    expect(resolutionForCellSize(0.001, EDGES)).toBe(15);
  });

  it('falls back to a usable resolution when the engine gave nothing', () => {
    expect(resolutionForCellSize(1000, [])).toBe(8);
  });

  it('ignores unusable edge lengths rather than selecting them', () => {
    expect(resolutionForCellSize(1000, [NaN, 0, 1406.475763, -5])).toBe(2);
  });
});
