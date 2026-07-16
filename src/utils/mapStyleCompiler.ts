import type { MapLayer } from '../store/useStore';
import type { GeometryKind, LayerVisualisation, LabelVisualisation } from '../types/visualisation';
import { geometryKindForSource } from './layerSource';

export type CompiledMapLayerStyle = {
  type: 'circle' | 'line' | 'fill' | 'heatmap' | 'fill-extrusion';
  paint: Record<string, unknown>;
  layout?: Record<string, unknown>;
  label?: CompiledLabelLayer;
};

export type CompiledLabelLayer = {
  type: 'symbol';
  layout: Record<string, unknown>;
  paint: Record<string, unknown>;
};

const FALLBACK_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

export const geometryKindForLayer = (layer: MapLayer): GeometryKind => {
  return geometryKindForSource(layer);
};

export const fallbackLayerColor = (index: number) => FALLBACK_COLORS[index % FALLBACK_COLORS.length];

const colorPaintKey = (geometryKind: GeometryKind) => {
  if (geometryKind === 'point') return 'circle-color';
  if (geometryKind === 'line') return 'line-color';
  return 'fill-color';
};

const opacityPaintKey = (geometryKind: GeometryKind) => {
  if (geometryKind === 'point') return 'circle-opacity';
  if (geometryKind === 'line') return 'line-opacity';
  return 'fill-opacity';
};

const withInteractionColor = (baseColor: unknown) => [
  'case',
  ['boolean', ['feature-state', 'selected'], false],
  '#f97316',
  ['boolean', ['feature-state', 'hover'], false],
  '#38bdf8',
  baseColor,
];

const defaultType = (geometryKind: GeometryKind): CompiledMapLayerStyle['type'] => {
  if (geometryKind === 'point') return 'circle';
  if (geometryKind === 'line') return 'line';
  return 'fill';
};

export const compileChoroplethColorExpression = (visualisation: Extract<LayerVisualisation, { kind: 'choropleth' }>) => {
  const expression: unknown[] = [
    'case',
    ['any', ['==', ['get', visualisation.field], null], ['!', ['has', visualisation.field]]],
    visualisation.nullColor,
  ];

  const step: unknown[] = [
    'step',
    ['to-number', ['get', visualisation.field]],
    visualisation.palette[0],
  ];

  visualisation.breaks.forEach((breakValue, index) => {
    step.push(breakValue, visualisation.palette[Math.min(index + 1, visualisation.palette.length - 1)]);
  });

  expression.push(step);
  return expression;
};

const classedStepExpression = (field: string, breaks: number[], palette: string[]) => {
  const step: unknown[] = ['step', ['to-number', ['get', field]], palette[0]];
  breaks.forEach((breakValue, index) => {
    step.push(breakValue, palette[Math.min(index + 1, palette.length - 1)]);
  });
  return step;
};

export const compileBivariateColorExpression = (visualisation: Extract<LayerVisualisation, { kind: 'bivariate' }>) => {
  const { fieldX, fieldY, breaksX, breaksY, palette, nullColor } = visualisation;
  // For each Y class (row), a step over X picks one of that row's 3 colors.
  const rowExpression = (row: number) =>
    classedStepExpression(fieldX, breaksX, palette.slice(row * 3, row * 3 + 3));
  const yStep: unknown[] = ['step', ['to-number', ['get', fieldY]], rowExpression(0)];
  breaksY.forEach((breakValue, index) => {
    yStep.push(breakValue, rowExpression(Math.min(index + 1, 2)));
  });

  return [
    'case',
    [
      'any',
      ['==', ['get', fieldX], null], ['!', ['has', fieldX]],
      ['==', ['get', fieldY], null], ['!', ['has', fieldY]],
    ],
    nullColor,
    yStep,
  ];
};

