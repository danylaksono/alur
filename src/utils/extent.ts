/**
 * Min/max over an array of unknown length.
 *
 * `Math.min(...values)` passes every element as a separate argument and
 * overflows the call stack somewhere around 125k of them — which a city-scale
 * layer, or the coordinate list of a few hundred polygons, reaches easily. Use
 * this wherever the array size is driven by the data rather than by a fixed
 * bin, category or top-N count.
 *
 * Returns `Infinity`/`-Infinity` for an empty array, matching `Math.min()`.
 */
export const numericExtent = (values: ArrayLike<number>) => {
  let min = Infinity;
  let max = -Infinity;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
};

/** Bounding box of `[x, y]` pairs as `[[west, south], [east, north]]`. */
export const coordinateExtent = (coordinates: Array<[number, number] | number[]>) => {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [x, y] of coordinates) {
    if (x < west) west = x;
    if (x > east) east = x;
    if (y < south) south = y;
    if (y > north) north = y;
  }
  return [[west, south], [east, north]] as [[number, number], [number, number]];
};
