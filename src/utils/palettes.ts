export type Palette = {
  id: string;
  name: string;
  colors: string[];
};

export const SEQUENTIAL_PALETTES: Palette[] = [
  {
    id: 'teal',
    name: 'Teal',
    colors: ['#ecfeff', '#a5f3fc', '#22d3ee', '#0891b2', '#155e75'],
  },
  {
    id: 'magma',
    name: 'Magma',
    colors: ['#fef3c7', '#f59e0b', '#e11d48', '#7e22ce', '#312e81'],
  },
  {
    id: 'forest',
    name: 'Forest',
    colors: ['#f0fdf4', '#bbf7d0', '#4ade80', '#16a34a', '#14532d'],
  },
  {
    id: 'civic',
    name: 'Civic',
    colors: ['#eff6ff', '#bfdbfe', '#60a5fa', '#2563eb', '#1e3a8a'],
  },
];

export const CATEGORICAL_PALETTE = [
  '#2563eb',
  '#059669',
  '#d97706',
  '#dc2626',
  '#7c3aed',
  '#0891b2',
  '#be123c',
  '#4d7c0f',
  '#9333ea',
  '#0f766e',
];

/**
 * 3×3 bivariate palettes, row-major: rows = field Y classes (low→high),
 * columns = field X classes (low→high). After Joshua Stevens' bivariate sets.
 */
export const BIVARIATE_PALETTES: Palette[] = [
  {
    id: 'teal-purple',
    name: 'Teal · Purple',
    colors: [
      '#e8e8e8', '#ace4e4', '#5ac8c8',
      '#dfb0d6', '#a5add3', '#5698b9',
      '#be64ac', '#8c62aa', '#3b4994',
    ],
  },
  {
    id: 'blue-red',
    name: 'Blue · Red',
    colors: [
      '#e8e8e8', '#b0d5df', '#64acbe',
      '#e4acac', '#ad9ea5', '#627f8c',
      '#c85a5a', '#985356', '#574249',
    ],
  },
];

export const getPalette = (id: string, fallback = SEQUENTIAL_PALETTES[0]) =>
  SEQUENTIAL_PALETTES.find((palette) => palette.id === id) || fallback;

export const getBivariatePalette = (id: string, fallback = BIVARIATE_PALETTES[0]) =>
  BIVARIATE_PALETTES.find((palette) => palette.id === id) || fallback;

export const fitPaletteToClassCount = (palette: string[], classCount: number) => {
  if (classCount <= palette.length) return palette.slice(0, classCount);
  return Array.from({ length: classCount }, (_, index) => palette[index % palette.length]);
};
