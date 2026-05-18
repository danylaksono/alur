import { describe, expect, it } from 'vitest';
import type { MapLayer } from '../store/useStore';
import { buildMapStyleExport } from './mapStyleExport';

const layer = (patch: Partial<MapLayer>): MapLayer => ({
  id: 'layer-a',
  name: 'Layer A',
  geojson: { type: 'FeatureCollection', features: [] },
  source: { kind: 'legacy-geojson', geometryKind: 'point', fields: [] },
  visible: true,
  opacity: 0.8,
  createdAt: 1,
  featureCount: 0,
  styleVersion: 1,
  ...patch,
});

describe('map style export', () => {
  it('exports style metadata without feature data', () => {
    const payload = buildMapStyleExport([
      layer({
        visualisation: {
          kind: 'simple',
          color: '#2563eb',
          opacity: 0.8,
        },
      }),
      layer({ id: 'unstyled', name: 'Unstyled' }),
    ]);

    expect(payload.version).toBe(1);
    expect(payload.layers).toHaveLength(1);
    expect(payload.layers[0]).toMatchObject({
      id: 'layer-a',
      name: 'Layer A',
      visualisation: { kind: 'simple' },
    });
    expect(JSON.stringify(payload)).not.toContain('FeatureCollection');
  });
});
