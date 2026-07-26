import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { BarChart3, Database, FilePlus2, Gauge, GitCompareArrows, Layers, LayoutDashboard, LayoutGrid, MapPinned, PanelLeft, Redo2, ScanSearch, Search, Sparkles, Table2, Terminal, Undo2, Users, Workflow, X } from 'lucide-react';
import { LAYOUT_PRESETS, useStore, type LayoutPresetId, type NavDestination } from '../../store/useStore';
import { useAnalyticsCommands } from '../../hooks/useAnalyticsCommands';
import { metadataForLayer, preferredExplorationField } from '../../utils/datasetMetadata';

type Command = {
  id: string;
  label: string;
  keywords: string;
  icon: ComponentType<{ className?: string }>;
  shortcut?: string;
  disabled?: boolean;
  run: () => void | Promise<void>;
};

export const CommandPalette = () => {
  const open = useStore((state) => state.ui.isCommandPaletteOpen);
  const setOpen = useStore((state) => state.setCommandPaletteOpen);
  const selectedLayerId = useStore((state) => state.selectedLayerId);
  const selectedLayer = useStore((state) => state.mapLayers.find((layer) => layer.id === state.selectedLayerId));
  const selectedLayerState = useStore((state) => state.selectedLayerId ? state.visualAnalytics.datasets[state.selectedLayerId] : undefined);
  const canUndo = useStore((state) => state.analysisHistory.past.length > 0);
  const canRedo = useStore((state) => state.analysisHistory.future.length > 0);
  const executeAnalyticsCommand = useAnalyticsCommands();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Command[]>(() => {
    const state = useStore.getState();
    // Commands route through the same navigation the rail uses, so a command
    // and a rail click cannot leave the shell in different states.
    const goTo = (destination: NavDestination) => () => state.navigate(destination);
    const explorationField = selectedLayer
      ? preferredExplorationField(metadataForLayer(selectedLayer))
      : undefined;
    const metricField = selectedLayer
      ? metadataForLayer(selectedLayer).fields.find((field) => field.semanticType === 'numeric')
      : undefined;
    return [
      { id: 'add-data', label: 'Add data', keywords: 'load import parquet csv file', icon: FilePlus2, run: () => document.getElementById('alur-file-input')?.click() },
      { id: 'layers', label: 'Open Layers', keywords: 'map style visualise', icon: Layers, run: goTo('layers') },
      { id: 'charts', label: 'Open Charts', keywords: 'graph plot distribution', icon: BarChart3, run: goTo('charts') },
      { id: 'cohorts', label: 'Open Cohorts', keywords: 'compare groups subsets bookmarks sensemaking', icon: Users, run: goTo('cohorts') },
      ...(selectedLayer && explorationField ? [{
        id: 'create-chart',
        label: `Create chart of ${explorationField.name}`,
        keywords: `add chart graph plot ${explorationField.name}`,
        icon: BarChart3,
        run: () => executeAnalyticsCommand({ type: 'create-chart', datasetId: selectedLayer.id, field: explorationField.name }),
      }] : []),
      ...(selectedLayer && metricField ? [{
        id: 'pin-kpi',
        label: `Pin metric for ${metricField.name}`,
        keywords: `kpi metric summary ${metricField.name}`,
        icon: Gauge,
        run: () => executeAnalyticsCommand({ type: 'pin-kpi', datasetId: selectedLayer.id, field: metricField.name }),
      }] : []),
      { id: 'copilot', label: 'Open Copilot', keywords: 'assistant chat ai', icon: Sparkles, run: goTo('chat') },
      { id: 'workflow', label: 'Open Workflow', keywords: 'nodes pipeline dag scenario variant', icon: Workflow, run: goTo('workflow') },
      { id: 'table', label: 'Open Table', keywords: 'rows attributes data', icon: Table2, run: goTo('table') },
      { id: 'sql', label: 'Open SQL', keywords: 'query duckdb code', icon: Terminal, run: goTo('sql') },
      { id: 'compare', label: 'Open Compare', keywords: 'analyse compare groups cohorts time scenarios difference', icon: GitCompareArrows, run: goTo('compare') },
      { id: 'explain', label: 'Open Report', keywords: 'explain presentation story evidence board layout', icon: LayoutDashboard, run: goTo('explain') },
      { id: 'toggle-nav', label: 'Toggle navigation labels', keywords: 'rail sidebar collapse expand icons', icon: PanelLeft, run: state.toggleRailExpanded },
      ...(Object.keys(LAYOUT_PRESETS) as Array<Exclude<LayoutPresetId, 'custom'>>).map((preset) => ({
        id: `layout-${preset}`,
        label: `Layout: ${LAYOUT_PRESETS[preset].label}`,
        keywords: `layout arrange dock split side by side map below workflow ${LAYOUT_PRESETS[preset].description}`,
        icon: LayoutGrid,
        run: () => state.applyLayoutPreset(preset),
      })),
      { id: 'focus-layer', label: 'Zoom to active layer', keywords: 'map home extent fit', icon: MapPinned, disabled: !selectedLayerId, run: () => { if (selectedLayerId) state.focusLayer(selectedLayerId); } },
      { id: 'dataset-overview', label: 'Open dataset overview', keywords: 'profile quality fields missing distinct', icon: ScanSearch, disabled: !selectedLayerId, run: () => { if (selectedLayerId) state.setDatasetOverviewLayerId(selectedLayerId); } },
      { id: 'focus-selection', label: 'Zoom to selection', keywords: 'map selected extent fit', icon: MapPinned, disabled: !selectedLayerState?.selectedFeatureIds.length, run: async () => { if (selectedLayerId) await executeAnalyticsCommand({ type: 'focus-selection', datasetId: selectedLayerId }); } },
      { id: 'clear-filters', label: 'Clear active filters', keywords: 'reset subset', icon: Database, disabled: !selectedLayerState?.filters.length, run: () => { if (selectedLayerId) state.clearLayerFilters(selectedLayerId); } },
      { id: 'clear-selection', label: 'Clear feature selection', keywords: 'reset selected', icon: X, disabled: !selectedLayerState?.selectedFeatureIds.length, run: () => { if (selectedLayerId) state.clearFeatureSelection(selectedLayerId); } },
      { id: 'undo', label: 'Undo analytical action', keywords: 'back history', icon: Undo2, shortcut: 'Ctrl Z', disabled: !canUndo, run: state.undoAnalysis },
      { id: 'redo', label: 'Redo analytical action', keywords: 'forward history', icon: Redo2, shortcut: 'Ctrl Shift Z', disabled: !canRedo, run: state.redoAnalysis },
    ];
  }, [canRedo, canUndo, executeAnalyticsCommand, selectedLayer, selectedLayerId, selectedLayerState?.filters.length, selectedLayerState?.selectedFeatureIds.length]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? commands.filter((command) => `${command.label} ${command.keywords}`.toLocaleLowerCase().includes(needle)) : commands;
  }, [commands, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);
  useEffect(() => setActiveIndex(0), [query]);

  if (!open) return null;
  const run = (command: Command | undefined) => {
    if (!command || command.disabled) return;
    setOpen(false);
    void command.run();
  };

  return (
    <div className="fixed inset-0 z-[10000] flex justify-center bg-slate-950/30 px-4 pt-[12vh]" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-label="Command palette" className="h-fit w-full max-w-xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex h-12 items-center border-b px-3">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
            else if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((index) => Math.min(filtered.length - 1, index + 1)); }
            else if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => Math.max(0, index - 1)); }
            else if (event.key === 'Enter') { event.preventDefault(); run(filtered[activeIndex]); }
          }} placeholder="Search commands…" aria-label="Search commands" aria-controls="command-palette-results" className="min-w-0 flex-1 px-3 text-sm text-slate-700 outline-none placeholder:text-slate-400" />
          <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">Esc</kbd>
        </div>
        <div id="command-palette-results" role="listbox" className="max-h-[55vh] overflow-y-auto p-2">
          {!filtered.length && <div className="px-3 py-8 text-center text-xs text-slate-400">No matching commands</div>}
          {filtered.map((command, index) => {
            const Icon = command.icon;
            return (
              <button key={command.id} type="button" role="option" aria-selected={index === activeIndex} disabled={command.disabled} onMouseEnter={() => setActiveIndex(index)} onClick={() => run(command)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm ${index === activeIndex ? 'bg-sky-50 text-sky-900' : 'text-slate-600 hover:bg-slate-50'} disabled:cursor-not-allowed disabled:opacity-35`}>
                <Icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate font-medium">{command.label}</span>
                {command.shortcut && <kbd className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[9px] text-slate-400">{command.shortcut}</kbd>}
              </button>
            );
          })}
        </div>
        <footer className="flex items-center justify-between border-t bg-slate-50 px-3 py-2 text-[10px] text-slate-400">
          <span>↑↓ navigate · Enter run</span>
          <span>{selectedLayer ? `Active: ${selectedLayer.name}` : 'No active layer'}</span>
        </footer>
      </section>
    </div>
  );
};
