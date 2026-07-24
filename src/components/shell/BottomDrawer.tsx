import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Database, Maximize2, Minimize2, Terminal, Workflow } from 'lucide-react';
import { useStore, type DrawerTab } from '../../store/useStore';
import { useAttributeTable } from '../../hooks/useAttributeTable';
import { TableTab } from './TableTab';
import { SqlTab } from './SqlTab';
import { cn } from '../../utils/cn';

const WorkflowTab = lazy(() => import('./WorkflowTab').then((module) => ({ default: module.WorkflowTab })));

const DRAWER_TABS: Array<{ id: DrawerTab; icon: typeof Workflow; label: string }> = [
  { id: 'workflow', icon: Workflow, label: 'Workflow' },
  { id: 'table', icon: Database, label: 'Table' },
  { id: 'sql', icon: Terminal, label: 'SQL' },
];

export const BottomDrawer = () => {
  const drawerMode = useStore((s) => s.ui.drawerMode);
  const drawerHeight = useStore((s) => s.ui.drawerHeight);
  const activeDrawerTab = useStore((s) => s.ui.activeDrawerTab);
  const setDrawerMode = useStore((s) => s.setDrawerMode);
  const setDrawerHeight = useStore((s) => s.setDrawerHeight);
  const openDrawerTab = useStore((s) => s.openDrawerTab);
  const [isResizing, setIsResizing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // The attribute-table state lives here (not in TableTab) so it survives
  // drawer tab switches — e.g. run SQL, then inspect the rows in Table.
  const table = useAttributeTable();

  const isOpen = drawerMode !== 'collapsed';
  const isMaximized = drawerMode === 'maximized';

  useEffect(() => {
    if (!isResizing) return;

    const handlePointerMove = (event: PointerEvent) => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      setDrawerHeight(rect.bottom - event.clientY);
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
  }, [isResizing, setDrawerHeight]);

  return (
    <div
      ref={rootRef}
      className={cn('z-20 flex shrink-0 flex-col border-t bg-white', isMaximized && 'min-h-0 flex-1')}
      style={drawerMode === 'open' ? { height: drawerHeight } : undefined}
    >
      {drawerMode === 'open' && (
        <div
          className="h-1.5 shrink-0 cursor-row-resize bg-slate-100 transition-colors hover:bg-slate-300"
          onPointerDown={(e) => {
            e.preventDefault();
            setIsResizing(true);
          }}
          title="Drag to resize"
        />
      )}

      <div className="flex h-9 shrink-0 items-center justify-between border-b bg-slate-50 px-2">
        <div className="flex items-center gap-1">
          {DRAWER_TABS.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => openDrawerTab(id)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
                isOpen && activeDrawerTab === id
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-500 hover:bg-slate-200/60 hover:text-slate-700'
              )}
            >
              <Icon className="h-3 w-3" />
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          {isOpen && (
            <button
              type="button"
              onClick={() => setDrawerMode(isMaximized ? 'open' : 'maximized')}
              className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-200/60 hover:text-slate-700"
              title={isMaximized ? 'Restore drawer' : 'Maximize drawer'}
            >
              {isMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
          )}
          <button
            type="button"
            onClick={() => setDrawerMode(isOpen ? 'collapsed' : 'open')}
            className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-200/60 hover:text-slate-700"
            title={isOpen ? 'Collapse drawer' : 'Open drawer'}
          >
            {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="min-h-0 flex-1 overflow-hidden">
          {activeDrawerTab === 'workflow' ? (
            <Suspense fallback={<div className="p-4 text-xs text-slate-400" role="status">Loading workflow editor…</div>}><WorkflowTab /></Suspense>
          ) : activeDrawerTab === 'table' ? (
            <TableTab table={table} />
          ) : (
            <SqlTab setManualPreview={table.setManualPreview} />
          )}
        </div>
      )}
    </div>
  );
};
