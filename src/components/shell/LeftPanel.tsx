import { useStore } from '../../store/useStore';
import { Chat } from '../Chat';
import { ChartPanel } from '../Charts/ChartPanel';
import { ErrorBoundary } from '../ErrorBoundary';
import { LayersTab } from './LayersTab';

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
          <Chat />
        </ErrorBoundary>
      )}
    </aside>
  );
};
