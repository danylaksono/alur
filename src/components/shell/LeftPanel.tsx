import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import { ChartPanel } from '../Charts/ChartPanel';
import { ErrorBoundary } from '../ErrorBoundary';
import { LayersTab } from './LayersTab';
import { NodePalette } from './NodePalette';
import { CohortPanel } from '../Visualisation/CohortPanel';
import { ScorePanel } from '../Score/ScorePanel';
import { cn } from '../../utils/cn';

const Chat = lazy(() => import('../Chat').then((module) => ({ default: module.Chat })));

/**
 * One left column whose contents follow the focused destination. The rail
 * chooses what shows here; the panel keeps its position and its width.
 */
export const LeftPanel = () => {
  const activeRailTab = useStore((s) => s.ui.activeRailTab);
  const isPanelCollapsed = useStore((s) => s.ui.isPanelCollapsed);
  const isRailExpanded = useStore((s) => s.ui.isRailExpanded);
  const panelWidth = useStore((s) => s.ui.panelWidth);
  const setPanelWidth = useStore((s) => s.setPanelWidth);
  const [isResizing, setIsResizing] = useState(false);
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!isResizing) return;
    const handlePointerMove = (event: PointerEvent) => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (rect) setPanelWidth(event.clientX - rect.left);
    };
    const stopResize = () => setIsResizing(false);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    };
  }, [isResizing, setPanelWidth]);

  if (isPanelCollapsed) return null;

  return (
    <aside
      ref={rootRef}
      className={cn(
        // md:relative, not md:static — the resize handle is absolutely
        // positioned against this element, and a static parent would hand it
        // to the workspace container and fling it to the far edge.
        'absolute inset-y-0 z-30 flex shrink-0 flex-col overflow-hidden border-r bg-white shadow-xl md:relative md:inset-y-auto md:left-auto md:shadow-none',
        // Below md the panel overlays the workspace edge-to-edge, so the
        // dragged width is overridden rather than applied.
        isRailExpanded ? 'left-44 max-md:!w-[calc(100%-11rem)]' : 'left-12 max-md:!w-[calc(100%-3rem)]',
      )}
      style={{ width: panelWidth }}
      aria-label="Panel"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeRailTab === 'layers' ? (
          <ErrorBoundary name="Layers Panel">
            <LayersTab />
          </ErrorBoundary>
        ) : activeRailTab === 'charts' ? (
          <ErrorBoundary name="Chart Panel">
            <ChartPanel />
          </ErrorBoundary>
        ) : activeRailTab === 'nodes' ? (
          <ErrorBoundary name="Node Palette">
            <NodePalette />
          </ErrorBoundary>
        ) : activeRailTab === 'score' ? (
          <ErrorBoundary name="Score Panel">
            <ScorePanel />
          </ErrorBoundary>
        ) : activeRailTab === 'cohorts' ? (
          <ErrorBoundary name="Cohorts and bookmarks">
            <div className="min-h-0 flex-1 overflow-y-auto"><CohortPanel /></div>
          </ErrorBoundary>
        ) : (
          <ErrorBoundary name="Chat">
            <Suspense fallback={<div className="p-4 text-xs text-slate-400" role="status">Loading copilot…</div>}><Chat /></Suspense>
          </ErrorBoundary>
        )}
      </div>

      <div
        className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-slate-300 max-md:hidden"
        onPointerDown={(event) => {
          event.preventDefault();
          setIsResizing(true);
        }}
        title="Drag to resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize side panel"
      />
    </aside>
  );
};
