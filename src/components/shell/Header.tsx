import { useRef, type ChangeEvent } from 'react';
import { FilePlus2, RotateCcw, Settings } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { ingestFile } from '../../services/dataIngestion';
import { cn } from '../../utils/cn';

export const Header = () => {
  const duckdbReady = useStore((s) => s.duckdbReady);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const resetWorkspace = useStore((s) => s.resetWorkspace);
  const hasWork = useStore((s) => s.nodes.length > 0 || s.mapLayers.length > 0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    for (const file of files) {
      await ingestFile(file);
    }
  };

  const handleNewProject = () => {
    if (!hasWork || window.confirm('Clear the current workspace? Loaded data, workflow nodes, and layers will be removed.')) {
      resetWorkspace();
    }
  };

  return (
    <header className="z-50 flex h-12 shrink-0 items-center justify-between border-b bg-white px-4">
      <div className="flex items-center gap-2.5">
        <img src={new URL('../../../logo.png', import.meta.url).href} alt="Logo" className="h-8 w-8" />
        <div>
          <h1 className="text-sm font-bold leading-none tracking-tight">YMNNGIS</h1>
          <p className="text-[11px] leading-tight text-muted-foreground">You Might Not Need a desktop GIS</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span
          className={cn(
            'mr-2 hidden items-center gap-1.5 text-[11px] text-muted-foreground md:flex',
          )}
          title={duckdbReady ? 'DuckDB engine ready' : 'DuckDB engine initializing'}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', duckdbReady ? 'bg-emerald-500' : 'animate-pulse bg-amber-400')} />
          {duckdbReady ? 'Engine ready' : 'Initializing…'}
        </span>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={!duckdbReady}
          className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <FilePlus2 className="h-3.5 w-3.5" />
          Add data
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".parquet,.csv"
          className="hidden"
          onChange={handleFileChange}
        />

        <button
          type="button"
          onClick={handleNewProject}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
          title="Clear the workspace and start fresh"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          New project
        </button>

        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
          title="Settings"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
};
