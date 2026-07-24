import { describe, expect, it } from 'vitest';
import { compileVisualFiltersWhereClause } from './visualFilterSql';

describe('visual filter SQL compiler', () => {
  it('compiles category filters with escaped values', () => {
    expect(compileVisualFiltersWhereClause([
      { kind: 'category', field: 'borough', values: ['Camden', "King's Cross"] },
    ])).toBe('WHERE (CAST("borough" AS VARCHAR) = \'Camden\' OR CAST("borough" AS VARCHAR) = \'King\'\'s Cross\')');
  });

  it('compiles range filters with null inclusion', () => {
    expect(compileVisualFiltersWhereClause([
      { kind: 'range', field: 'need', min: 10, max: 20, includeNull: true },
    ])).toBe('WHERE ((CAST("need" AS DOUBLE) >= 10 AND CAST("need" AS DOUBLE) <= 20) OR "need" IS NULL)');
  });

  it('compiles temporal filters', () => {
    expect(compileVisualFiltersWhereClause([
      { kind: 'temporal', field: 'created_at', start: '2026-01-01', end: '2026-01-31' },
    ])).toBe('WHERE (TRY_CAST("created_at" AS TIMESTAMP) >= TRY_CAST(\'2026-01-01\' AS TIMESTAMP) AND TRY_CAST("created_at" AS TIMESTAMP) <= TRY_CAST(\'2026-01-31\' AS TIMESTAMP))');
  });

  it('compiles case-insensitive text and boolean filters', () => {
    expect(compileVisualFiltersWhereClause([
      { kind: 'text', field: 'name', operator: 'contains', value: "King's", caseSensitive: false },
      { kind: 'boolean', field: 'active', value: true },
    ])).toBe('WHERE contains(lower(CAST("name" AS VARCHAR)), \'king\'\'s\') AND TRY_CAST("active" AS BOOLEAN) IS TRUE');
  });

  it('compiles exclusion with deterministic null behaviour', () => {
    expect(compileVisualFiltersWhereClause([
      { kind: 'category', field: 'status', values: ['closed'], mode: 'exclude' },
    ])).toBe('WHERE (NOT COALESCE((CAST("status" AS VARCHAR) = \'closed\'), FALSE))');
  });

  it('compiles explicit null filters', () => {
    expect(compileVisualFiltersWhereClause([
      { kind: 'null', field: 'score', isNull: false },
    ])).toBe('WHERE "score" IS NOT NULL');
  });
});
