import type { LegendSpec, LayerVisualisation } from '../types/visualisation';
import type { WorkflowVisualisationConfig } from './workflowEngine';
import {
  buildCategoricalVisualisation,
  buildChoroplethVisualisation,
  buildGraduatedSymbolVisualisation,
  buildHeatmapVisualisation,
  buildLabelVisualisation,
  buildDotDensityVisualisation,
  buildLegend,
  profileGeoJsonField,
} from './classification';
import { getPalette } from './palettes';

export const resolveVisualisationForGeoJson = (
  geojson: GeoJSON.FeatureCollection,
  config?: WorkflowVisualisationConfig,
): { visualisation?: LayerVisualisation; legend?: LegendSpec } => {
  if (!config?.kind) return {};

  const field = typeof config.field === 'string' ? config.field : '';
  const palette = getPalette(config.paletteId || 'teal').colors;
  const profile = field ? profileGeoJsonField(geojson.features, field) : null;

  if (config.kind === 'choropleth' && field && profile?.kind === 'numeric') {
    const visualisation = buildChoroplethVisualisation({
      field,
      profile,
      method: config.method === 'equal_interval' || config.method === 'manual' ? config.method : 'quantile',
      classCount: typeof config.classCount === 'number' ? config.classCount : 5,
      palette,
    });
    return { visualisation, legend: buildLegend(visualisation) };
  }

  if (config.kind === 'categorical' && field && profile?.kind === 'categorical') {
    const visualisation = buildCategoricalVisualisation({ field, profile });
    return { visualisation, legend: buildLegend(visualisation) };
  }

  if (config.kind === 'graduated_symbol' && field && profile?.kind === 'numeric') {
    const visualisation = buildGraduatedSymbolVisualisation({ field, profile });
    return { visualisation, legend: buildLegend(visualisation) };
  }

  if (config.kind === 'heatmap') {
    const visualisation = buildHeatmapVisualisation({
      field: profile?.kind === 'numeric' ? field : undefined,
      palette,
    });
    return { visualisation, legend: buildLegend(visualisation) };
  }

  if (config.kind === 'label' && field) {
    const visualisation = buildLabelVisualisation({ field });
    return { visualisation, legend: buildLegend(visualisation) };
  }

  if (config.kind === 'dot_density' && field && profile?.kind === 'numeric') {
    const visualisation = buildDotDensityVisualisation({ field });
    return { visualisation, legend: buildLegend(visualisation) };
  }

  return {};
};

