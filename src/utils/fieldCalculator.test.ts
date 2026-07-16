import { describe, expect, it } from 'vitest';
import {
  applyComputedFields,
  parseExpression,
  profileComputedColumn,
  validateComputedField,
  type ComputedField,
} from './fieldCalculator';

describe('fieldCalculator', () => {
  it('parses and applies arithmetic, conditionals, and field dependencies', () => {
    const fields: ComputedField[] = [
      { id: 'density', name: 'density', expression: 'population / area' },
      { id: 'priority', name: 'priority', expression: "if(density >= 20 and kind == 'urban', 1, 0)" },
    ];
    const rows = applyComputedFields([
      { population: 120, area: 4, kind: 'urban' },
      { population: 10, area: 0, kind: 'rural' },
    ], fields);

    expect(rows[0]).toMatchObject({ density: 30, priority: 1 });
    expect(rows[1]).toMatchObject({ density: null, priority: 0 });
  });

  it('rejects unsafe syntax and validates duplicate names', () => {
    expect(parseExpression('population; DROP TABLE data').error).toContain('Unexpected character');
    const validation = validateComputedField(
      { name: 'population', expression: 'area * 2' },
      ['population', 'area'],
      [],
    );
    expect(validation.ok).toBe(false);
    expect(validation.errors[0]).toContain('already exists');
  });

  it('profiles calculated numeric values for the inline histogram', () => {
    const profile = profileComputedColumn('score', [
      { score: 1 },
      { score: 2 },
      { score: 3 },
      { score: null },
    ]);

    expect(profile.kind).toBe('numeric');
    expect(profile.nullCount).toBe(1);
    expect(profile.bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(3);
  });
});
