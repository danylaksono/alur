import { useEffect, useMemo, useState } from 'react';
import { BarChart3, ChevronLeft, Eraser, Palette } from 'lucide-react';
import { useStore, type MapLayer } from '../../store/useStore';
import { toggleFilterIn, visualFilterKey } from '../../utils/legendFilter';
import {
  buildCategoricalVisualisation,
  buildChoroplethVisualisation,
  buildGraduatedSymbolVisualisation,
  buildHeatmapVisualisation,
  buildLabelVisualisation,
  buildDotDensityVisualisation,
  buildExtrusionVisualisation,
  buildGraduatedLineVisualisation,
  buildHexbinVisualisation,
  buildBivariateVisualisation,
  buildGlyphGridVisualisation,
  buildLegend,
  profileGeoJsonField,
  type FieldProfile,
} from '../../utils/classification';
import type { GlyphGridGlyph, HexbinAggregate, VisualisationKind } from '../../types/visualisation';
import { geometryKindForLayer } from '../../utils/mapStyleCompiler';
import { getPalette, getBivariatePalette, BIVARIATE_PALETTES, CATEGORICAL_PALETTE, SEQUENTIAL_PALETTES } from '../../utils/palettes';
import { cn } from '../../utils/cn';
import { queryLayerFieldProfile, queryLayerTemporalRange, type TemporalRange } from '../../services/visualAnalyticsService';
import { generateDotDensityGeoJSON } from '../../services/dotDensityService';
import { generateHexbins, type HexbinMethod } from '../../services/hexbinService';
import { TemporalSlider } from './TemporalSlider';

const excludedFields = new Set(['geojson', 'geometry', 'geom']);

const formatCount = (count: number) => count.toLocaleString();

const fieldNamesForLayer = (layer: MapLayer | null) => {
  if (!layer) return [];
  return layer.source.fields
    .map((field) => field.name)
    .filter((name) => {
      const lower = name.toLowerCase();
      return !excludedFields.has(lower) && !lower.startsWith('__alur_');
    })
    .sort((a, b) => a.localeCompare(b));
};

