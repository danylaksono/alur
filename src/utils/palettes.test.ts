import { describe, expect, it } from 'vitest';
import { CATEGORICAL_PALETTE_META, SEQUENTIAL_PALETTES, colourContrastRatio, paletteMetadataForColors, paletteWarnings } from './palettes';

describe('palette metadata', () => {
  it('calculates symmetric WCAG-style luminance contrast', () => {
    expect(colourContrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(colourContrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
  });

  it('warns when categorical colour alone or excessive classes reduce legibility', () => {
    expect(paletteWarnings(CATEGORICAL_PALETTE_META, 10)).toEqual(expect.arrayContaining([
      'This palette needs labels or another non-colour cue.',
      '10 categories may be difficult to distinguish.',
    ]));
  });

  it('recognises curated palette metadata from its colours', () => {
    expect(paletteMetadataForColors(SEQUENTIAL_PALETTES[0].colors)).toMatchObject({ name: 'Teal', colorBlindSafe: true });
  });
});
