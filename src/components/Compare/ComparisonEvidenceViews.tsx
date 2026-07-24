import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Focus, Minus, Plus } from 'lucide-react';
import { useStore } from '../../store/useStore';
import type { ComparisonAlignedRecord, ComparisonResult, ComparisonSpec } from '../../types/visualAnalytics';
import { cn } from '../../utils/cn';
import { getBasemap } from '../../utils/basemaps';

type Camera = { longitude: number; latitude: number; zoom: number };
type Extent = [[number, number], [number, number]];

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const geometryCoordinates = (geometry: GeoJSON.Geometry | null): number[][] => {
  if (!geometry) return [];
  if (geometry.type === 'GeometryCollection') return geometry.geometries.flatMap(geometryCoordinates);
  const flatten = (value: unknown): number[][] => {
    if (!Array.isArray(value)) return [];
    if (value.length >= 2 && finite(value[0]) && finite(value[1])) return [[value[0], value[1]]];
    return value.flatMap(flatten);
  };
  return flatten(geometry.coordinates);
};

const extentForCollections = (collections: GeoJSON.FeatureCollection[]): Extent | null => {
  const points = collections.flatMap((collection) => collection.features.flatMap((feature) => geometryCoordinates(feature.geometry)));
  if (!points.length) return null;
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
};

const cameraForExtent = (extent: Extent | null): Camera => {
  if (!extent) return { longitude: 0, latitude: 20, zoom: 1.5 };
  const [[west, south], [east, north]] = extent;
  const longitude = (west + east) / 2;
  const latitude = (south + north) / 2;
  const span = Math.max(Math.abs(east - west), Math.abs(north - south) * 1.7, 0.0001);
  return { longitude, latitude, zoom: Math.max(1, Math.min(14, Math.log2(320 / span))) };
};

const valueRange = (collections: GeoJSON.FeatureCollection[], property = '__alur_value') => {
  const values = collections.flatMap((collection) => collection.features.map((feature) => feature.properties?.[property])).filter(finite);
  return values.length ? { min: Math.min(...values), max: Math.max(...values) } : { min: 0, max: 1 };
};

const colourExpression = (range: { min: number; max: number }, fallback: string, difference: boolean): maplibregl.ExpressionSpecification | string => {
  if (difference) {
    const magnitude = Math.max(Math.abs(range.min), Math.abs(range.max), 1e-9);
    return ['case', ['==', ['typeof', ['get', '__alur_value']], 'number'], ['interpolate', ['linear'], ['to-number', ['get', '__alur_value']], -magnitude, '#b2182b', 0, '#f7f7f7', magnitude, '#2166ac'], '#d1d5db'] as unknown as maplibregl.ExpressionSpecification;
  }
  if (range.min === range.max) return fallback;
  return ['case', ['==', ['typeof', ['get', '__alur_value']], 'number'], ['interpolate', ['linear'], ['to-number', ['get', '__alur_value']], range.min, '#deebf7', range.max, '#08519c'], '#d1d5db'] as unknown as maplibregl.ExpressionSpecification;
};