const DistributionPreview = ({
  field,
  profile,
  activeFilterKeys,
  onToggleFilter,
}: {
  field: string;
  profile: FieldProfile | null;
  activeFilterKeys: Set<string>;
  onToggleFilter: (filter: { kind: 'category'; field: string; values: string[] } | { kind: 'range'; field: string; min: number; max: number }) => void;
}) => {
  if (!profile) return null;

  if (profile.kind === 'numeric') {
    const maxCount = Math.max(...profile.bins.map((bin) => bin.count), 1);
    return (
      <div className="flex h-20 items-end gap-1">
        {profile.bins.map((bin) => (
          <div key={bin.label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <button
              type="button"
              onClick={() => onToggleFilter({ kind: 'range', field, min: bin.min, max: bin.max })}
              className={
                activeFilterKeys.has(`${field}:range:${bin.min}:${bin.max}`)
                  ? 'w-full rounded-t bg-orange-500 ring-2 ring-orange-200'
                  : 'w-full rounded-t bg-slate-800 hover:bg-slate-600'
              }
              style={{ height: `${Math.max(4, (bin.count / maxCount) * 60)}px` }}
              title={`Filter ${field} by ${bin.label}: ${formatCount(bin.count)}`}
            />
            <span className="w-full truncate text-center text-[10px] text-slate-400" title={bin.label}>
              {bin.label}
            </span>
          </div>
        ))}
      </div>
    );
  }

  const maxCount = Math.max(...profile.categories.map((category) => category.count), 1);
  return (
    <div className="space-y-1.5">
      {profile.categories.slice(0, 8).map((category) => (
        <button
          type="button"
          key={category.value}
          onClick={() => onToggleFilter({ kind: 'category', field, values: [category.value] })}
          className={cn(
            'grid w-full grid-cols-[minmax(0,1fr)_56px] items-center gap-2 rounded px-1 py-0.5 text-left text-[11px]',
            activeFilterKeys.has(`${field}:category:${category.value}`)
              ? 'bg-orange-50 text-orange-700 ring-1 ring-orange-200'
              : 'hover:bg-slate-50'
          )}
        >
          <div className="min-w-0">
            <div className="truncate font-semibold text-slate-600">{category.value}</div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-slate-800"
                style={{ width: `${Math.max(4, (category.count / maxCount) * 100)}%` }}
              />
            </div>
          </div>
          <span className="text-right font-bold text-slate-400">{formatCount(category.count)}</span>
        </button>
      ))}
    </div>
  );
};

const TEMPORAL_TYPE_PATTERN = /date|timestamp|time/i;
const TEMPORAL_NAME_PATTERN = /(date|time|year|month|_at$|_on$)/i;

const temporalFieldsForLayer = (layer: MapLayer | null) => {
  if (!layer) return [];
  return layer.source.fields
    .filter((field) =>
      TEMPORAL_TYPE_PATTERN.test(field.type) || TEMPORAL_NAME_PATTERN.test(field.name)
    )
    .map((field) => field.name)
    .filter((name) => !excludedFields.has(name.toLowerCase()) && !name.toLowerCase().startsWith('__alur_'));
};

export const VisualisationPanel = ({
  layer: selectedLayer,
  initialField,
  onBack,
}: {
  layer: MapLayer | null;
  initialField?: string;
  onBack?: () => void;
}) => {
  const mapLayers = useStore((s) => s.mapLayers);
  const updateLayerVisualisation = useStore((s) => s.updateLayerVisualisation);
  const clearLayerVisualisation = useStore((s) => s.clearLayerVisualisation);
  const updateMapLayer = useStore((s) => s.updateMapLayer);
  const addMapLayer = useStore((s) => s.addMapLayer);
  const removeMapLayer = useStore((s) => s.removeMapLayer);
  const visualAnalytics = useStore((s) => s.visualAnalytics);
  const setLayerFilters = useStore((s) => s.setLayerFilters);
  const addToast = useStore((s) => s.addToast);
  const isRestyling = useStore((s) => Boolean(selectedLayer && s.restylingLayerIds[selectedLayer.id]));

  const fields = useMemo(() => fieldNamesForLayer(selectedLayer), [selectedLayer?.id, selectedLayer?.source]);
  const temporalCandidates = useMemo(() => temporalFieldsForLayer(selectedLayer), [selectedLayer?.id, selectedLayer?.source]);
  const fieldsKey = fields.join('|');
  const geometryKind = useMemo(() => selectedLayer ? geometryKindForLayer(selectedLayer) : null, [selectedLayer]);
  const [field, setField] = useState('');
  const [kind, setKind] = useState<VisualisationKind>('simple');
  const [method, setMethod] = useState<'equal_interval' | 'quantile'>('quantile');
  const [classCount, setClassCount] = useState(5);
  const [paletteId, setPaletteId] = useState(SEQUENTIAL_PALETTES[0].id);
  const [heightMultiplier, setHeightMultiplier] = useState(1);
  const [fieldY, setFieldY] = useState('');
  const [profileY, setProfileY] = useState<FieldProfile | null>(null);
  const [bivariatePaletteId, setBivariatePaletteId] = useState(BIVARIATE_PALETTES[0].id);
  const [hexCellSize, setHexCellSize] = useState(500);
  const [hexAggregate, setHexAggregate] = useState<HexbinAggregate>('count');
  const [hexbinGenerating, setHexbinGenerating] = useState(false);
  const [hexbinMethod, setHexbinMethod] = useState<{ method: HexbinMethod; resolution?: number; cellEdgeMetres?: number } | null>(null);
  const [glyphMode, setGlyphMode] = useState<'grid' | 'hex'>('grid');
  const [glyphType, setGlyphType] = useState<GlyphGridGlyph>('density');
  const [glyphCellSize, setGlyphCellSize] = useState(48);
  const [glyphFields, setGlyphFields] = useState<string[]>([]);
  const [glyphAggregate, setGlyphAggregate] = useState<'count' | 'sum' | 'avg'>('count');
  const [temporalField, setTemporalField] = useState('');
  const [temporalStart, setTemporalStart] = useState('');
  const [temporalEnd, setTemporalEnd] = useState('');
  const [temporalRange, setTemporalRange] = useState<TemporalRange | null>(null);
  const [profile, setProfile] = useState<FieldProfile | null>(null);

  useEffect(() => {
    if (!selectedLayer || !temporalField) {
      setTemporalRange(null);
      return;
    }
    let cancelled = false;
    queryLayerTemporalRange({ layer: selectedLayer, column: temporalField }).then((result) => {
      if (!cancelled) setTemporalRange(result);
    }).catch(() => {
      if (!cancelled) setTemporalRange(null);
    });
    return () => { cancelled = true; };
  }, [selectedLayer?.id, temporalField]);

  useEffect(() => {
    if (!selectedLayer) {
      setField('');
      return;
    }

    const vis = selectedLayer.visualisation;
    if (vis?.kind === 'simple') {
      setKind('simple');
      setField(fields[0] || '');
      setTemporalField(temporalCandidates[0] || '');
      return;
    }

    if (vis) {
      setKind(vis.kind);
      if (vis.kind === 'bivariate') {
        setField(vis.fieldX);
        setFieldY(vis.fieldY);
      } else {
        setField('field' in vis && vis.field ? vis.field : fields[0] || '');
      }
      if (vis.kind === 'choropleth') {
        setMethod(vis.method === 'manual' ? 'quantile' : vis.method);
        setClassCount(vis.classCount);
      }
      if (vis.kind === 'extrusion') {
        setClassCount(vis.classCount);
        setHeightMultiplier(vis.heightMultiplier);
      }
      if (vis.kind === 'hexbin') {
        setHexCellSize(vis.cellSize);
        setHexAggregate(vis.aggregate);
      }
      if (vis.kind === 'glyph_grid') {
        setGlyphMode(vis.mode);
        setGlyphType(vis.glyph);
        setGlyphCellSize(vis.cellSize);
        setGlyphFields(vis.fields);
        setGlyphAggregate(vis.aggregate);
        if (vis.fields[0]) setField(vis.fields[0]);
        else setField(fields[0] || '');
      }
      return;
    }

    setKind('simple');
    setField(fields[0] || '');
    setTemporalField(temporalCandidates[0] || '');
  }, [selectedLayer?.id, fieldsKey]);

  useEffect(() => {
    if (initialField && fields.includes(initialField)) setField(initialField);
  }, [initialField, fieldsKey]);

  useEffect(() => {
    if (!selectedLayer || !field) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    queryLayerFieldProfile({ layer: selectedLayer, column: field })
      .then((result) => {
        if (!cancelled) setProfile(result);
      })
      .catch(() => {
        if (!cancelled) setProfile(null);
      });
    return () => { cancelled = true; };
  }, [selectedLayer?.id, selectedLayer?.source, field]);

  // Second-axis profile for bivariate styling.
  useEffect(() => {
    if (!selectedLayer || kind !== 'bivariate' || !fieldY) {
      setProfileY(null);
      return;
    }
    let cancelled = false;
    queryLayerFieldProfile({ layer: selectedLayer, column: fieldY })
      .then((result) => {
        if (!cancelled) setProfileY(result);
      })
      .catch(() => {
        if (!cancelled) setProfileY(null);
      });
    return () => { cancelled = true; };
  }, [selectedLayer?.id, selectedLayer?.source, kind, fieldY]);
  const hasActiveStyle = Boolean(selectedLayer?.visualisation || selectedLayer?.legend);

  const canApply = Boolean(
    selectedLayer &&
    field &&
    ((kind === 'choropleth' && profile?.kind === 'numeric') ||
      (kind === 'categorical' && profile?.kind === 'categorical') ||
      (kind === 'graduated_symbol' && geometryKind === 'point' && profile?.kind === 'numeric') ||
      (kind === 'heatmap' && geometryKind === 'point') ||
      (kind === 'label' && field) ||
      (kind === 'dot_density' && geometryKind === 'polygon' && Boolean(selectedLayer.geojson) && profile?.kind === 'numeric') ||
      (kind === 'extrusion' && geometryKind === 'polygon' && profile?.kind === 'numeric') ||
      (kind === 'graduated_line' && geometryKind === 'line' && profile?.kind === 'numeric') ||
      (kind === 'hexbin' && geometryKind === 'point' && (hexAggregate === 'count' || profile?.kind === 'numeric')) ||
      (kind === 'glyph_grid' && (
        ['pie', 'donut', 'bars', 'radial'].includes(glyphType)
          ? glyphFields.length > 0
          : glyphAggregate === 'count' || profile?.kind === 'numeric'
      )) ||
      (kind === 'bivariate' && profile?.kind === 'numeric' && profileY?.kind === 'numeric')),
  );

  const [dotDensityGenerating, setDotDensityGenerating] = useState(false);

  useEffect(() => {
    if (!selectedLayer) return;

    if (kind === 'simple') {
      if (hasActiveStyle) {
        clearLayerVisualisation(selectedLayer.id);
      }
      return;
    }

    if (kind === 'glyph_grid') {
      if (!canApply) return;
      const multivariate = ['pie', 'donut', 'bars', 'radial'].includes(glyphType);
      const visualisation = buildGlyphGridVisualisation({
        mode: glyphMode,
        cellSize: glyphCellSize,
        glyph: glyphType,
        fields: multivariate ? glyphFields : glyphAggregate === 'count' ? [] : [field],
        aggregate: multivariate ? 'count' : glyphAggregate,
        palette: multivariate ? CATEGORICAL_PALETTE : getPalette(paletteId).colors,
      });
      updateLayerVisualisation(selectedLayer.id, visualisation, buildLegend(visualisation));
      return;
    }

    if (!canApply || !profile) return;

    if (kind === 'dot_density' && profile.kind === 'numeric') {
      const visualisation = buildDotDensityVisualisation({ field });
      updateLayerVisualisation(selectedLayer.id, visualisation, buildLegend(visualisation));

      const dotLayerId = `${selectedLayer.id}-dots`;
      const existingDotsLayer = mapLayers.find((l) => l.id === dotLayerId);
      if (existingDotsLayer) return;
      if (!selectedLayer.geojson) return;

      setDotDensityGenerating(true);
      generateDotDensityGeoJSON({ id: selectedLayer.id, geojson: selectedLayer.geojson }, { field, dotValue: visualisation.dotValue, color: visualisation.color, radius: visualisation.radius, opacity: visualisation.opacity })
        .then((dotsGeojson) => {
          addMapLayer({
            id: dotLayerId,
            name: `${selectedLayer.name} (dots)`,
            geojson: dotsGeojson,
            visible: selectedLayer.visible,
            sourceNodeId: selectedLayer.sourceNodeId,
            sourceKind: 'manual',
            color: visualisation.color,
            opacity: visualisation.opacity,
            visualisation: { kind: 'simple', color: visualisation.color, opacity: visualisation.opacity },
          });
          updateMapLayer(selectedLayer.id, { dotDensityLayerId: dotLayerId });
        })
        .catch(() => {})
        .finally(() => setDotDensityGenerating(false));
      return;
    }

    if (kind === 'choropleth' && profile.kind === 'numeric') {
      const visualisation = buildChoroplethVisualisation({
        field,
        profile,
        method,
        classCount,
        palette: getPalette(paletteId).colors,
      });
      updateLayerVisualisation(selectedLayer.id, visualisation, buildLegend(visualisation));
    }

    if (kind === 'categorical' && profile.kind === 'categorical') {
      const visualisation = buildCategoricalVisualisation({ field, profile });
      updateLayerVisualisation(selectedLayer.id, visualisation, buildLegend(visualisation));
    }

    if (kind === 'graduated_symbol' && profile.kind === 'numeric') {
      const visualisation = buildGraduatedSymbolVisualisation({ field, profile });
      updateLayerVisualisation(selectedLayer.id, visualisation, buildLegend(visualisation));
    }

    if (kind === 'heatmap') {
      const visualisation = buildHeatmapVisualisation({
        field: profile.kind === 'numeric' ? field : undefined,
        palette: getPalette(paletteId).colors,
      });
      updateLayerVisualisation(selectedLayer.id, visualisation, buildLegend(visualisation));
    }

    if (kind === 'label') {
      const visualisation = buildLabelVisualisation({ field });
      updateLayerVisualisation(selectedLayer.id, visualisation, buildLegend(visualisation));
    }

    if (kind === 'extrusion' && profile.kind === 'numeric') {
      const visualisation = buildExtrusionVisualisation({
        field,
        profile,
        classCount,
        palette: getPalette(paletteId).colors,
        heightMultiplier,
      });
      updateLayerVisualisation(selectedLayer.id, visualisation, buildLegend(visualisation));
    }

    if (kind === 'graduated_line' && profile.kind === 'numeric') {
      const visualisation = buildGraduatedLineVisualisation({ field, profile });
      updateLayerVisualisation(selectedLayer.id, visualisation, buildLegend(visualisation));
    }

    if (kind === 'bivariate' && profile.kind === 'numeric' && profileY?.kind === 'numeric') {
      const visualisation = buildBivariateVisualisation({
        fieldX: field,
        fieldY,
        profileX: profile,
        profileY,
        palette: getBivariatePalette(bivariatePaletteId).colors,
      });
      updateLayerVisualisation(selectedLayer.id, visualisation, buildLegend(visualisation));
    }

    if (kind === 'hexbin') {
      const visualisation = buildHexbinVisualisation({ field, aggregate: hexAggregate, cellSize: hexCellSize });
      updateLayerVisualisation(selectedLayer.id, visualisation, buildLegend(visualisation));

      const hexLayerId = `${selectedLayer.id}-hexbin`;
      const existingHexLayer = mapLayers.find((l) => l.id === hexLayerId);
      if (existingHexLayer) return;

      setHexbinGenerating(true);
      generateHexbins(selectedLayer, { cellSize: visualisation.cellSize, aggregate: hexAggregate, field: visualisation.field })
        .then(({ featureCollection: hexGeojson, method, resolution, cellEdgeMetres }) => {
          setHexbinMethod({ method, resolution, cellEdgeMetres });
          if (!hexGeojson.features.length) return;
          const valueProfile = profileGeoJsonField(hexGeojson.features, 'value');
          const hexVis = valueProfile.kind === 'numeric'
            ? buildChoroplethVisualisation({ field: 'value', profile: valueProfile, method: 'quantile', classCount: 5, palette: getPalette(paletteId).colors })
            : undefined;
          addMapLayer({
            id: hexLayerId,
            name: `${selectedLayer.name} (hexbin)`,
            geojson: hexGeojson,
            visible: selectedLayer.visible,
            sourceNodeId: selectedLayer.sourceNodeId,
            sourceKind: 'h3',
            opacity: 0.75,
            visualisation: hexVis,
            legend: hexVis ? buildLegend(hexVis) : undefined,
          });
          updateMapLayer(selectedLayer.id, { hexbinLayerId: hexLayerId });
        })
        .catch((err: any) => {
          console.error('Hexbin generation failed:', err);
          addToast({ type: 'error', message: `Hexbin failed: ${err?.message || err}` });
        })
        .finally(() => setHexbinGenerating(false));
    }
  }, [selectedLayer?.id, hasActiveStyle, field, fieldY, kind, method, classCount, paletteId, bivariatePaletteId, heightMultiplier, hexAggregate, hexCellSize, glyphMode, glyphType, glyphCellSize, glyphAggregate, glyphFields.join('|'), canApply, profile, profileY, updateLayerVisualisation, clearLayerVisualisation]);

  const activeFilters = selectedLayer ? visualAnalytics.datasets[selectedLayer.id]?.filters || [] : [];
  const activeFilterKeys = new Set(activeFilters.map(visualFilterKey));

  const toggleDistributionFilter = (
    nextFilter: { kind: 'category'; field: string; values: string[] } | { kind: 'range'; field: string; min: number; max: number },
  ) => {
    if (!selectedLayer) return;
    const existingFilters = visualAnalytics.datasets[selectedLayer.id]?.filters || [];
    setLayerFilters(selectedLayer.id, toggleFilterIn(existingFilters, nextFilter));
  };

  const applyTemporalFilter = () => {
    if (!selectedLayer || !temporalField || (!temporalStart && !temporalEnd)) return;
    const nextFilter = {
      kind: 'temporal' as const,
      field: temporalField,
      start: temporalStart || undefined,
      end: temporalEnd || undefined,
    };
    const existingFilters = visualAnalytics.datasets[selectedLayer.id]?.filters || [];
    const withoutSameField = existingFilters.filter((filter) => !(filter.kind === 'temporal' && filter.field === temporalField));
    setLayerFilters(selectedLayer.id, [...withoutSameField, nextFilter]);
  };

  return (
    <section className="flex min-h-0 flex-col bg-white">
      <div className="border-b bg-slate-50 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {onBack ? (
              <button
                type="button"
                onClick={onBack}
                className="rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-200/60 hover:text-slate-700"
                title="Back to layers"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
            ) : (
              <Palette className="h-3.5 w-3.5" />
            )}
            <span className="truncate normal-case text-xs font-semibold text-slate-700">
              {selectedLayer ? `Style · ${selectedLayer.name}` : 'Visualise'}
            </span>
            {selectedLayer && isRestyling && (
              <span
                className="h-3 w-3 shrink-0 animate-spin rounded-full border border-slate-400 border-t-transparent"
                title="Rendering layer…"
              />
            )}
          </h3>
          {selectedLayer?.visualisation && (
            <button
              type="button"
              onClick={() => {
                if (!selectedLayer) return;
                if (selectedLayer.dotDensityLayerId) removeMapLayer(selectedLayer.dotDensityLayerId);
                if (selectedLayer.hexbinLayerId) removeMapLayer(selectedLayer.hexbinLayerId);
                if (selectedLayer.dotDensityLayerId || selectedLayer.hexbinLayerId) {
                  updateMapLayer(selectedLayer.id, { dotDensityLayerId: undefined, hexbinLayerId: undefined });
                }
                clearLayerVisualisation(selectedLayer.id);
              }}
              className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-500 hover:bg-slate-50"
              title="Reset style"
            >
              <Eraser className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!selectedLayer ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-5 text-center text-[11px] text-slate-500">
            No layer selected.
          </div>
        ) : fields.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-5 text-center text-[11px] text-slate-500">
            No styleable fields.
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Layer</div>
              <div className="truncate text-[11px] font-bold text-slate-700">{selectedLayer.name}</div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Type</span>
                <select
                  value={kind}
                  onChange={(event) => setKind(event.target.value as typeof kind)}
                  className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                >
                  <option value="simple">Raw geometry</option>
                  <option value="choropleth">Choropleth</option>
                  <option value="categorical">Categories</option>
                  <option value="bivariate">Bivariate</option>
                  {geometryKind === 'point' && <option value="graduated_symbol">Symbols</option>}
                  {geometryKind === 'point' && <option value="heatmap">Heatmap</option>}
                  {geometryKind === 'point' && <option value="hexbin">Hexbin</option>}
                  <option value="glyph_grid">Glyph grid</option>
                  {geometryKind === 'polygon' && <option value="extrusion">3D extrusion</option>}
                  {geometryKind === 'polygon' && selectedLayer.geojson && <option value="dot_density">Dot density</option>}
                  {geometryKind === 'line' && <option value="graduated_line">Line width</option>}
                  <option value="label">Labels</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{kind === 'bivariate' ? 'Field X' : 'Field'}</span>
                <select
                  value={field}
                  onChange={(event) => setField(event.target.value)}
                  className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                >
                  {fields.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </label>
            </div>

            {(kind === 'choropleth' || kind === 'heatmap' || kind === 'extrusion' || kind === 'hexbin') && (
              <div className="grid grid-cols-3 gap-2">
                {kind === 'choropleth' && <label className="space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Method</span>
                  <select
                    value={method}
                    onChange={(event) => setMethod(event.target.value as typeof method)}
                    className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                  >
                    <option value="quantile">Quantile</option>
                    <option value="equal_interval">Equal interval</option>
                  </select>
                </label>}
                {(kind === 'choropleth' || kind === 'extrusion') && <label className="space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Classes</span>
                  <input
                    type="number"
                    min={2}
                    max={9}
                    value={classCount}
                    onChange={(event) => setClassCount(Number(event.target.value))}
                    className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                  />
                </label>}
                {kind === 'extrusion' && <label className="space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Height ×</span>
                  <input
                    type="number"
                    min={0.01}
                    step={0.5}
                    value={heightMultiplier}
                    onChange={(event) => setHeightMultiplier(Number(event.target.value) || 1)}
                    className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                  />
                </label>}
                {kind === 'hexbin' && <label className="space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Cell size</span>
                  <select
                    value={hexCellSize}
                    onChange={(event) => setHexCellSize(Number(event.target.value))}
                    className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                  >
                    <option value={5000}>5 km</option>
                    <option value={2000}>2 km</option>
                    <option value={1000}>1 km</option>
                    <option value={500}>500 m</option>
                    <option value={250}>250 m</option>
                    <option value={100}>100 m</option>
                  </select>
                </label>}
                {kind === 'hexbin' && <label className="space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Aggregate</span>
                  <select
                    value={hexAggregate}
                    onChange={(event) => setHexAggregate(event.target.value as HexbinAggregate)}
                    className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                  >
                    <option value="count">Count</option>
                    <option value="sum">Sum of field</option>
                    <option value="avg">Mean of field</option>
                  </select>
                </label>}
                <label className="space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Palette</span>
                  <select
                    value={paletteId}
                    onChange={(event) => setPaletteId(event.target.value)}
                    className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                  >
                    {SEQUENTIAL_PALETTES.map((palette) => (
                      <option key={palette.id} value={palette.id}>{palette.name}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            {kind === 'glyph_grid' && (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <label className="space-y-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Shape</span>
                    <select
                      value={glyphMode}
                      onChange={(event) => setGlyphMode(event.target.value as 'grid' | 'hex')}
                      className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    >
                      <option value="grid">Squares</option>
                      <option value="hex">Hexagons</option>
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Glyph</span>
                    <select
                      value={glyphType}
                      onChange={(event) => setGlyphType(event.target.value as GlyphGridGlyph)}
                      className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    >
                      <option value="density">Density fill</option>
                      <option value="circle">Proportional circle</option>
                      <option value="pie">Pie</option>
                      <option value="donut">Donut</option>
                      <option value="bars">Bars</option>
                      <option value="radial">Radial bars</option>
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Cell {glyphCellSize}px</span>
                    <input
                      type="range"
                      min={24}
                      max={128}
                      step={4}
                      value={glyphCellSize}
                      onChange={(event) => setGlyphCellSize(Number(event.target.value))}
                      className="h-8 w-full"
                    />
                  </label>
                </div>

                {(glyphType === 'density' || glyphType === 'circle') && (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Aggregate</span>
                      <select
                        value={glyphAggregate}
                        onChange={(event) => setGlyphAggregate(event.target.value as 'count' | 'sum' | 'avg')}
                        className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                      >
                        <option value="count">Count</option>
                        <option value="sum">Sum of field</option>
                        <option value="avg">Mean of field</option>
                      </select>
                    </label>
                    {glyphType === 'density' && (
                      <label className="space-y-1">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Palette</span>
                        <select
                          value={paletteId}
                          onChange={(event) => setPaletteId(event.target.value)}
                          className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                        >
                          {SEQUENTIAL_PALETTES.map((palette) => (
                            <option key={palette.id} value={palette.id}>{palette.name}</option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                )}

                {['pie', 'donut', 'bars', 'radial'].includes(glyphType) && (
                  <div className="space-y-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Glyph fields ({glyphFields.length}/6)
                    </span>
                    <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-slate-200 bg-white p-1.5">
                      {fields.map((name) => {
                        const checked = glyphFields.includes(name);
                        return (
                          <label key={name} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!checked && glyphFields.length >= 6}
                              onChange={() =>
                                setGlyphFields((current) =>
                                  checked ? current.filter((item) => item !== name) : [...current, name])
                              }
                              className="h-3 w-3"
                            />
                            {checked && (
                              <span
                                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                                style={{ backgroundColor: CATEGORICAL_PALETTE[glyphFields.indexOf(name) % CATEGORICAL_PALETTE.length] }}
                              />
                            )}
                            <span className="truncate">{name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                <p className="text-[11px] leading-relaxed text-slate-400">
                  Screen-space glyphs re-aggregate as you pan and zoom. Click a cell to select its features.
                  Not included in map style exports.
                </p>
              </div>
            )}

            {kind === 'bivariate' && (
              <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                <label className="space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Field Y</span>
                  <select
                    value={fieldY}
                    onChange={(event) => setFieldY(event.target.value)}
                    className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                  >
                    <option value="">Choose field…</option>
                    {fields.filter((name) => name !== field).map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Palette</span>
                  <select
                    value={bivariatePaletteId}
                    onChange={(event) => setBivariatePaletteId(event.target.value)}
                    className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                  >
                    {BIVARIATE_PALETTES.map((palette) => (
                      <option key={palette.id} value={palette.id}>{palette.name}</option>
                    ))}
                  </select>
                </label>
                <div
                  className="grid shrink-0 grid-cols-3 gap-px rounded border border-slate-200 p-px"
                  title="Palette preview: X →, Y ↑"
                >
                  {[2, 1, 0].flatMap((row) =>
                    [0, 1, 2].map((column) => (
                      <span
                        key={`${row}-${column}`}
                        className="h-2.5 w-2.5"
                        style={{ backgroundColor: getBivariatePalette(bivariatePaletteId).colors[row * 3 + column] }}
                      />
                    ))
                  )}
                </div>
              </div>
            )}

            {kind === 'hexbin' && (
              <button
                type="button"
                disabled={hexbinGenerating || !canApply}
                onClick={() => {
                  if (!selectedLayer) return;
                  const hexLayerId = `${selectedLayer.id}-hexbin`;
                  const existing = mapLayers.find((l) => l.id === hexLayerId);
                  if (existing) removeMapLayer(hexLayerId);
                  setHexbinGenerating(true);
                  generateHexbins(selectedLayer, {
                    cellSize: hexCellSize,
                    aggregate: hexAggregate,
                    field: hexAggregate === 'count' ? undefined : field,
                  })
                    .then(({ featureCollection: hexGeojson, method, resolution, cellEdgeMetres }) => {
                      setHexbinMethod({ method, resolution, cellEdgeMetres });
                      if (!hexGeojson.features.length) return;
                      const valueProfile = profileGeoJsonField(hexGeojson.features, 'value');
                      const hexVis = valueProfile.kind === 'numeric'
                        ? buildChoroplethVisualisation({ field: 'value', profile: valueProfile, method: 'quantile', classCount: 5, palette: getPalette(paletteId).colors })
                        : undefined;
                      addMapLayer({
                        id: hexLayerId,
                        name: `${selectedLayer.name} (hexbin)`,
                        geojson: hexGeojson,
                        visible: selectedLayer.visible,
                        sourceNodeId: selectedLayer.sourceNodeId,
                        sourceKind: 'h3',
                        opacity: 0.75,
                        visualisation: hexVis,
                        legend: hexVis ? buildLegend(hexVis) : undefined,
                      });
                      updateMapLayer(selectedLayer.id, { hexbinLayerId: hexLayerId });
                    })
                    .catch((err: any) => {
                      console.error('Hexbin generation failed:', err);
                      addToast({ type: 'error', message: `Hexbin failed: ${err?.message || err}` });
                    })
                    .finally(() => setHexbinGenerating(false));
                }}
                className="flex h-7 w-full items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                {hexbinGenerating ? 'Generating…' : 'Regenerate hexbins'}
              </button>
            )}

            {/* Which grid produced the cells changes what the counts mean, so
                it is stated rather than left to be inferred from the shapes. */}
            {kind === 'hexbin' && hexbinMethod && (
              <p className="text-[10px] leading-4 text-slate-500">
                {hexbinMethod.method === 'h3'
                  ? `Equal-area H3 cells at resolution ${hexbinMethod.resolution}${
                    hexbinMethod.cellEdgeMetres
                      ? ` (about ${hexbinMethod.cellEdgeMetres >= 1000
                        ? `${(hexbinMethod.cellEdgeMetres / 1000).toFixed(1)} km`
                        : `${Math.round(hexbinMethod.cellEdgeMetres)} m`} across)`
                      : ''
                  }. Counts are comparable across latitudes. H3 steps in fixed sizes, so nearby cell-size choices can give the same grid.`
                  : 'Web Mercator cells. Equal on screen but not on the ground, so counts are only comparable within a narrow band of latitude.'}
              </p>
            )}

            {kind !== 'simple' && kind === 'dot_density' && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Dot value</span>
                    <input
                      type="number"
                      min={1}
                      value={selectedLayer?.visualisation?.kind === 'dot_density' ? selectedLayer.visualisation.dotValue : 100}
                      onChange={(event) => {
                        if (!selectedLayer || selectedLayer.visualisation?.kind !== 'dot_density') return;
                        const vis = { ...selectedLayer.visualisation, dotValue: Number(event.target.value) };
                        updateLayerVisualisation(selectedLayer.id, vis, selectedLayer.legend);
                      }}
                      className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Radius</span>
                    <input
                      type="number"
                      min={0.5}
                      max={10}
                      step={0.5}
                      value={selectedLayer?.visualisation?.kind === 'dot_density' ? selectedLayer.visualisation.radius : 2.5}
                      onChange={(event) => {
                        if (!selectedLayer || selectedLayer.visualisation?.kind !== 'dot_density') return;
                        const vis = { ...selectedLayer.visualisation, radius: Number(event.target.value) };
                        updateLayerVisualisation(selectedLayer.id, vis, selectedLayer.legend);
                      }}
                      className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  disabled={dotDensityGenerating}
                  onClick={() => {
                    if (!selectedLayer || selectedLayer.visualisation?.kind !== 'dot_density') return;
                    const dotLayerId = `${selectedLayer.id}-dots`;
                    const existingDots = mapLayers.find((l) => l.id === dotLayerId);
                    if (existingDots) removeMapLayer(dotLayerId);
                    if (!selectedLayer.geojson) return;
                    setDotDensityGenerating(true);
                    generateDotDensityGeoJSON({ id: selectedLayer.id, geojson: selectedLayer.geojson }, {
                      field: selectedLayer.visualisation.field,
                      dotValue: selectedLayer.visualisation.dotValue,
                      color: selectedLayer.visualisation.color,
                      radius: selectedLayer.visualisation.radius,
                      opacity: selectedLayer.visualisation.opacity,
                    })
                      .then((dotsGeojson) => {
                        addMapLayer({
                          id: dotLayerId,
                          name: `${selectedLayer.name} (dots)`,
                          geojson: dotsGeojson,
                          visible: selectedLayer.visible,
                          sourceNodeId: selectedLayer.sourceNodeId,
                          sourceKind: 'manual',
                          color: selectedLayer.visualisation?.kind === 'dot_density' ? selectedLayer.visualisation.color : undefined,
                          opacity: selectedLayer.visualisation?.kind === 'dot_density' ? selectedLayer.visualisation.opacity : 0.65,
                          visualisation: selectedLayer.visualisation?.kind === 'dot_density' ? undefined : undefined,
                        });
                        updateMapLayer(selectedLayer.id, { dotDensityLayerId: dotLayerId });
                      })
                      .catch(() => {})
                      .finally(() => setDotDensityGenerating(false));
                  }}
                  className="flex h-7 w-full items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                >
                  {dotDensityGenerating ? 'Generating...' : 'Regenerate dots'}
                </button>
              </div>
            )}

            {geometryKind === 'point' && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Point Clustering</span>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={typeof selectedLayer?.clusterRadius === 'number'}
                      onChange={(event) => {
                        if (!selectedLayer) return;
                        updateMapLayer(selectedLayer.id, {
                          clusterRadius: event.target.checked ? 50 : undefined,
                          clusterMaxZoom: event.target.checked ? 16 : undefined,
                        });
                      }}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                    />
                    <span className="text-[11px] font-semibold text-slate-600">Cluster</span>
                  </label>
                </div>
                {typeof selectedLayer?.clusterRadius === 'number' && (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Radius</span>
                      <input
                        type="number"
                        min={10}
                        max={200}
                        value={selectedLayer.clusterRadius}
                        onChange={(event) => {
                          if (!selectedLayer) return;
                          updateMapLayer(selectedLayer.id, { clusterRadius: Number(event.target.value) });
                        }}
                        className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Max Zoom</span>
                      <input
                        type="number"
                        min={8}
                        max={24}
                        value={selectedLayer.clusterMaxZoom ?? 16}
                        onChange={(event) => {
                          if (!selectedLayer) return;
                          updateMapLayer(selectedLayer.id, { clusterMaxZoom: Number(event.target.value) });
                        }}
                        className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                      />
                    </label>
                  </div>
                )}
              </div>
            )}

            {kind !== 'simple' && <div className={cn('rounded-lg border p-3', canApply ? 'border-slate-200 bg-slate-50' : 'border-amber-200 bg-amber-50')}>
              <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <BarChart3 className="h-3.5 w-3.5" />
                Distribution
              </div>
              {canApply ? (
                <DistributionPreview
                  field={field}
                  profile={profile}
                  activeFilterKeys={activeFilterKeys}
                  onToggleFilter={toggleDistributionFilter}
                />
              ) : (
                <div className="text-[11px] font-medium text-amber-700">
                  {kind === 'choropleth' || kind === 'graduated_symbol'
                    ? 'Choose a numeric field.'
                    : kind === 'heatmap'
                      ? 'Heatmaps require point layers.'
                      : kind === 'label'
                        ? 'Choose a text field.'
                        : kind === 'dot_density' || kind === 'extrusion'
                          ? 'Pick a numeric field on a polygon layer.'
                          : kind === 'graduated_line'
                            ? 'Pick a numeric field on a line layer.'
                            : kind === 'hexbin'
                              ? 'Hexbins require a point layer (and a numeric field for sum/mean).'
                              : kind === 'bivariate'
                                ? 'Pick two numeric fields (X and Y).'
                                : 'Choose a categorical field.'}
                </div>
              )}
            </div>}

            {/* Only offered when the layer actually has date/time-like fields. */}
            {temporalCandidates.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Temporal Filter</div>
              <select
                value={temporalField}
                onChange={(event) => {
                  setTemporalField(event.target.value);
                }}
                className="mb-2 h-8 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              >
                {temporalCandidates.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>

              {temporalRange ? (
                <TemporalSlider
                  range={temporalRange}
                  field={temporalField}
                  currentFilter={activeFilters.find((f) => f.kind === 'temporal' && f.field === temporalField)}
                  onApply={(filter) => {
                    if (!selectedLayer) return;
                    const existing = visualAnalytics.datasets[selectedLayer.id]?.filters || [];
                    const withoutField = existing.filter((f) => !(f.kind === 'temporal' && f.field === temporalField));
                    setLayerFilters(selectedLayer.id, [...withoutField, filter]);
                  }}
                />
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      value={temporalStart}
                      onChange={(event) => setTemporalStart(event.target.value)}
                      className="h-8 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    />
                    <input
                      type="date"
                      value={temporalEnd}
                      onChange={(event) => setTemporalEnd(event.target.value)}
                      className="h-8 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={applyTemporalFilter}
                    disabled={!temporalField || (!temporalStart && !temporalEnd)}
                    className="mt-2 w-full rounded-md border border-slate-200 bg-slate-900 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Apply Date Range
                  </button>
                </>
              )}
            </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
