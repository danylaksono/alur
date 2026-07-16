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
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      const {
        ui,
        selectedNodeId,
        removeNode,
        duplicateNode,
        setSelectedNodeId,
        isManualSQL,
        setIsManualSQL,
        openDrawerTab,
      } = useStore.getState();
      const workflowVisible = ui.drawerMode !== 'collapsed' && ui.activeDrawerTab === 'workflow';

      if ((e.key === 'Delete' || e.key === 'Backspace') && workflowVisible && selectedNodeId) {
        removeNode(selectedNodeId);
        setSelectedNodeId(null);
        e.preventDefault();
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
