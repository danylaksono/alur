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
  | 'dot_density';

export type LegendItem = {
  label: string;
  color: string;
  min?: number;
  max?: number;
  value?: string;
};

export type LegendSpec = {
  title: string;
  kind: VisualisationKind;
  items: LegendItem[];
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

export type LayerVisualisation =
  | SimpleVisualisation
  | ChoroplethVisualisation
  | CategoricalVisualisation
  | GraduatedSymbolVisualisation
  | HeatmapVisualisation
  | LabelVisualisation
  | DotDensityVisualisation;
