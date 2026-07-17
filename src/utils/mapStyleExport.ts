import type { MapLayer } from '../store/useStore';

export type ExportedMapStyle = {
  version: 1;
  exportedAt: string;
  layers: Array<{
    id: string;
    name: string;
    visible: boolean;
    opacity: number;
    color?: string;
    sourceKind?: MapLayer['sourceKind'];
    visualisation?: MapLayer['visualisation'];
    legend?: MapLayer['legend'];
  }>;
};

export const buildMapStyleExport = (layers: MapLayer[]): ExportedMapStyle => ({
  version: 1,
  exportedAt: new Date().toISOString(),
  layers: layers
    .filter((layer) => layer.visualisation || layer.legend || layer.color)
    .map((layer) => ({
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      color: layer.color,
      sourceKind: layer.sourceKind,
      visualisation: layer.visualisation,
      legend: layer.legend,
    })),
});

export const downloadMapStyleExport = (layers: MapLayer[]) => {
  const payload = buildMapStyleExport(layers);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `alur-map-style-${Date.now()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
};

