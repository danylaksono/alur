import { useStore, type MapLayer } from '../store/useStore';
import type { MapEvidenceCapture } from '../types/story';
import type { ExplainCard, KpiResult, KpiSpec, VisualChartSpec, VisualFilter } from '../types/visualAnalytics';
import { compactChartEvidence, type ChartEvidenceCapture, type ChartExportData } from './chartExportService';
import { chartDatasetId } from '../utils/datasetSource';
import { captureMapSnapshot } from './mapRegistry';
import {
  lensAssumptions,
  lensCaveats,
  lensEvidenceRows,
  lensEvidenceTitle,
  type LensConfig,
  type LensCoverage,
} from './lensService';

/**
 * Pins the current map view to the explanation.
 *
 * Lives in Explore rather than in the Report workspace because that is where
 * the map exists — the same rule charts, KPIs and comparisons already follow.
 * Capture has to happen while the thing being captured is on screen.
 */
export const pinMapEvidence = async (): Promise<boolean> => {
  const state = useStore.getState();
  const snapshot = await captureMapSnapshot();

  if (!snapshot) {
    state.addToast({ type: 'warning', message: 'The map is not available to capture right now.' });
    return false;
  }

  const visibleLayers = state.mapLayers.filter((layer) => layer.visible);
  const capture: MapEvidenceCapture = {
    ...snapshot,
    basemapId: state.selectedBasemapId,
    layers: visibleLayers.map((layer) => ({ name: layer.name, legend: layer.legend })),
  };

  const card: ExplainCard = {
    id: `explain-map-${Date.now()}`,
    sectionId: 'evidence',
    kind: 'map',
    title: visibleLayers.length ? `Map — ${visibleLayers.map((layer) => layer.name).join(', ')}`.slice(0, 90) : 'Map view',
    width: 12,
    height: 'tall',
    behaviour: 'frozen',
    frozenValues: capture,
    provenance: {
      capturedAt: snapshot.capturedAt,
      datasetIds: visibleLayers.map((layer) => layer.id),
      sourceVersions: Object.fromEntries(visibleLayers.map((layer) => [layer.id, state.datasetRegistry[layer.id]?.sourceUpdatedAt])),
      filtersByDataset: Object.fromEntries(
        visibleLayers
          .map((layer) => [layer.id, state.visualAnalytics.datasets[layer.id]?.filters || []] as const)
          .filter(([, filters]) => filters.length),
      ),
      caveats: snapshot.failureReason ? [snapshot.failureReason] : [],
    },
  };

  state.addExplainCard(card);
  state.addToast({
    type: snapshot.failureReason ? 'warning' : 'success',
    message: snapshot.failureReason
      ? `Pinned the map view, but without an image: ${snapshot.failureReason}`
      : 'Pinned the current map view to your explanation.',
  });
  return !snapshot.failureReason;
};

/**
 * Pins what a lens is reading to the explanation.
 *
 * Pinned as a table, not a picture: the numbers on the bars are the finding,
 * and a frozen table already renders in the report and in a shared story, so
 * the reading survives being sent to someone else. The caveats travel with it
 * — a warning the analyst saw on screen but the reader of the report does not
 * is worse than no warning at all.
 */
export const pinLensEvidence = (
  layer: MapLayer,
  config: LensConfig,
  reading: { center: [number, number]; radius?: number; bins?: unknown },
  coverage: LensCoverage,
): boolean => {
  const state = useStore.getState();
  const rows = lensEvidenceRows(reading.bins, config);
  if (!rows.length) {
    state.addToast({ type: 'warning', message: 'The lens has nothing under it to pin.' });
    return false;
  }

  const filters = state.visualAnalytics.datasets[layer.id]?.filters || [];
  state.addExplainCard({
    id: `explain-lens-${Date.now()}`,
    sectionId: 'evidence',
    kind: 'table',
    title: lensEvidenceTitle(config, layer.name),
    width: 6,
    height: 'standard',
    behaviour: 'frozen',
    frozenValues: rows,
    provenance: {
      capturedAt: Date.now(),
      datasetIds: [layer.id],
      sourceVersions: { [layer.id]: state.datasetRegistry[layer.id]?.sourceUpdatedAt },
      filtersByDataset: filters.length ? { [layer.id]: filters } : {},
      caveats: lensCaveats(config, coverage),
      assumptions: lensAssumptions(config, reading.center, reading.radius),
    },
  });
  state.addToast({ type: 'success', message: 'Pinned this lens reading to your explanation.' });
  return true;
};

/** Provenance for evidence read from one dataset under its current filters. */
const datasetProvenance = (datasetId: string, filters: VisualFilter[], caveats: string[] = []) => ({
  capturedAt: Date.now(),
  datasetIds: [datasetId],
  sourceVersions: { [datasetId]: useStore.getState().datasetRegistry[datasetId]?.sourceUpdatedAt },
  filtersByDataset: filters.length ? { [datasetId]: filters } : {},
  caveats,
});

/**
 * Pins a chart's plotted values to the explanation.
 *
 * The spec is copied, not referenced: editing or deleting the chart afterwards
 * must not change what the report says it showed.
 */
export const pinChartEvidence = (chart: VisualChartSpec, filters: VisualFilter[], data: ChartExportData) => {
  const state = useStore.getState();
  const datasetId = chartDatasetId(chart);
  const compact = compactChartEvidence(data);
  const capture: ChartEvidenceCapture = { chart: structuredClone(chart), data: structuredClone(compact), filters: structuredClone(filters) };
  state.addExplainCard({
    id: `explain-chart-${Date.now()}`,
    sectionId: 'evidence',
    kind: 'chart',
    referenceId: chart.id,
    title: chart.title,
    width: chart.facetField ? 12 : 6,
    height: 'standard',
    behaviour: 'frozen',
    frozenValues: capture,
    provenance: datasetProvenance(datasetId, filters, compact !== data ? [`Scatter thinned to an even sample of its points for the report.`] : []),
  });
  state.addToast({ type: 'success', message: `Pinned ${chart.title} to your report.` });
};

const COMPARISON_LABELS: Record<KpiSpec['comparison'], string> = {
  none: '', total: 'the unfiltered total', 'previous-period': 'the previous period', cohort: 'the cohort',
};

/** The context a bare number loses: its denominator and what its change is measured against. */
export const kpiEvidenceCaption = (spec: KpiSpec, result: KpiResult) => [
  `${result.activeRows.toLocaleString()} of ${result.totalRows.toLocaleString()} rows`,
  result.delta !== null && spec.comparison !== 'none'
    ? `${result.delta > 0 ? '+' : ''}${(result.delta * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}% vs ${COMPARISON_LABELS[spec.comparison]}`
    : null,
].filter(Boolean).join(' · ');

export const pinKpiEvidence = (spec: KpiSpec, filters: VisualFilter[], result: KpiResult) => {
  const state = useStore.getState();
  if (result.value === null) {
    state.addToast({ type: 'warning', message: `${spec.title} has no value to pin.` });
    return;
  }
  state.addExplainCard({
    id: `explain-kpi-${Date.now()}`,
    sectionId: 'evidence',
    kind: 'kpi',
    referenceId: spec.id,
    title: spec.title,
    caption: kpiEvidenceCaption(spec, result),
    width: 3,
    height: 'compact',
    behaviour: 'frozen',
    frozenValues: result.value,
    provenance: datasetProvenance(spec.datasetId, filters),
  });
  state.addToast({ type: 'success', message: `Pinned ${spec.title} to your report.` });
};
