import { useState, type DragEvent } from 'react';
import { useStore } from '../../store/useStore';
import { useWorkflowSync } from '../../hooks/useWorkflowSync';
import { useSchemaFetcher } from '../../hooks/useSchemaFetcher';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { ingestFile, isIngestableFile } from '../../services/dataIngestion';
import { MapView } from '../Map/MapView';
import { MapEmptyState } from './MapEmptyState';
import { ToastContainer } from '../Toast';
import { ErrorBoundary } from '../ErrorBoundary';
import { Header } from './Header';
import { LeftRail } from './LeftRail';
import { LeftPanel } from './LeftPanel';
import { BottomDrawer } from './BottomDrawer';
import { ContextInspector } from './ContextInspector';
import { SettingsDialog } from './SettingsDialog';
import { AboutDialog } from './AboutDialog';
import { GlobalLoadingOverlay } from '../GlobalLoadingOverlay';
import { CommandPalette } from './CommandPalette';
import { DatasetOverviewDialog } from '../Visualisation/DatasetOverviewDialog';
import { RecoveryDialog } from './RecoveryDialog';
import { CompareWorkspace } from '../Compare/CompareWorkspace';
import { ExplainWorkspace } from '../Explain/ExplainWorkspace';
import { AnalysisContextBar } from './AnalysisContextBar';
import { EvidenceTray } from './EvidenceTray';

export const AppShell = () => {
  const drawerMode = useStore((s) => s.ui.drawerMode);
  const isGlobalLoading = useStore((s) => Object.keys(s.loadingOperations).length > 0);
  const isMaximized = drawerMode === 'maximized';
  const workspaceMode = useStore((s) => s.ui.workspaceMode);
  const isExplain = workspaceMode === 'explain' || workspaceMode === 'board';
  const isCompare = workspaceMode === 'compare';
  const isPresenting = useStore((s) => s.ui.isPresentationMode);
  const [isDragOver, setIsDragOver] = useState(false);

  useWorkflowSync();
  useSchemaFetcher();
  useKeyboardShortcuts();

  const handleDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);
  };

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter((file) => isIngestableFile(file.name));
    if (!files.length) {
      useStore.getState().addToast({ type: 'error', message: 'Drop a Parquet, CSV, JSON, or GeoJSON file to load it.' });
      return;
    }
    for (const file of files) {
      await ingestFile(file);
    }
  };

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background" aria-busy={isGlobalLoading}>
      {!isPresenting && <Header />}
      {!isExplain && <AnalysisContextBar />}

      <div className="relative flex min-h-0 flex-1">
        {!isExplain && !isCompare && <LeftRail />}
        {!isExplain && !isCompare && <LeftPanel />}

        {isCompare && <CompareWorkspace />}
        {isExplain && <ExplainWorkspace />}
        {!isCompare && !isExplain && <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* The map stays mounted at all times; a maximized drawer just squeezes
              it to a sliver instead of unmounting (map init is expensive). */}
          <div className="relative flex min-h-0 overflow-hidden" style={{ flexGrow: isMaximized ? 0 : 1, flexBasis: isMaximized ? 2 : '0%' }}>
          <div
            className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
            onDragOver={handleDragOver}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
          >
            <ErrorBoundary
              name="Map"
              fallback={
                <div className="flex h-full items-center justify-center bg-slate-100 text-xs italic text-slate-400">
                  Map failed to load
                </div>
              }
            >
              <MapView />
            </ErrorBoundary>
            <MapEmptyState />
            {isDragOver && (
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed border-primary bg-primary/5">
                <span className="rounded-lg bg-white px-4 py-2 text-xs font-semibold text-primary shadow">
                  Drop Parquet / CSV / JSON / GeoJSON to add it to the map
                </span>
              </div>
            )}
          </div>
          <ContextInspector />
          </div>

          <EvidenceTray />
          <BottomDrawer />
        </main>}
      </div>

      <SettingsDialog />
      <AboutDialog />
      <ToastContainer />
      <GlobalLoadingOverlay />
      <CommandPalette />
      <DatasetOverviewDialog />
      <RecoveryDialog />
    </div>
  );
};
