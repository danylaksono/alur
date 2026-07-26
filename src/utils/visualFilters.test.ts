import { describe, expect, it } from 'vitest';
import { defaultFilterForField, isVisualFilterValid, visualFilterKey, visualFilterLabel } from './visualFilters';

describe('visual filter utilities', () => {
  it('builds stable keys that distinguish null and exclusion semantics', () => {
    expect(visualFilterKey({ kind: 'range', field: 'score', min: 0, max: 10 }))
      .not.toBe(visualFilterKey({ kind: 'range', field: 'score', min: 0, max: 10, includeNull: true }));
    expect(visualFilterKey({ kind: 'category', field: 'status', values: ['open'] }))
      .not.toBe(visualFilterKey({ kind: 'category', field: 'status', values: ['open'], mode: 'exclude' }));
  });

  it('creates concise labels for typed filters', () => {
    expect(visualFilterLabel({ kind: 'text', field: 'name', operator: 'starts_with', value: 'King' }))
      .toBe('name starts with: King');
    expect(visualFilterLabel({ kind: 'boolean', field: 'active', value: false, mode: 'exclude' }))
      .toBe('Exclude active: false');
  });

  it('validates partial editor values without accepting empty filters', () => {
    expect(isVisualFilterValid({ kind: 'category', field: 'status', values: [] })).toBe(false);
    expect(isVisualFilterValid({ kind: 'range', field: 'score', min: Number.NaN })).toBe(false);
    expect(isVisualFilterValid({ kind: 'text', field: 'name', operator: 'contains', value: '  ' })).toBe(false);
    expect(isVisualFilterValid({ kind: 'null', field: 'score', isNull: true })).toBe(true);
  });

  it('selects an editor-friendly default from field semantics', () => {
    expect(defaultFilterForField({ name: 'amount', type: 'DOUBLE', semanticType: 'numeric' }))
      .toEqual({ kind: 'range', field: 'amount' });
    expect(defaultFilterForField({ name: 'active', type: 'BOOLEAN', semanticType: 'boolean' }))
      .toEqual({ kind: 'boolean', field: 'active', value: true });
  });
});
