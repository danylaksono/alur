import { lazy, Suspense } from 'react';
import { useStore } from '../../store/useStore';
import { ChartPanel } from '../Charts/ChartPanel';
import { ErrorBoundary } from '../ErrorBoundary';
import { LayersTab } from './LayersTab';
import { CohortPanel } from '../Visualisation/CohortPanel';

const Chat = lazy(() => import('../Chat').then((module) => ({ default: module.Chat })));

export const LeftPanel = () => {
  const activeRailTab = useStore((s) => s.ui.activeRailTab);
  const isPanelCollapsed = useStore((s) => s.ui.isPanelCollapsed);

  if (isPanelCollapsed) return null;

  return (
    <aside className="absolute inset-y-0 left-12 z-30 flex w-[calc(100%-3rem)] shrink-0 flex-col overflow-hidden border-r bg-white shadow-xl md:static md:w-96 md:shadow-none">
      {activeRailTab === 'layers' ? (
        <ErrorBoundary name="Layers Panel">
          <LayersTab />
        </ErrorBoundary>
      ) : activeRailTab === 'charts' ? (
        <ErrorBoundary name="Chart Panel">
          <ChartPanel />
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
