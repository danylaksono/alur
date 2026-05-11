export type BasemapId = 'positron' | 'voyager' | 'dark' | 'osm';

export type BasemapDefinition = {
  id: BasemapId;
  name: string;
  description: string;
  styleUrl: string;
};

export const BASEMAPS: BasemapDefinition[] = [
  {
    id: 'positron',
    name: 'Light',
    description: 'Quiet CARTO basemap for analysis overlays',
    styleUrl: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  },
  {
    id: 'voyager',
    name: 'Street',
    description: 'Detailed streets, labels, and urban context',
    styleUrl: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
  },
  {
    id: 'dark',
    name: 'Dark',
    description: 'High contrast backdrop for dense results',
    styleUrl: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  },
  {
    id: 'osm',
    name: 'OSM',
    description: 'OpenStreetMap raster tiles',
    styleUrl: 'https://demotiles.maplibre.org/style.json',
  },
];

export const DEFAULT_BASEMAP_ID: BasemapId = 'positron';

export function getBasemap(id: BasemapId) {
  return BASEMAPS.find((basemap) => basemap.id === id) || BASEMAPS[0];
}
