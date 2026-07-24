import { describe, expect, it } from 'vitest';
import { applyCohortComparisonPaint } from './mapFilterCompiler';
import type { CohortSpec } from '../types/visualAnalytics';

describe('cohort comparison map paint', () => {
  it('uses labelled cohort colours, an overlap colour, and muted remainder', () => {
    const cohorts: CohortSpec[] = [
      { id: 'a', datasetId: 'places', name: 'Urban', colour: '#0284c7', createdAt: 1, definition: { kind: 'filters', filters: [{ kind: 'category', field: 'class', values: ['urban'] }] } },
      { id: 'b', datasetId: 'places', name: 'Priority', colour: '#f97316', createdAt: 2, definition: { kind: 'filters', filters: [{ kind: 'boolean', field: 'priority', value: true }] } },
    ];
    const paint = applyCohortComparisonPaint(
      { 'circle-color': '#334155', 'circle-opacity': 0.8, 'circle-radius': 4 },
      cohorts,
      { datasetId: 'places', cohortAId: 'a', cohortBId: 'b' },
    );
    expect(JSON.stringify(paint['circle-color'])).toContain('#7c3aed');
    expect(JSON.stringify(paint['circle-color'])).toContain('#0284c7');
    expect(paint['circle-radius']).toBe(4);
    expect(paint['circle-opacity']).toEqual(expect.arrayContaining(['case']));
  });
});

