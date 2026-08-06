import { describe, expect, it } from 'vitest';
import { createProjectManifest, parseProjectManifest } from './projectService';

describe('project manifest v1 to v2 migration', () => {
  it('converts Board, dashboard cards, cohort comparison, and a visible map into Explain evidence', () => {
    const current = createProjectManifest();
    const legacy = {
      ...current,
      version: 1,
      workspace: { ...current.workspace, workspaceMode: 'board', activeRailTab: 'cohorts' },
      layers: [{ id: 'areas', name: 'Areas', visible: true, opacity: 1 }],
      visualAnalytics: {
        ...current.visualAnalytics,
        cohorts: [{ id: 'north', datasetId: 'areas', name: 'North', colour: '#2563eb', definition: { kind: 'filters', filters: [] }, createdAt: 1 }],
        comparison: { datasetId: 'areas', cohortAId: 'north', compareToRemainder: true },
        dashboard: { title: 'Legacy board', cards: [{ id: 'note', kind: 'note', title: 'Finding', note: 'Keep', width: 2, height: 'compact' }] },
        comparisons: undefined, explain: undefined, variants: undefined,
      },
    };
    const migrated = parseProjectManifest(JSON.stringify(legacy));
    // Migrations chain: a v1 file lands at the current version, not at v2.
    expect(migrated.version).toBe(3);
    expect(migrated.workspace).toMatchObject({ workspaceMode: 'explain', activeRailTab: 'layers' });
    expect(migrated.visualAnalytics.comparisons).toHaveLength(1);
    expect(migrated.visualAnalytics.explain?.cards.map((card) => card.kind)).toEqual(['note', 'map']);
  });
});
