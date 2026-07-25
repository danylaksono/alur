import { BarChart3, Info, Layers, Sparkles, Users } from 'lucide-react';
import { useStore, type RailTab } from '../../store/useStore';
import { cn } from '../../utils/cn';

const RAIL_TABS: Array<{ id: RailTab; icon: typeof Layers; label: string }> = [
  { id: 'layers', icon: Layers, label: 'Data and layers' },
  { id: 'charts', icon: BarChart3, label: 'Visualise' },
  { id: 'cohorts', icon: Users, label: 'Cohorts and bookmarks' },
  { id: 'chat', icon: Sparkles, label: 'Copilot' },
];

export const LeftRail = () => {
  const activeRailTab = useStore((s) => s.ui.activeRailTab);
  const isPanelCollapsed = useStore((s) => s.ui.isPanelCollapsed);
  const isAboutOpen = useStore((s) => s.ui.isAboutOpen);
  const setActiveRailTab = useStore((s) => s.setActiveRailTab);
  const togglePanelCollapsed = useStore((s) => s.togglePanelCollapsed);
  const setAboutOpen = useStore((s) => s.setAboutOpen);

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
            title={isActive ? `${label} — click to collapse the panel` : label}
            aria-label={label}
            aria-pressed={isActive}
          >
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => setAboutOpen(true)}
        className={cn(
          'mt-auto flex h-9 w-9 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          isAboutOpen
            ? 'bg-slate-900 text-white'
            : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
        )}
        title="About"
        aria-label="About"
        aria-haspopup="dialog"
        aria-controls="about-alur-dialog"
        aria-expanded={isAboutOpen}
      >
        <Info className="h-4 w-4" />
      </button>
    </nav>
  );
};