const ComparisonMapCell = ({
  title,
  accent,
  data,
  range,
  difference,
  camera,
  selectedKey,
  onCameraChange,
  onSelectKey,
}: {
  title: string;
  accent: string;
  data: GeoJSON.FeatureCollection;
  range: { min: number; max: number };
  difference: boolean;
  camera: Camera;
  selectedKey?: string;
  onCameraChange: (camera: Camera) => void;
  onSelectKey?: (key: string) => void;
}) => {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const syncing = useRef(false);
  const [ready, setReady] = useState(false);
  const selectedBasemapId = useStore((state) => state.selectedBasemapId);

  useEffect(() => {
    if (!container.current) return;
    const instance = new maplibregl.Map({
      container: container.current,
      style: getBasemap(selectedBasemapId).styleUrl,
      center: [camera.longitude, camera.latitude],
      zoom: camera.zoom,
      attributionControl: { compact: true },
    });
    map.current = instance;
    const sourceId = 'comparison-source';
    const layerIds = ['comparison-fill', 'comparison-line', 'comparison-point'];
    instance.on('load', () => {
      instance.addSource(sourceId, { type: 'geojson', data });
      const colour = colourExpression(range, accent, difference);
      instance.addLayer({ id: layerIds[0], type: 'fill', source: sourceId, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': colour, 'fill-opacity': 0.78, 'fill-outline-color': '#334155' } });
      instance.addLayer({ id: layerIds[1], type: 'line', source: sourceId, filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': colour, 'line-width': 3 } });
      instance.addLayer({ id: layerIds[2], type: 'circle', source: sourceId, filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': colour, 'circle-radius': 5, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } });
      instance.on('click', (event) => {
        const feature = instance.queryRenderedFeatures(event.point, { layers: layerIds })[0];
        const key = feature?.properties?.__alur_key;
        if (key === undefined || key === null) return;
        onSelectKey?.(String(key));
        const node = document.createElement('div');
        const heading = document.createElement('strong');
        heading.textContent = String(key);
        const value = document.createElement('div');
        const numeric = Number(feature.properties?.__alur_value);
        value.textContent = `${difference ? 'Delta' : 'Value'}: ${Number.isFinite(numeric) ? numeric.toLocaleString(undefined, { maximumFractionDigits: 3 }) : 'Missing'}`;
        node.append(heading, value);
        new maplibregl.Popup({ closeButton: true }).setLngLat(event.lngLat).setDOMContent(node).addTo(instance);
      });
      instance.once('idle', () => setReady(true));
    });
    instance.on('moveend', () => {
      if (syncing.current) return;
      const centre = instance.getCenter();
      onCameraChange({ longitude: centre.lng, latitude: centre.lat, zoom: instance.getZoom() });
    });
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(container.current);
    return () => { observer.disconnect(); instance.remove(); map.current = null; };
  }, [selectedBasemapId, data, range.min, range.max, difference, accent]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const centre = instance.getCenter();
    if (Math.abs(centre.lng - camera.longitude) < 1e-7 && Math.abs(centre.lat - camera.latitude) < 1e-7 && Math.abs(instance.getZoom() - camera.zoom) < 1e-7) return;
    syncing.current = true;
    instance.jumpTo({ center: [camera.longitude, camera.latitude], zoom: camera.zoom });
    requestAnimationFrame(() => { syncing.current = false; });
  }, [camera]);

  useEffect(() => {
    const instance = map.current;
    if (!instance?.isStyleLoaded()) return;
    const keyFilter: maplibregl.FilterSpecification = selectedKey
      ? ['==', ['get', '__alur_key'], selectedKey]
      : ['==', ['get', '__alur_key'], '__alur_no_selection__'];
    ['comparison-fill', 'comparison-line', 'comparison-point'].forEach((layerId) => {
      if (instance.getLayer(layerId)) instance.setPaintProperty(layerId, layerId.endsWith('point') ? 'circle-stroke-color' : layerId.endsWith('line') ? 'line-color' : 'fill-outline-color', selectedKey ? ['case', keyFilter, '#facc15', colourExpression(range, accent, difference)] : colourExpression(range, accent, difference));
    });
  }, [selectedKey, range.min, range.max, difference, accent]);

  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
    <header className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
      <span className="truncate text-xs font-bold text-slate-700"><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: accent }} />{title}</span>
      <span className="text-[9px] font-semibold text-slate-600">Shared navigation</span>
    </header>
    <div ref={container} data-comparison-map-ready={ready ? 'true' : 'false'} className="h-72 w-full bg-slate-100" aria-label={`${title} comparison map`} />
  </section>;
};

const differenceCollection = (spec: ComparisonSpec, result: ComparisonResult): GeoJSON.FeatureCollection | null => {
  if (result.differenceSpatialSample) return result.differenceSpatialSample.features;
  const sample = result.spatialSamples?.find((item) => item.operandId === spec.operands[0]?.id);
  const measure = spec.measures[0];
  if (!sample || !measure || spec.operands.length !== 2) return null;
  const deltas = new Map((result.alignedRecords || []).map((record) => [record.key, record.deltas[measure.id]]));
  return {
    type: 'FeatureCollection',
    features: sample.features.features.map((feature) => ({ ...feature, properties: { ...feature.properties, __alur_value: deltas.get(String(feature.properties?.__alur_key)) ?? null } })),
  };
};

export const ComparisonMapEvidence = ({ spec, result, differenceEligible, selectedKey, onSelectKey, mode, onModeChange }: {
  spec: ComparisonSpec;
  result: ComparisonResult;
  differenceEligible: boolean;
  selectedKey?: string;
  onSelectKey?: (key: string) => void;
  mode?: 'multiples' | 'difference';
  onModeChange?: (mode: 'multiples' | 'difference') => void;
}) => {
  const [uncontrolledMode, setUncontrolledMode] = useState<'multiples' | 'difference'>('multiples');
  const activeMode = mode ?? uncontrolledMode;
  const setMode = (nextMode: 'multiples' | 'difference') => { setUncontrolledMode(nextMode); onModeChange?.(nextMode); };
  const samples = result.spatialSamples || [];
  const difference = useMemo(() => differenceCollection(spec, result), [spec, result]);
  const collections = activeMode === 'difference' && difference ? [difference] : samples.map((sample) => sample.features);
  const extent = useMemo(() => extentForCollections(collections), [collections]);
  const home = useMemo(() => cameraForExtent(extent), [extent]);
  const [camera, setCamera] = useState<Camera>(home);
  useEffect(() => setCamera(home), [home.longitude, home.latitude, home.zoom]);
  const range = useMemo(() => valueRange(collections), [collections]);
  if (!samples.length) return <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-xs text-slate-600">No bounded spatial samples are available. Enable Map in the comparison views and ensure the spatial source has a geometry column.</div>;
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
      <div className="flex rounded-lg bg-slate-100 p-1" role="group" aria-label="Comparison map mode">
        <button type="button" onClick={() => setMode('multiples')} className={cn('rounded-md px-3 py-1.5 text-[10px] font-bold', activeMode === 'multiples' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600')}>Small multiples</button>
        <button type="button" disabled={!differenceEligible || !difference} onClick={() => setMode('difference')} className={cn('rounded-md px-3 py-1.5 text-[10px] font-bold disabled:opacity-35', activeMode === 'difference' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600')}>Difference B − A</button>
      </div>
      <div className="flex items-center rounded-lg border border-slate-200" role="group" aria-label="Shared map navigation">
        <button type="button" onClick={() => setCamera((current) => ({ ...current, zoom: current.zoom + 1 }))} className="p-2 text-slate-600" aria-label="Zoom all comparison maps in"><Plus className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={() => setCamera((current) => ({ ...current, zoom: current.zoom - 1 }))} className="border-l border-slate-200 p-2 text-slate-600" aria-label="Zoom all comparison maps out"><Minus className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={() => setCamera(home)} className="border-l border-slate-200 p-2 text-slate-600" aria-label="Fit all comparison maps"><Focus className="h-3.5 w-3.5" /></button>
      </div>
    </div>
    <div className={cn('grid gap-3', activeMode === 'multiples' && samples.length > 1 ? 'lg:grid-cols-2' : 'grid-cols-1')}>
      {activeMode === 'difference' && difference
        ? <ComparisonMapCell title={`${spec.operands[1]?.label} − ${spec.operands[0]?.label}`} accent="#475569" data={difference} range={range} difference camera={camera} selectedKey={selectedKey} onCameraChange={setCamera} onSelectKey={onSelectKey} />
        : samples.map((sample) => {
          const operand = spec.operands.find((item) => item.id === sample.operandId)!;
          return <ComparisonMapCell key={sample.operandId} title={operand.label} accent={operand.colour} data={sample.features} range={range} difference={false} camera={camera} selectedKey={selectedKey} onCameraChange={setCamera} onSelectKey={onSelectKey} />;
        })}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-900 px-3 py-2 text-[10px] text-white">
      <span>{activeMode === 'difference' ? 'Diverging scale centred on zero' : 'Shared sequential scale'} · {range.min.toLocaleString(undefined, { maximumFractionDigits: 2 })} to {range.max.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
      <span>{samples.some((sample) => sample.sampled) ? `Spatial display bounded to ${samples.map((sample) => sample.features.features.length.toLocaleString()).join(' / ')} features; summaries use full denominators.` : `${samples.reduce((sum, sample) => sum + sample.features.features.length, 0).toLocaleString()} mapped features`}</span>
    </div>
  </div>;
};

const displayValue = (value: number | null) => value === null || !Number.isFinite(value) ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: 3 });

export const ComparisonRecordsEvidence = ({ spec, result, selectedKey, onSelectKey, onUseAsFilter }: {
  spec: ComparisonSpec;
  result: ComparisonResult;
  selectedKey?: string;
  onSelectKey?: (key: string) => void;
  onUseAsFilter?: (record: ComparisonAlignedRecord) => void;
}) => {
  const records = result.alignedRecords || [];
  if (!records.length) return <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-xs text-slate-600">Choose entity-keyed alignment and map a stable key for every operand to inspect record deltas.</div>;
  const selected = records.find((record) => record.key === selectedKey);
  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
      <div><h3 className="text-xs font-bold text-slate-800">Entity-aligned record preview</h3><p className="mt-0.5 text-[10px] text-slate-500">Showing {records.length.toLocaleString()} of {(result.alignedRecordCount || records.length).toLocaleString()} aligned keys. Preview size never changes denominators.</p></div>
      {onUseAsFilter && <button type="button" disabled={!selected} onClick={() => selected && onUseAsFilter(selected)} className="rounded-lg bg-slate-900 px-3 py-2 text-[10px] font-bold text-white disabled:bg-slate-300">Use selected as filter</button>}
    </header>
    <div className="max-h-[560px] overflow-auto">
      <table className="w-full min-w-[760px] border-collapse text-left text-[10px]">
        <thead className="sticky top-0 z-10 bg-slate-50 text-slate-600"><tr><th className="px-3 py-2 font-bold">Key</th><th className="px-3 py-2 font-bold">Present in</th>{spec.measures.flatMap((measure) => spec.operands.map((operand) => <th key={`${measure.id}-${operand.id}`} className="px-3 py-2 text-right font-bold">{measure.label}<span className="block font-normal" style={{ color: operand.colour }}>{operand.label}</span></th>))}{spec.operands.length === 2 && spec.measures.map((measure) => <th key={`delta-${measure.id}`} className="px-3 py-2 text-right font-bold">Δ {measure.label}<span className="block font-normal text-slate-400">B − A</span></th>)}</tr></thead>
        <tbody>{records.map((record) => <tr key={record.key} onClick={() => onSelectKey?.(record.key)} className={cn('cursor-pointer border-t border-slate-100 hover:bg-blue-50/60', record.key === selectedKey && 'bg-blue-50')} aria-selected={record.key === selectedKey}><td className="max-w-48 truncate px-3 py-2 font-semibold text-slate-700">{record.key}</td><td className="px-3 py-2 text-slate-500">{record.presentOperandIds.length}/{spec.operands.length}</td>{spec.measures.flatMap((measure) => spec.operands.map((operand) => <td key={`${measure.id}-${operand.id}`} className="px-3 py-2 text-right tabular-nums text-slate-600">{displayValue(record.values[operand.id]?.[measure.id] ?? null)}</td>))}{spec.operands.length === 2 && spec.measures.map((measure) => <td key={`delta-${measure.id}`} className={cn('px-3 py-2 text-right font-bold tabular-nums', (record.deltas[measure.id] || 0) > 0 ? 'text-blue-700' : (record.deltas[measure.id] || 0) < 0 ? 'text-rose-700' : 'text-slate-500')}>{displayValue(record.deltas[measure.id])}</td>)}</tr>)}</tbody>
      </table>
    </div>
    {result.alignedRecordsTruncated && <p className="border-t border-amber-100 bg-amber-50 px-4 py-2 text-[10px] text-amber-800">Preview bounded to {records.length.toLocaleString()} records. Export or source records are not embedded in the project manifest.</p>}
  </section>;
};
