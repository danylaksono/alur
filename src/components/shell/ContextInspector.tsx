import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Scan, X } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useAnalyticsCommands } from '../../hooks/useAnalyticsCommands';
import { SelectionSummary } from '../Visualisation/SelectionSummary';
import { SelectionExplain } from '../Visualisation/SelectionExplain';
import { ErrorBoundary } from '../ErrorBoundary';

/** Set by the sheet, read by every overlay pinned to the bottom of the map. */
const CHROME_VAR = '--alur-map-chrome-bottom';

/**
 * Docked on desktop so evidence never obscures the map; a bottom sheet on
 * compact viewports where a side dock would leave too little map.
 *
 * As a sheet it opens collapsed — a one-line header with the count and the two
 * actions a selection is usually made for. Expanding trades map for detail, and
 * that trade is the user's to make: an auto-expanded sheet took 55% of the map
 * and pushed the legend off screen at the exact moment someone was asking what
 * a colour meant.
 */
export const ContextInspector = () => {
  const mapLayers = useStore((s) => s.mapLayers);
  const selectedLayerId = useStore((s) => s.selectedLayerId);
  const visualAnalytics = useStore((s) => s.visualAnalytics);
  const clearFeatureSelection = useStore((s) => s.clearFeatureSelection);
  const addToast = useStore((s) => s.addToast);
  const executeAnalyticsCommand = useAnalyticsCommands();
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLElement>(null);

  const selectedLayer = useMemo(
    () => mapLayers.find((layer) => layer.id === selectedLayerId) || null,
    [mapLayers, selectedLayerId]
  );
  const layerState = selectedLayer ? visualAnalytics.datasets[selectedLayer.id] : undefined;
  const selectedFeatureIds = layerState?.selectedFeatureIds || [];
  const filters = layerState?.filters || [];
  const isActive = Boolean(selectedLayer) && selectedFeatureIds.length > 0;

  // Publish the height this sheet occupies so the legend, coordinate readout
  // and MapLibre's own bottom controls can sit above it instead of under it.
  // Measured rather than assumed: the header wraps on narrow viewports, and a
  // hard-coded offset would be wrong exactly where space is tightest.
  useEffect(() => {
    const node = rootRef.current;
    const root = document.documentElement;
    if (!isActive || !node) {
      root.style.removeProperty(CHROME_VAR);
      return;
    }
    const publish = () => {
      // Docked (xl and up) the sheet is out of the map's flow entirely, so it
      // displaces nothing and the offset must stay zero.
      if (window.matchMedia('(min-width: 1280px)').matches) {
        root.style.setProperty(CHROME_VAR, '0px');
        return;
      }
      // Measured from the bottom of the positioning parent, not from the
      // sheet's own height — the sheet is inset from that edge, and an offset
      // that ignores the inset leaves the attribution overlapping its header.
      const parent = node.offsetParent;
      const occupied = parent
        ? parent.getBoundingClientRect().bottom - node.getBoundingClientRect().top
        : node.offsetHeight;
      root.style.setProperty(CHROME_VAR, `${Math.max(0, Math.round(occupied))}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    window.addEventListener('resize', publish);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', publish);
      root.style.removeProperty(CHROME_VAR);
    };
  }, [isActive]);

  if (!selectedLayer || !isActive) return null;

  const zoomToSelection = async () => {
    const result = await executeAnalyticsCommand({ type: 'focus-selection', datasetId: selectedLayer.id });
    if (!result.ok) addToast({ type: 'warning', message: result.message });
  };

  return (
    <aside
      ref={rootRef}
      className="pointer-events-auto absolute inset-x-2 bottom-2 z-20 flex max-h-[55%] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white/95 shadow-xl backdrop-blur xl:static xl:z-auto xl:h-full xl:max-h-none xl:w-80 xl:shrink-0 xl:rounded-none xl:border-y-0 xl:border-r-0 xl:bg-white xl:shadow-none"
    >
      <div className="flex shrink-0 items-center gap-1 border-b bg-slate-50/80 px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-600">
          Selection — {selectedLayer.name}
          <span className="ml-1.5 font-normal text-slate-500">
            {selectedFeatureIds.length.toLocaleString()} selected
          </span>
        </span>
        <button
          type="button"
          onClick={zoomToSelection}
          className="pressable rounded p-1 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-700"
          title="Zoom to selection"
          aria-label="Zoom to selection"
        >
          <Scan className="h-3.5 w-3.5" />
        </button>
        {/* Expansion is a sheet concern only; docked, the body is always open. */}
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="pressable rounded p-1 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-700 xl:hidden"
          title={expanded ? 'Collapse selection details' : 'Expand selection details'}
          aria-label={expanded ? 'Collapse selection details' : 'Expand selection details'}
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => clearFeatureSelection(selectedLayer.id)}
          className="pressable rounded p-1 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-700"
          title="Clear selection"
          aria-label="Clear selection"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className={expanded ? 'min-h-0 flex-1 overflow-y-auto' : 'hidden min-h-0 flex-1 overflow-y-auto xl:block'}>
        <ErrorBoundary name="Selection Summary">
          <SelectionSummary
            layer={selectedLayer}
            filters={filters}
            selectedFeatureIds={selectedFeatureIds}
          />
        </ErrorBoundary>
        <ErrorBoundary name="Selection Explain">
          <SelectionExplain layer={selectedLayer} selectedFeatureIds={selectedFeatureIds} />
        </ErrorBoundary>
      </div>
    </aside>
  );
};
