export type GeometryKind = 'point' | 'line' | 'polygon';

export type ClassificationMethod =
  | 'equal_interval'
  | 'quantile'
  | 'manual'
  | 'categorical_top_n';

export type VisualisationKind =
  | 'simple'
  | 'choropleth'
  | 'categorical'
  | 'graduated_symbol'
  | 'heatmap'
  | 'label'
  | 'dot_density'
  | 'extrusion'
  | 'graduated_line'
  | 'hexbin'
  | 'bivariate'
  | 'glyph_grid';

export type LegendItem = {
  label: string;
  color: string;
  min?: number;
  max?: number;
  value?: string;
  /** Bivariate grid position (0-2), row-major. */
  row?: number;
  column?: number;
  count?: number;
  percentage?: number;
};

export type LegendSpec = {
  title: string;
  kind: VisualisationKind;
  items: LegendItem[];
  classification?: {
    method: ClassificationMethod;
    breaks?: number[];
  };
  palette?: {
    name: string;
    colorBlindSafe: boolean;
    warnings: string[];
  };
};

export type SimpleVisualisation = {
  kind: 'simple';
  color: string;
  opacity: number;
  outlineColor?: string;
};

export type ChoroplethVisualisation = {
  kind: 'choropleth';
  field: string;
  method: Extract<ClassificationMethod, 'equal_interval' | 'quantile' | 'manual'>;
  classCount: number;
  breaks: number[];
  palette: string[];
  nullColor: string;
  opacity: number;
  outlineColor: string;
  outlineWidth: number;
};

export type CategoricalVisualisation = {
  kind: 'categorical';
  field: string;
  method: 'categorical_top_n';
  categories: Array<{ value: string; color: string; count?: number }>;
  otherColor: string;
  nullColor: string;
  opacity: number;
  totalCount?: number;
};

export type GraduatedSymbolVisualisation = {
  kind: 'graduated_symbol';
  field: string;
  method: Extract<ClassificationMethod, 'equal_interval' | 'quantile' | 'manual'>;
  minValue: number;
  maxValue: number;
  minRadius: number;
  maxRadius: number;
  color: string;
  opacity: number;
};

export type HeatmapVisualisation = {
  kind: 'heatmap';
  field?: string;
  palette: string[];
  radius: number;
  intensity: number;
  opacity: number;
};

export type LabelVisualisation = {
  kind: 'label';
  field: string;
  fontSize: number;
  color: string;
  haloColor: string;
  haloWidth: number;
  minZoom: number;
};

export type DotDensityVisualisation = {
  kind: 'dot_density';
  field: string;
  dotValue: number;
  color: string;
  radius: number;
  opacity: number;
};

export type ExtrusionVisualisation = {
  kind: 'extrusion';
  field: string;
  method: Extract<ClassificationMethod, 'equal_interval' | 'quantile' | 'manual'>;
  classCount: number;
  breaks: number[];
  palette: string[];
  nullColor: string;
  heightMultiplier: number;
  opacity: number;
};

export type GraduatedLineVisualisation = {
  kind: 'graduated_line';
  field: string;
  minValue: number;
  maxValue: number;
  minWidth: number;
  maxWidth: number;
  color: string;
  opacity: number;
};

export type HexbinAggregate = 'count' | 'sum' | 'avg';

export type HexbinVisualisation = {
  kind: 'hexbin';
  /** Field to aggregate; unused when aggregate is 'count'. */
  field?: string;
  aggregate: HexbinAggregate;
  /** Hexagon radius (center→vertex) in meters. */
  cellSize: number;
};

export type BivariateVisualisation = {
  kind: 'bivariate';
  fieldX: string;
  fieldY: string;
  /** 2 inner breaks per axis (3 classes each). */
  breaksX: number[];
  breaksY: number[];
  /** 9 colors, row-major: rows = Y classes (low→high), columns = X classes (low→high). */
  palette: string[];
  nullColor: string;
  opacity: number;
  outlineColor: string;
  outlineWidth: number;
};

export type GlyphGridGlyph = 'density' | 'circle' | 'pie' | 'donut' | 'bars' | 'radial';

/**
 * Screen-space gridded glyph map rendered by the screengrid plugin.
 * Analysis-only style: it draws on its own canvas and is not part of the
 * exportable MapLibre style JSON.
 */
export type GlyphGridVisualisation = {
  kind: 'glyph_grid';
  mode: 'grid' | 'hex';
  /** Cell size in screen pixels. */
  cellSize: number;
  glyph: GlyphGridGlyph;
  /** Numeric fields summed per cell; drive multivariate glyph segments. */
  fields: string[];
  /** Cell weight for density/circle glyphs: row count or fields[0] sum/mean. */
  aggregate: 'count' | 'sum' | 'avg';
  palette: string[];
  opacity: number;
};

export type LayerVisualisation =
  | SimpleVisualisation
  | ChoroplethVisualisation
  | CategoricalVisualisation
  | GraduatedSymbolVisualisation
  | HeatmapVisualisation
  | LabelVisualisation
  | DotDensityVisualisation
  | ExtrusionVisualisation
  | GraduatedLineVisualisation
  | HexbinVisualisation
  | BivariateVisualisation
  | GlyphGridVisualisation;
