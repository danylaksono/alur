import { lazy, Suspense } from 'react';
import { useStore } from '../../store/useStore';
import { ChartPanel } from '../Charts/ChartPanel';
import { ErrorBoundary } from '../ErrorBoundary';
import { LayersTab } from './LayersTab';

const Chat = lazy(() => import('../Chat').then((module) => ({ default: module.Chat })));

export const LeftPanel = () => {
  const activeRailTab = useStore((s) => s.ui.activeRailTab);
  const isPanelCollapsed = useStore((s) => s.ui.isPanelCollapsed);

  if (isPanelCollapsed) return null;

  return (
    <aside className="z-30 flex w-96 shrink-0 flex-col overflow-hidden border-r bg-white">
      {activeRailTab === 'layers' ? (
        <ErrorBoundary name="Layers Panel">
          <LayersTab />
        </ErrorBoundary>
      ) : activeRailTab === 'charts' ? (
        <ErrorBoundary name="Chart Panel">
          <ChartPanel />
        </ErrorBoundary>
      ) : (
        <ErrorBoundary name="Chat">
          <Suspense fallback={<div className="p-4 text-xs text-slate-400" role="status">Loading copilot…</div>}><Chat /></Suspense>
        </ErrorBoundary>
      )}
    </aside>
  );
};
