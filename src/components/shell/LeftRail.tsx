import {
  BarChart3,
  Database,
  FileText,
  GitCompareArrows,
  Info,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
  Terminal,
  Users,
  Workflow,
} from 'lucide-react';
import { isDestinationActive, useStore, type NavDestination } from '../../store/useStore';
import { LayoutMenu } from './LayoutMenu';
import { cn } from '../../utils/cn';

type Destination = {
  id: NavDestination;
  icon: typeof Layers;
  label: string;
  hint: string;
};

type Group = { id: string; title: string; items: Destination[] };

/**
 * The app's single primary navigation. Each entry resolves onto whichever
 * surface owns it — left panel, bottom drawer, or a whole workspace — so
 * choosing "what to work on" and "where it appears" is one decision.
 */
const GROUPS: Group[] = [
  {
    id: 'explore',
    title: 'Explore',
    items: [
      { id: 'layers', icon: Layers, label: 'Layers', hint: 'Data and map layers' },
      { id: 'charts', icon: BarChart3, label: 'Charts', hint: 'Visualise distributions and measures' },
      { id: 'table', icon: Database, label: 'Table', hint: 'Inspect rows and attributes' },
      { id: 'workflow', icon: Workflow, label: 'Workflow', hint: 'Build a reproducible pipeline' },
      { id: 'sql', icon: Terminal, label: 'SQL', hint: 'Query the data directly' },
    ],
  },
  {
    id: 'analyse',
    title: 'Analyse',
    items: [
      { id: 'compare', icon: GitCompareArrows, label: 'Compare', hint: 'Compare groups, places or time windows' },
      { id: 'cohorts', icon: Users, label: 'Cohorts', hint: 'Saved subsets and analytical bookmarks' },
    ],
  },
  {
    id: 'explain',
    title: 'Explain',
    items: [
      { id: 'explain', icon: FileText, label: 'Report', hint: 'Assemble findings and evidence' },
    ],
  },
];

const COPILOT: Destination = { id: 'chat', icon: Sparkles, label: 'Copilot', hint: 'Ask the analysis assistant' };

export const LeftRail = () => {
  const ui = useStore((s) => s.ui);
  const isRailExpanded = ui.isRailExpanded;
  const isAboutOpen = ui.isAboutOpen;
  const navigate = useStore((s) => s.navigate);
  const togglePanelCollapsed = useStore((s) => s.togglePanelCollapsed);
  const toggleRailExpanded = useStore((s) => s.toggleRailExpanded);
  const setDrawerMode = useStore((s) => s.setDrawerMode);
  const setAboutOpen = useStore((s) => s.setAboutOpen);

  const isActive = (id: NavDestination) => isDestinationActive(ui, id);

  /** Clicking the active destination closes its surfaces, so it reads as a toggle. */
  const handleClick = (id: NavDestination) => {
    if (!isActive(id)) {
      navigate(id);
      return;
    }
    if (id === 'compare' || id === 'explain') return;
    if (id === 'workflow') {
      setDrawerMode('collapsed');
      togglePanelCollapsed();
      return;
    }
    if (id === 'table' || id === 'sql') setDrawerMode('collapsed');
    else togglePanelCollapsed();
  };

  const renderItem = ({ id, icon: Icon, label, hint }: Destination) => {
    const active = isActive(id);
    return (
      <button
        key={id}
        type="button"
        onClick={() => handleClick(id)}
        className={cn(
          'flex h-9 items-center rounded-lg transition-colors',
          isRailExpanded ? 'w-full gap-2.5 px-2.5' : 'w-9 justify-center',
          active ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
        )}
        title={active ? `${label} — click to close` : hint}
        aria-label={label}
        aria-pressed={active}
      >
        <Icon className="h-4 w-4 shrink-0" />
        {isRailExpanded && <span className="truncate text-xs font-semibold">{label}</span>}
      </button>
    );
  };

  return (
    <nav
      className={cn(
        'z-40 flex shrink-0 flex-col border-r bg-white py-2 transition-[width] duration-150',
        isRailExpanded ? 'w-44 px-2' : 'w-12 items-center',
      )}
      aria-label="Primary"
    >
      {GROUPS.map((group, index) => (
        <div key={group.id} className={cn('flex flex-col gap-0.5', isRailExpanded ? 'w-full' : 'items-center')}>
          {isRailExpanded ? (
            <h2 className="px-2.5 pb-1 pt-3 text-[9px] font-bold uppercase tracking-[.14em] text-slate-500">
              {group.title}
            </h2>
          ) : (
            index > 0 && <span className="my-1.5 h-px w-6 bg-slate-200" aria-hidden="true" />
          )}
          {group.items.map(renderItem)}
        </div>
      ))}

      <div className={cn('mt-auto flex flex-col gap-0.5 pt-3', isRailExpanded ? 'w-full' : 'items-center')}>
        {renderItem(COPILOT)}
        <LayoutMenu expanded={isRailExpanded} />

        <button
          type="button"
          onClick={() => setAboutOpen(true)}
          className={cn(
            'flex h-9 items-center rounded-lg transition-colors',
            isRailExpanded ? 'w-full gap-2.5 px-2.5' : 'w-9 justify-center',
            isAboutOpen ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
          )}
          title="About"
          aria-label="About"
          aria-haspopup="dialog"
          aria-controls="about-alur-dialog"
          aria-expanded={isAboutOpen}
        >
          <Info className="h-4 w-4 shrink-0" />
          {isRailExpanded && <span className="truncate text-xs font-semibold">About</span>}
        </button>

        <button
          type="button"
          onClick={toggleRailExpanded}
          className={cn(
            'flex h-9 items-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700',
            isRailExpanded ? 'w-full gap-2.5 px-2.5' : 'w-9 justify-center',
          )}
          title={isRailExpanded ? 'Collapse navigation to icons' : 'Expand navigation'}
          aria-label={isRailExpanded ? 'Collapse navigation' : 'Expand navigation'}
          aria-expanded={isRailExpanded}
        >
          {isRailExpanded ? <PanelLeftClose className="h-4 w-4 shrink-0" /> : <PanelLeftOpen className="h-4 w-4 shrink-0" />}
          {isRailExpanded && <span className="truncate text-xs font-semibold">Collapse</span>}
        </button>
      </div>
    </nav>
  );
};
