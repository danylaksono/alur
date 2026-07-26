export type Palette = {
  id: string;
  name: string;
  colors: string[];
  colorBlindSafe: boolean;
  description: string;
};

export const SEQUENTIAL_PALETTES: Palette[] = [
  {
    id: 'teal',
    name: 'Teal',
    colors: ['#ecfeff', '#a5f3fc', '#22d3ee', '#0891b2', '#155e75'],
    colorBlindSafe: true,
    description: 'Light-to-dark cyan for ordered values.',
  },
  {
    id: 'magma',
    name: 'Magma',
    colors: ['#fef3c7', '#f59e0b', '#e11d48', '#7e22ce', '#312e81'],
    colorBlindSafe: true,
    description: 'High-contrast warm-to-cool sequential scale.',
  },
  {
    id: 'forest',
    name: 'Forest',
    colors: ['#f0fdf4', '#bbf7d0', '#4ade80', '#16a34a', '#14532d'],
    colorBlindSafe: true,
    description: 'Light-to-dark green for ordered values.',
  },
  {
    id: 'civic',
    name: 'Civic',
    colors: ['#eff6ff', '#bfdbfe', '#60a5fa', '#2563eb', '#1e3a8a'],
    colorBlindSafe: true,
    description: 'Light-to-dark blue for ordered values.',
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

export const CATEGORICAL_PALETTE_META: Palette = {
  id: 'categorical',
  name: 'Categorical',
  colors: CATEGORICAL_PALETTE,
  colorBlindSafe: false,
  description: 'Distinct hues for nominal categories; pair with labels for accessibility.',
};

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
    colorBlindSafe: true,
    description: 'Nine-class teal and purple bivariate scale.',
  },
  {
    id: 'blue-red',
    name: 'Blue · Red',
    colors: [
      '#e8e8e8', '#b0d5df', '#64acbe',
      '#e4acac', '#ad9ea5', '#627f8c',
      '#c85a5a', '#985356', '#574249',
    ],
    colorBlindSafe: false,
    description: 'Nine-class blue and red bivariate scale.',
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

const linearChannel = (value: number) => {
  const channel = value / 255;
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
};

export const colourContrastRatio = (first: string, second: string) => {
  const luminance = (hex: string) => {
    const cleaned = hex.replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(cleaned)) return 0;
    const [r, g, b] = [0, 2, 4].map((offset) => linearChannel(Number.parseInt(cleaned.slice(offset, offset + 2), 16)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
};

export const paletteWarnings = (palette: Palette, categoryCount: number) => {
  const warnings: string[] = [];
  if (!palette.colorBlindSafe) warnings.push('This palette needs labels or another non-colour cue.');
  if (categoryCount > 8) warnings.push(`${categoryCount} categories may be difficult to distinguish.`);
  const visible = palette.colors.slice(0, Math.max(0, categoryCount));
  if (visible.some((color, index) => index > 0 && colourContrastRatio(visible[index - 1], color) < 1.25)) {
    warnings.push('Some adjacent colours have low visual contrast.');
  }
  return warnings;
};

export const paletteMetadataForColors = (colors: string[], categoryCount = colors.length) => {
  const candidates = [CATEGORICAL_PALETTE_META, ...SEQUENTIAL_PALETTES, ...BIVARIATE_PALETTES];
  const palette = candidates.find((candidate) => colors.every((color, index) => candidate.colors[index] === color)) || {
    id: 'custom', name: 'Custom', colors, colorBlindSafe: false, description: 'Custom colour palette.',
  };
  return { name: palette.name, colorBlindSafe: palette.colorBlindSafe, warnings: paletteWarnings(palette, categoryCount) };
};
