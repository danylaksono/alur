import { LayerManager } from '../LayerManager';
import { VisualisationPanel } from '../Visualisation/VisualisationPanel';
import { ErrorBoundary } from '../ErrorBoundary';

/**
 * Layer list and the style editor for the selected layer share one scroll
 * column, so neither is squeezed into a fixed half of the panel.
 */
export const LayersTab = () => (
  <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
    <ErrorBoundary name="Layer Manager">
      <LayerManager />
    </ErrorBoundary>
    <div className="border-t">
      <ErrorBoundary name="Visualisation Panel">
        <VisualisationPanel />
      </ErrorBoundary>
    </div>
  </div>
);
