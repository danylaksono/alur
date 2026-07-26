import { useEffect } from 'react';
import { useStore } from '../store/useStore';

/**
 * Global keyboard shortcuts, scoped so node editing keys only fire while the
 * workflow canvas is actually visible in the bottom drawer.
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        const state = useStore.getState();
        state.setCommandPaletteOpen(!state.ui.isCommandPaletteOpen);
        e.preventDefault();
        return;
      }
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      const {
        ui,
        edges,
        selectedNodeId,
        removeNode,
        duplicateNode,
        setSelectedNodeId,
        onEdgesChange,
        isManualSQL,
        setIsManualSQL,
        openDrawerTab,
        undoAnalysis,
        redoAnalysis,
      } = useStore.getState();
      const workflowVisible = ui.drawerMode !== 'collapsed' && ui.activeDrawerTab === 'workflow';

      if (e.key === 'Escape' && ui.isPresentationMode) {
        useStore.getState().setPresentationMode(false);
        e.preventDefault();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) redoAnalysis();
        else undoAnalysis();
        e.preventDefault();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'y') {
        redoAnalysis();
        e.preventDefault();
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && workflowVisible) {
        if (selectedNodeId) {
          removeNode(selectedNodeId);
          setSelectedNodeId(null);
          e.preventDefault();
        } else {
          const selectedEdges = edges.filter((edge) => edge.selected);
          if (selectedEdges.length) {
            onEdgesChange(selectedEdges.map((edge) => ({ id: edge.id, type: 'remove' as const })));
            e.preventDefault();
          }
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'd' && workflowVisible && selectedNodeId) {
        duplicateNode(selectedNodeId, `node-${Date.now()}`);
        e.preventDefault();
      }

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'm') {
        setIsManualSQL(!isManualSQL);
        openDrawerTab('sql');
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