export const compileCategoricalColorExpression = (visualisation: Extract<LayerVisualisation, { kind: 'categorical' }>) => {
  const match: unknown[] = ['match', ['to-string', ['get', visualisation.field]]];
  visualisation.categories.forEach((category) => {
    match.push(category.value, category.color);
  });
  match.push(visualisation.otherColor);

  return [
    'case',
    ['any', ['==', ['get', visualisation.field], null], ['!', ['has', visualisation.field]]],
    visualisation.nullColor,
    match,
  ];
};

export const compileLabelLayer = (visualisation: LabelVisualisation, geometryKind: GeometryKind): CompiledLabelLayer => {
  const offset: [number, number] = geometryKind === 'point' ? [0, -1.2] : [0, 0];

  return {
    type: 'symbol',
    layout: {
      'text-field': ['to-string', ['get', visualisation.field]],
      'text-font': ['DIN Offc Pro Medium', 'Noto Sans Regular', 'Arial Unicode MS Regular'],
      'text-size': visualisation.fontSize,
      'text-anchor': 'center',
      'text-offset': offset,
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-optional': true,
    },
    paint: {
      'text-color': visualisation.color,
      'text-halo-color': visualisation.haloColor,
      'text-halo-width': visualisation.haloWidth,
      'text-opacity': visualisation.minZoom > 0
        ? ['interpolate', ['linear'], ['zoom'], 0, 0, visualisation.minZoom, 1]
        : 1,
    },
  };
};

