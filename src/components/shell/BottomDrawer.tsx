import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Database, Maximize2, Minimize2, Terminal, Workflow } from 'lucide-react';
import { isHorizontalDock, useStore, type DockSide, type DrawerTab } from '../../store/useStore';
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

/**
 * The resize handle always sits on the edge that faces the map, so dragging it
 * grows the surface in the direction the user expects.
 */
const HANDLE_LEADS: Record<DockSide, boolean> = { bottom: true, right: true, top: false, left: false };

/** Chevrons point the way the surface will move when collapsed. */
const COLLAPSE_ICON: Record<DockSide, typeof ChevronDown> = {
  bottom: ChevronDown,
  top: ChevronUp,
  left: ChevronLeft,
  right: ChevronRight,
};

export const BottomDrawer = () => {
  const dockSide = useStore((s) => s.ui.dockSide);
  const drawerMode = useStore((s) => s.ui.drawerMode);
  const drawerHeight = useStore((s) => s.ui.drawerHeight);
  const drawerWidth = useStore((s) => s.ui.drawerWidth);
  const activeDrawerTab = useStore((s) => s.ui.activeDrawerTab);
  const setDrawerMode = useStore((s) => s.setDrawerMode);
  const setDrawerHeight = useStore((s) => s.setDrawerHeight);
  const setDrawerWidth = useStore((s) => s.setDrawerWidth);
  const openDrawerTab = useStore((s) => s.openDrawerTab);
  const [isResizing, setIsResizing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // The attribute-table state lives here (not in TableTab) so it survives
  // drawer tab switches — e.g. run SQL, then inspect the rows in Table.
  const table = useAttributeTable();

  const isOpen = drawerMode !== 'collapsed';
  const isMaximized = drawerMode === 'maximized';
  const horizontal = isHorizontalDock(dockSide);
  const CollapseIcon = COLLAPSE_ICON[dockSide];
  // Side-docked and closed, the tab bar has to stack into a narrow strip —
  // a horizontal one would reserve its full width while showing nothing.
  const stacked = !horizontal && !isOpen;

  useEffect(() => {
    if (!isResizing) return;

    const handlePointerMove = (event: PointerEvent) => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      // Measure from the docked edge, which stays put while dragging.
      if (dockSide === 'bottom') setDrawerHeight(rect.bottom - event.clientY);
      else if (dockSide === 'top') setDrawerHeight(event.clientY - rect.top);
      else if (dockSide === 'right') setDrawerWidth(rect.right - event.clientX);
      else setDrawerWidth(event.clientX - rect.left);
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
  }, [isResizing, dockSide, setDrawerHeight, setDrawerWidth]);

  const sizeStyle = drawerMode === 'open'
    ? (horizontal ? { height: drawerHeight } : { width: drawerWidth })
    : undefined;

  return (
    <div
      ref={rootRef}
      className={cn(
        'z-20 flex shrink-0 bg-white',
        horizontal ? 'flex-col' : 'flex-row',
        HANDLE_LEADS[dockSide] ? '' : (horizontal ? 'flex-col-reverse' : 'flex-row-reverse'),
        dockSide === 'bottom' && 'border-t',
        dockSide === 'top' && 'border-b',
        dockSide === 'left' && 'border-r',
        dockSide === 'right' && 'border-l',
        isMaximized && 'min-h-0 min-w-0 flex-1',
      )}
      style={sizeStyle}
    >
      {drawerMode === 'open' && (
        <div
          className={cn(
            'shrink-0 bg-slate-100 transition-colors hover:bg-slate-300',
            horizontal ? 'h-1.5 cursor-row-resize' : 'w-1.5 cursor-col-resize',
          )}
          onPointerDown={(e) => {
            e.preventDefault();
            setIsResizing(true);
          }}
          title="Drag to resize"
          role="separator"
          aria-orientation={horizontal ? 'horizontal' : 'vertical'}
          aria-label="Resize data panel"
        />
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          className={cn(
            'flex shrink-0 justify-between bg-slate-50',
            stacked ? 'w-10 flex-col items-center gap-1 border-l py-2' : 'h-9 items-center border-b px-2',
          )}
        >
          <div className={cn('flex min-w-0 gap-1', stacked ? 'flex-col items-center' : 'items-center overflow-x-auto')}>
            {DRAWER_TABS.map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => openDrawerTab(id)}
                className={cn(
                  'pressable flex shrink-0 items-center rounded-md font-semibold transition-colors',
                  stacked ? 'h-7 w-7 justify-center' : 'gap-1.5 px-3 py-1.5 text-xs',
                  isOpen && activeDrawerTab === id
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-500 hover:bg-slate-200/60 hover:text-slate-700'
                )}
                title={stacked ? label : undefined}
                aria-label={stacked ? label : undefined}
              >
                <Icon className="h-3 w-3" />
                {!stacked && label}
              </button>
            ))}
          </div>

          <div className={cn('flex shrink-0 gap-1', stacked ? 'flex-col items-center' : 'items-center')}>
            {isOpen && (
              <button
                type="button"
                onClick={() => setDrawerMode(isMaximized ? 'open' : 'maximized')}
                className="pressable rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-200/60 hover:text-slate-700"
                title={isMaximized ? 'Restore panel' : 'Maximize panel'}
              >
                {isMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </button>
            )}
            <button
              type="button"
              onClick={() => setDrawerMode(isOpen ? 'collapsed' : 'open')}
              className="pressable rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-200/60 hover:text-slate-700"
              title={isOpen ? 'Collapse panel' : 'Open panel'}
            >
              <CollapseIcon className={cn('h-3.5 w-3.5', !isOpen && 'rotate-180')} />
            </button>
          </div>
        </div>

        {isOpen && (
          <div className="min-h-0 flex-1 overflow-hidden">
            {activeDrawerTab === 'workflow' ? (
              <Suspense fallback={<div className="p-4 text-xs text-slate-500" role="status">Loading workflow editor…</div>}><WorkflowTab /></Suspense>
            ) : activeDrawerTab === 'table' ? (
              <TableTab table={table} />
            ) : (
              <SqlTab setManualPreview={table.setManualPreview} />
            )}
          </div>
        )}
      </div>
    </div>
  );
};
