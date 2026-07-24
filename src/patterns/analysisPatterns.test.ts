import { describe, expect, it } from 'vitest';
import { ANALYSIS_PATTERNS, patternReadiness } from './analysisPatterns';
import type { VisualAnalyticsState } from '../types/visualAnalytics';

const analytics = (): VisualAnalyticsState => ({ datasets: {}, charts: [], kpis: [], cohorts: [], bookmarks: [], comparisons: [], variants: [], explain: { title: 'Explain', sections: [], cards: [] } });

describe('analysis pattern registry', () => {
  it('ships SIL and two non-SIL patterns', () => expect(ANALYSIS_PATTERNS.map((pattern) => pattern.id)).toEqual(['spatial-intervention-loop', 'cohort-comparison', 'temporal-change']));
  it('keeps readiness advisory and identifies missing intervention coverage', () => {
    const readiness = patternReadiness('spatial-intervention-loop', analytics());
    expect(readiness.find((item) => item.id === 'intervene')).toMatchObject({ ready: false, note: 'Intervention not yet defined.' });
  });
});
