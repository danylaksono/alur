import type { VisualChartResult, VisualChartSpec, VisualFilter, VisualScatterResult, VisualTemporalResult } from '../types/visualAnalytics';
import { downloadBlob, downloadText, filenameTimestamp, rowsToCsv, safeFilename } from '../utils/download';
import { visualFilterLabel } from '../utils/visualFilters';

export type ChartExportData =
  | { kind: 'aggregate'; result: VisualChartResult }
  | { kind: 'facets'; results: Array<{ value: string; result: VisualChartResult }> }
  | { kind: 'temporal'; result: VisualTemporalResult }
  | { kind: 'scatter'; result: VisualScatterResult };

export type ChartExportMetadata = {
  title: string;
  aggregation: string;
  filters: string[];
  generatedAt: string;
};

export const chartExportMetadata = (chart: VisualChartSpec, filters: VisualFilter[], generatedAt = new Date()): ChartExportMetadata => ({
  title: chart.title,
  aggregation: chart.aggregation,
  filters: filters.map(visualFilterLabel),
  generatedAt: generatedAt.toISOString(),
});

export const buildChartCsv = (chart: VisualChartSpec, filters: VisualFilter[], data: ChartExportData, generatedAt = new Date()) => {
  const metadata = chartExportMetadata(chart, filters, generatedAt);
  const prefix = [
    `# title: ${metadata.title}`,
    `# aggregation: ${metadata.aggregation}`,
    `# filters: ${metadata.filters.join(' AND ') || 'none'}`,
    `# generated_at: ${metadata.generatedAt}`,
    '',
  ].join('\r\n');
  if (data.kind === 'temporal') {
    return prefix + rowsToCsv(
      ['period_start', 'period_end', 'period_label', 'series', 'value', 'row_count', 'total_value', 'total_row_count', 'grain'],
      data.result.series.flatMap((series) => series.points.map((point) => [point.bucketStart, point.bucketEnd, point.label, series.label, point.value, point.count, point.totalValue, point.totalCount, data.result.grain])),
    );
  }
  if (data.kind === 'scatter') {
    return prefix + rowsToCsv(['x', 'y', 'in_active_context'], data.result.points.map((point) => [point.x, point.y, point.inContext]));
  }
  if (data.kind === 'facets') {
    return prefix + rowsToCsv(
      ['facet', 'label', 'value', 'row_count', 'total_value', 'total_row_count'],
      data.results.flatMap(({ value: facet, result }) => result.data.map((datum) => [facet, datum.label, datum.value, datum.count, datum.totalValue, datum.totalCount])),
    );
  }
  return prefix + rowsToCsv(
    ['label', 'value', 'row_count', 'total_value', 'total_row_count'],
    data.result.data.map((datum) => [datum.label, datum.value, datum.count, datum.totalValue, datum.totalCount]),
  );
};

const chartFileBase = (chart: VisualChartSpec, date = new Date()) => `${safeFilename(chart.title, 'chart')}-${filenameTimestamp(date)}`;

export const downloadChartCsv = (chart: VisualChartSpec, filters: VisualFilter[], data: ChartExportData, date = new Date()) => {
  downloadText(buildChartCsv(chart, filters, data, date), `${chartFileBase(chart, date)}.csv`, 'text/csv;charset=utf-8');
};

export const serialiseChartSvg = (svg: SVGSVGElement, metadata: ChartExportMetadata) => {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const metadataNode = document.createElementNS('http://www.w3.org/2000/svg', 'metadata');
  metadataNode.textContent = JSON.stringify(metadata);
  clone.insertBefore(metadataNode, clone.firstChild);
  return new XMLSerializer().serializeToString(clone);
};

export const downloadChartSvg = (root: HTMLElement, chart: VisualChartSpec, filters: VisualFilter[], date = new Date()) => {
  const svg = root.querySelector('svg');
  if (!svg) throw new Error('SVG export is unavailable for this chart type; use CSV instead.');
  downloadText(serialiseChartSvg(svg, chartExportMetadata(chart, filters, date)), `${chartFileBase(chart, date)}.svg`, 'image/svg+xml;charset=utf-8');
};

const canvasBlob = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('The browser could not encode this chart image.')), 'image/png');
});

const svgPngBlob = (svg: SVGSVGElement, metadata: ChartExportMetadata) => new Promise<Blob>((resolve, reject) => {
  const serialised = serialiseChartSvg(svg, metadata);
  const source = new Blob([serialised], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(source);
  const image = new Image();
  image.onload = () => {
    const rect = svg.getBoundingClientRect();
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width || svg.viewBox.baseVal.width || 600));
    const height = Math.max(1, Math.round(rect.height || svg.viewBox.baseVal.height || 360));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext('2d');
    if (!context) { URL.revokeObjectURL(url); reject(new Error('Canvas rendering is unavailable in this browser.')); return; }
    context.scale(ratio, ratio);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    URL.revokeObjectURL(url);
    void canvasBlob(canvas).then(resolve, reject);
  };
  image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('The chart SVG could not be rendered as PNG.')); };
  image.src = url;
});

export const downloadChartPng = async (root: HTMLElement, chart: VisualChartSpec, filters: VisualFilter[], date = new Date()) => {
  const canvas = root.querySelector('canvas');
  const svg = root.querySelector('svg');
  if (!canvas && !svg) throw new Error('PNG export is unavailable for this chart type; use CSV instead.');
  const blob = canvas ? await canvasBlob(canvas) : await svgPngBlob(svg!, chartExportMetadata(chart, filters, date));
  downloadBlob(blob, `${chartFileBase(chart, date)}.png`);
};
