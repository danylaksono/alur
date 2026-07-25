import { lazy, Suspense } from 'react';
import { useStore } from '../../store/useStore';
import { ChartPanel } from '../Charts/ChartPanel';
import { ErrorBoundary } from '../ErrorBoundary';
import { LayersTab } from './LayersTab';
import { NodePalette } from './NodePalette';
import { CohortPanel } from '../Visualisation/CohortPanel';
import { cn } from '../../utils/cn';

const Chat = lazy(() => import('../Chat').then((module) => ({ default: module.Chat })));

/**
 * One left column whose contents follow the focused destination. The rail
 * chooses what shows here; the panel itself never moves or changes width.
 */
export const LeftPanel = () => {
  const activeRailTab = useStore((s) => s.ui.activeRailTab);
  const isPanelCollapsed = useStore((s) => s.ui.isPanelCollapsed);
  const isRailExpanded = useStore((s) => s.ui.isRailExpanded);

  if (isPanelCollapsed) return null;

  return (
    <aside
      className={cn(
        'absolute inset-y-0 z-30 flex shrink-0 flex-col overflow-hidden border-r bg-white shadow-xl md:static md:w-96 md:shadow-none',
        isRailExpanded ? 'left-44 w-[calc(100%-11rem)]' : 'left-12 w-[calc(100%-3rem)]',
      )}
      aria-label="Panel"
    >
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
      ) : activeRailTab === 'cohorts' ? (
        <ErrorBoundary name="Cohorts and bookmarks">
          <div className="min-h-0 flex-1 overflow-y-auto"><CohortPanel /></div>
        </ErrorBoundary>
      ) : (
        <ErrorBoundary name="Chat">
          <Suspense fallback={<div className="p-4 text-xs text-slate-400" role="status">Loading copilot…</div>}><Chat /></Suspense>
        </ErrorBoundary>
      )}
    </aside>
  );
};
