import { describe, expect, it } from 'vitest';
import { binIndexFor, sliceCube, type ChartCube } from './chartCubeService';

describe('binIndexFor', () => {
  it('places a value in the bin the SQL would have put it in', () => {
    // 4 bins over [0, 100): boundaries at 25, 50, 75.
    expect(binIndexFor(0, 0, 100, 4)).toBe(0);
    expect(binIndexFor(24.9, 0, 100, 4)).toBe(0);
    expect(binIndexFor(25, 0, 100, 4)).toBe(1);
    expect(binIndexFor(99.9, 0, 100, 4)).toBe(3);
  });

  it('clamps rather than escaping the array', () => {
    expect(binIndexFor(-50, 0, 100, 4)).toBe(0);
    expect(binIndexFor(1000, 0, 100, 4)).toBe(3);
    // The top of the range belongs to the last bin, not a fifth one.
    expect(binIndexFor(100, 0, 100, 4)).toBe(3);
  });

  it('survives a degenerate extent', () => {
    expect(binIndexFor(5, 5, 5, 4)).toBe(0);
  });
});

describe('sliceCube', () => {
  // 3 active bins x 2 passive bins, active field spanning [0, 30).
  const cube: ChartCube = {
    activeChartId: 'a',
    passiveChartId: 'b',
    activeBins: 3,
    passiveBins: 2,
    activeMin: 0,
    activeMax: 30,
    counts: Uint32Array.from([
      1, 2, // active bin 0
      10, 20, // active bin 1
      100, 200, // active bin 2
    ]),
  };

  it('sums only the brushed columns', () => {
    expect(sliceCube(cube, 0, 9)).toEqual([1, 2]);
    expect(sliceCube(cube, 10, 19)).toEqual([10, 20]);
    expect(sliceCube(cube, 20, 29)).toEqual([100, 200]);
  });

  it('adds the bins a wider brush covers', () => {
    expect(sliceCube(cube, 0, 19)).toEqual([11, 22]);
    expect(sliceCube(cube, 0, 29)).toEqual([111, 222]);
  });

  it('does not care which way the brush was dragged', () => {
    expect(sliceCube(cube, 29, 0)).toEqual(sliceCube(cube, 0, 29));
  });

  it('totals the whole cube when the brush covers everything', () => {
    const total = sliceCube(cube, -100, 100);
    expect(total).toEqual([111, 222]);
    // Which is the same as summing the raw counts, so nothing is lost.
    const raw = Array.from(cube.counts).reduce((sum, value) => sum + value, 0);
    expect(total[0] + total[1]).toBe(raw);
  });
});
