import { describe, expect, it } from 'vitest';
import type { MapLayer, WorkflowNode } from '../store/useStore';
import { datasetFields, inferFieldSemanticType, metadataForLayer, metadataForWorkflowNode, preferredExplorationField } from './datasetMetadata';

describe('dataset metadata', () => {
  it('infers analytical field semantics and removes geometry internals', () => {
    expect(inferFieldSemanticType({ name: 'population', type: 'BIGINT' })).toBe('numeric');
    expect(inferFieldSemanticType({ name: 'observed_at', type: 'TIMESTAMP' })).toBe('temporal');
    expect(inferFieldSemanticType({ name: 'active', type: 'BOOLEAN' })).toBe('boolean');
    expect(inferFieldSemanticType({ name: 'area_id', type: 'VARCHAR' })).toBe('identifier');

    expect(datasetFields([
      { name: '__alur_tile_geom', type: 'GEOMETRY' },
      { name: 'name', type: 'VARCHAR' },
    ])).toEqual([{ name: 'name', type: 'VARCHAR', semanticType: 'categorical' }]);
  });

  it('describes layer and workflow sources through one interface', () => {
    const layer = {
      id: 'wards',
      name: 'Wards',
      featureCount: 42,
      createdAt: 10,
      source: {
        kind: 'legacy-geojson',
        geometryKind: 'polygon',
        fields: [{ name: 'need', type: 'DOUBLE' }],
      },
    } as MapLayer;
    expect(metadataForLayer(layer)).toMatchObject({
      id: 'wards',
      kind: 'layer',
      rowCount: 42,
      geometryKind: 'polygon',
      featureIdColumn: '_alur_feature_id',
    });

    const node = {
      id: 'aggregate-1',
      data: { label: 'Summary', type: 'aggregate', config: { featureCount: 7 } },
    } as WorkflowNode;
    expect(metadataForWorkflowNode(node, [{ name: 'total', type: 'DECIMAL' }])).toMatchObject({
      id: 'aggregate-1',
      kind: 'workflow-node',
      rowCount: 7,
      fields: [{ name: 'total', semanticType: 'numeric' }],
    });
  });

  it('prefers an explanatory category before identifiers and measures', () => {
    const field = preferredExplorationField({
      id: 'x',
      name: 'X',
      kind: 'table',
      fields: datasetFields([
        { name: 'record_id', type: 'VARCHAR' },
        { name: 'value', type: 'DOUBLE' },
        { name: 'region', type: 'VARCHAR' },
      ]),
    });
    expect(field?.name).toBe('region');
  });
});

