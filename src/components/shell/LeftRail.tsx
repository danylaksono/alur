import { BarChart3, Layers, Sparkles } from 'lucide-react';
import { useStore, type RailTab } from '../../store/useStore';
import { cn } from '../../utils/cn';

const RAIL_TABS: Array<{ id: RailTab; icon: typeof Layers; label: string }> = [
  { id: 'layers', icon: Layers, label: 'Layers' },
  { id: 'charts', icon: BarChart3, label: 'Charts' },
  { id: 'chat', icon: Sparkles, label: 'Copilot' },
];

export const LeftRail = () => {
  const activeRailTab = useStore((s) => s.ui.activeRailTab);
  const isPanelCollapsed = useStore((s) => s.ui.isPanelCollapsed);
  const setActiveRailTab = useStore((s) => s.setActiveRailTab);
  const togglePanelCollapsed = useStore((s) => s.togglePanelCollapsed);

  return (
    <nav className="z-40 flex w-12 shrink-0 flex-col items-center gap-1 border-r bg-white py-2">
      {RAIL_TABS.map(({ id, icon: Icon, label }) => {
        const isActive = activeRailTab === id && !isPanelCollapsed;
        return (
          <button
            key={id}
            type="button"
            onClick={() => {
              if (activeRailTab === id) {
                togglePanelCollapsed();
              } else {
                setActiveRailTab(id);
              }
            }}
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
              isActive
                ? 'bg-slate-900 text-white'
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
            )}
            title={label}
            aria-label={label}
            aria-pressed={isActive}
          >
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </nav>
  );
};