export const compileLayerStyle = (
  layer: MapLayer,
  options: { index?: number; selected?: boolean; inactive?: boolean } = {},
): CompiledMapLayerStyle => {
  const geometryKind = geometryKindForLayer(layer);
  const selected = options.selected ?? false;
  const inactive = options.inactive ?? false;
  const baseOpacity = layer.visible ? layer.opacity : 0;
  const visualisation = layer.visualisation;
  const simpleColor = layer.color || fallbackLayerColor(options.index ?? 0);
  const inactiveOpacity = inactive ? Math.min(0.2, baseOpacity * 0.4) : baseOpacity;

  if (visualisation?.kind === 'heatmap' && geometryKind === 'point') {
    return {
      type: 'heatmap',
      paint: {
        'heatmap-weight': visualisation.field
          ? ['interpolate', ['linear'], ['to-number', ['get', visualisation.field]], 0, 0, 1, 1]
          : 1,
        'heatmap-intensity': visualisation.intensity,
        'heatmap-radius': visualisation.radius,
        'heatmap-opacity': inactive ? Math.min(0.25, visualisation.opacity) : visualisation.opacity,
        'heatmap-color': [
          'interpolate',
          ['linear'],
          ['heatmap-density'],
          0,
          visualisation.palette[0],
          0.5,
          visualisation.palette[Math.floor(visualisation.palette.length / 2)] || visualisation.palette[0],
          1,
          visualisation.palette[visualisation.palette.length - 1],
        ],
      },
    };
  }

  if (visualisation?.kind === 'extrusion' && geometryKind === 'polygon') {
    return {
      type: 'fill-extrusion',
      paint: {
        'fill-extrusion-color': withInteractionColor([
          'case',
          ['any', ['==', ['get', visualisation.field], null], ['!', ['has', visualisation.field]]],
          visualisation.nullColor,
          classedStepExpression(visualisation.field, visualisation.breaks, visualisation.palette),
        ]),
        'fill-extrusion-height': [
          'max', 0,
          ['*', ['to-number', ['get', visualisation.field], 0], visualisation.heightMultiplier],
        ],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': inactive
          ? Math.min(0.2, visualisation.opacity * 0.4)
          : visualisation.opacity,
      },
    };
  }

  const paint: Record<string, unknown> = {};
  const type = defaultType(geometryKind);

  if (geometryKind === 'point') {
    paint['circle-radius'] = selected ? 6 : 4;
    paint['circle-stroke-color'] = '#f8fafc';
    paint['circle-stroke-width'] = selected ? 1.2 : 0.5;
    paint['circle-stroke-opacity'] = Math.min(1, inactiveOpacity + 0.15);
  } else if (geometryKind === 'line') {
    paint['line-width'] = selected ? 3 : 2;
  } else {
    paint['fill-outline-color'] = selected ? '#020617' : '#334155';
  }

  if (visualisation?.kind === 'choropleth') {
    paint[colorPaintKey(geometryKind)] = withInteractionColor(compileChoroplethColorExpression(visualisation));
    paint[opacityPaintKey(geometryKind)] = inactive
      ? Math.min(0.2, visualisation.opacity * 0.4)
      : visualisation.opacity;
    if (geometryKind === 'line') paint['line-width'] = selected ? 3 : Math.max(1.5, visualisation.outlineWidth * 2);
    if (geometryKind === 'polygon') paint['fill-outline-color'] = selected ? '#020617' : visualisation.outlineColor;
    return { type, paint };
  }

  if (visualisation?.kind === 'categorical') {
    paint[colorPaintKey(geometryKind)] = withInteractionColor(compileCategoricalColorExpression(visualisation));
    paint[opacityPaintKey(geometryKind)] = inactive
      ? Math.min(0.2, visualisation.opacity * 0.4)
      : visualisation.opacity;
    return { type, paint };
  }

  if (visualisation?.kind === 'bivariate') {
    paint[colorPaintKey(geometryKind)] = withInteractionColor(compileBivariateColorExpression(visualisation));
    paint[opacityPaintKey(geometryKind)] = inactive
      ? Math.min(0.2, visualisation.opacity * 0.4)
      : visualisation.opacity;
    if (geometryKind === 'polygon') paint['fill-outline-color'] = selected ? '#020617' : visualisation.outlineColor;
    return { type, paint };
  }

  if (visualisation?.kind === 'graduated_line' && geometryKind === 'line') {
    paint['line-width'] = [
      'interpolate',
      ['linear'],
      ['to-number', ['get', visualisation.field]],
      visualisation.minValue,
      selected ? visualisation.minWidth + 1 : visualisation.minWidth,
      visualisation.maxValue,
      selected ? visualisation.maxWidth + 1 : visualisation.maxWidth,
    ];
    paint['line-color'] = withInteractionColor(visualisation.color);
    paint['line-opacity'] = inactive ? Math.min(0.2, visualisation.opacity * 0.4) : visualisation.opacity;
    return { type, paint };
  }

  if (visualisation?.kind === 'graduated_symbol' && geometryKind === 'point') {
    paint['circle-radius'] = [
      'interpolate',
      ['linear'],
      ['to-number', ['get', visualisation.field]],
      visualisation.minValue,
      visualisation.minRadius,
      visualisation.maxValue,
      visualisation.maxRadius,
    ];
    paint['circle-color'] = withInteractionColor(visualisation.color);
    paint['circle-opacity'] = inactive ? Math.min(0.2, visualisation.opacity * 0.4) : visualisation.opacity;
    return { type, paint };
  }

  if (visualisation?.kind === 'label') {
    paint[colorPaintKey(geometryKind)] = geometryKind === 'polygon' ? 'rgba(0,0,0,0)' : simpleColor;
    paint[opacityPaintKey(geometryKind)] = geometryKind === 'polygon' ? 0.05 : inactiveOpacity;
    if (geometryKind === 'line') paint['line-width'] = 1;
    if (geometryKind === 'point') {
      paint['circle-radius'] = 3;
      paint['circle-stroke-width'] = 0;
    }
    return {
      type,
      paint,
      label: compileLabelLayer(visualisation, geometryKind),
    };
  }

  paint[colorPaintKey(geometryKind)] = withInteractionColor(visualisation?.kind === 'simple' ? visualisation.color : simpleColor);
  paint[opacityPaintKey(geometryKind)] = geometryKind === 'polygon'
    ? Math.max(0.25, inactiveOpacity * 0.65)
    : inactiveOpacity;

  return { type, paint };
};
