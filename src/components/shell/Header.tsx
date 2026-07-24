import { useRef, useState, type ChangeEvent } from 'react';
import { ClipboardPaste, FilePlus2, FileText, FileUp, GitCompareArrows, Link2, Loader2, Map, MoreHorizontal, Redo2, RotateCcw, Save, Search, Settings, Undo2, X } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { ingestClipboardText, ingestFile, ingestUrl } from '../../services/dataIngestion';
import { cn } from '../../utils/cn';
import {
  applyProjectManifest,
  applyRelinkedLayerPresentation,
  createProjectManifest,
  downloadProjectManifest,
  parseProjectManifest,
  sourceMatchesFile,
} from '../../services/projectService';
import type { ProjectManifest, ProjectSourceDescriptor } from '../../types/project';

export const Header = () => {
  const duckdbReady = useStore((s) => s.duckdbReady);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const resetWorkspace = useStore((s) => s.resetWorkspace);
  const hasWork = useStore((s) => s.nodes.length > 0 || s.mapLayers.length > 0);
  const analysisHistory = useStore((s) => s.analysisHistory);
  const undoAnalysis = useStore((s) => s.undoAnalysis);
  const redoAnalysis = useStore((s) => s.redoAnalysis);
  const setCommandPaletteOpen = useStore((s) => s.setCommandPaletteOpen);
  const addToast = useStore((s) => s.addToast);
  const recoverySave = useStore((s) => s.ui.recoverySave);
  const workspaceMode = useStore((s) => s.ui.workspaceMode);
  const setWorkspaceMode = useStore((s) => s.setWorkspaceMode);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const relinkInputRef = useRef<HTMLInputElement>(null);
  const relinkTargetRef = useRef<ProjectSourceDescriptor | null>(null);
  const [importedProject, setImportedProject] = useState<ProjectManifest | null>(null);
  const [missingSources, setMissingSources] = useState<ProjectSourceDescriptor[]>([]);
  const [isRelinkOpen, setRelinkOpen] = useState(false);
  const [isAddDataOpen, setAddDataOpen] = useState(false);
  const [dataUrl, setDataUrl] = useState('');
  const [clipboardText, setClipboardText] = useState('');
  const [isRemoteLoading, setRemoteLoading] = useState(false);
  const [isMobileMenuOpen, setMobileMenuOpen] = useState(false);
  const undoLabel = analysisHistory.past[analysisHistory.past.length - 1]?.label;
  const redoLabel = analysisHistory.future[0]?.label;

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    setAddDataOpen(false);
    for (const file of files) {
      await ingestFile(file);
    }
  };

  const handleUrlImport = async () => {
    setRemoteLoading(true);
    try {
      const result = await ingestUrl(dataUrl.trim());
      if (result) {
        setDataUrl('');
        setAddDataOpen(false);
      }
    } catch (error: any) {
      addToast({ type: 'error', message: error?.message || 'Could not import this URL.' });
    } finally {
      setRemoteLoading(false);
    }
  };

  const handleClipboardImport = async () => {
    setRemoteLoading(true);
    try {
      const result = await ingestClipboardText(clipboardText);
      if (result) {
        setClipboardText('');
        setAddDataOpen(false);
      }
    } catch (error: any) {
      addToast({ type: 'error', message: error?.message || 'Could not import the pasted JSON.' });
    } finally {
      setRemoteLoading(false);
    }
  };

  const handleNewProject = () => {
    if (!hasWork || window.confirm('Clear the current workspace? Loaded data, workflow nodes, and layers will be removed.')) {
      resetWorkspace();
    }
  };

  const handleProjectImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (hasWork && !window.confirm('Replace the current workspace with this project? Loaded data and unsaved changes will be removed.')) return;
    try {
      const manifest = parseProjectManifest(await file.text());
      const missing = applyProjectManifest(manifest);
      setImportedProject(manifest);
      setMissingSources(missing);
      setRelinkOpen(missing.length > 0);
      addToast({
        type: missing.length ? 'warning' : 'success',
        message: missing.length
          ? `Opened project. Relink ${missing.length} source ${missing.length === 1 ? 'file' : 'files'} to restore its data.`
          : 'Opened project.',
      });
    } catch (error: any) {
      addToast({ type: 'error', message: `Could not open project: ${error?.message || 'Unknown error'}` });
    }
  };

  const chooseRelinkFile = (source: ProjectSourceDescriptor) => {
    relinkTargetRef.current = source;
    relinkInputRef.current?.click();
  };

  const handleRelink = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    const source = relinkTargetRef.current;
    if (!file || !source || !importedProject) return;
    if (!sourceMatchesFile(source, file)) {
      addToast({ type: 'error', message: `This file does not match ${source.name}. Choose the original file with the same name${source.size === undefined ? '' : ' and size'}.` });
      return;
    }
    const result = await ingestFile(file, { nodeId: source.nodeId });
    if (!result) return;
    if (result.layerId) applyRelinkedLayerPresentation(source.nodeId, result.layerId, importedProject);
    const remaining = missingSources.filter((item) => item.nodeId !== source.nodeId);
    setMissingSources(remaining);
    setRelinkOpen(remaining.length > 0);
    addToast({ type: 'success', message: `Relinked ${source.name}` });
  };

  return (
    <header className="z-50 flex h-14 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white px-2 shadow-[0_1px_0_rgba(15,23,42,0.02)] md:px-4">
      <div className="flex items-center gap-2.5" role="group" aria-label="ALUR interactive visual analytics">
        <img
          src="/alur-mark.svg"
          alt=""
          className="h-9 w-9"
        />
        <div className="hidden sm:block">
          <h1 className="text-[15px] font-extrabold leading-none tracking-[0.16em] text-slate-900">ALUR</h1>
          <p className="mt-1 text-[10px] font-medium leading-none tracking-wide text-slate-500">
            Interactive visual analytics
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="hidden items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 md:flex" aria-label="Workspace mode">
          <button type="button" onClick={() => setWorkspaceMode('explore')} aria-pressed={workspaceMode === 'explore'} className={cn('flex h-7 items-center gap-1 rounded-md px-2 text-[10px] font-bold', workspaceMode === 'explore' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600')}><Map className="h-3 w-3" /> Explore</button>
          <button type="button" onClick={() => setWorkspaceMode('compare')} aria-pressed={workspaceMode === 'compare'} className={cn('flex h-7 items-center gap-1 rounded-md px-2 text-[10px] font-bold', workspaceMode === 'compare' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600')}><GitCompareArrows className="h-3 w-3" /> Compare</button>
          <button type="button" onClick={() => setWorkspaceMode('explain')} aria-pressed={workspaceMode === 'explain' || workspaceMode === 'board'} className={cn('flex h-7 items-center gap-1 rounded-md px-2 text-[10px] font-bold', workspaceMode === 'explain' || workspaceMode === 'board' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600')}><FileText className="h-3 w-3" /> Explain</button>
        </div>
        <select value={workspaceMode === 'board' ? 'explain' : workspaceMode} onChange={(event) => setWorkspaceMode(event.target.value as 'explore' | 'compare' | 'explain')} className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-[10px] font-bold text-slate-700 md:hidden" aria-label="Workspace mode"><option value="explore">Explore</option><option value="compare">Compare</option><option value="explain">Explain</option></select>
        <span
          className={cn(
            'mr-2 hidden items-center gap-1.5 text-[11px] text-muted-foreground md:flex',
          )}
          title={duckdbReady ? 'DuckDB engine ready' : 'DuckDB engine initializing'}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', duckdbReady ? 'bg-emerald-500' : 'animate-pulse bg-amber-400')} />
          {duckdbReady ? 'Engine ready' : 'Initializing…'}
        </span>

        {hasWork && (
          <span
            className={cn(
              'hidden text-[10px] font-medium lg:inline',
              recoverySave.status === 'error' ? 'text-rose-600' : 'text-slate-600',
            )}
            title={recoverySave.savedAt ? `Recovery saved ${new Date(recoverySave.savedAt).toLocaleString()}` : 'Local crash recovery status'}
            aria-live="polite"
          >
            {recoverySave.status === 'saving' ? 'Saving…' : recoverySave.status === 'saved' ? 'Saved locally' : recoverySave.status === 'error' ? 'Recovery unavailable' : 'Not saved yet'}
          </span>
        )}

        <button
          type="button"
          onClick={() => setCommandPaletteOpen(true)}
          className="hidden h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800 lg:flex"
          aria-label="Open command palette"
          title="Command palette (Ctrl+K)"
        >
          <Search className="h-3.5 w-3.5" /> Commands <kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-mono text-[9px]">Ctrl K</kbd>
        </button>

        <div className="flex items-center overflow-hidden rounded-lg border border-slate-200 bg-white">
          <button
            type="button"
            onClick={undoAnalysis}
            disabled={!undoLabel}
            className="flex h-8 w-8 items-center justify-center text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-30"
            aria-label={undoLabel ? `Undo ${undoLabel}` : 'Nothing to undo'}
            title={undoLabel ? `Undo ${undoLabel} (Ctrl+Z)` : 'Nothing to undo'}
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={redoAnalysis}
            disabled={!redoLabel}
            className="flex h-8 w-8 items-center justify-center border-l border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-30"
            aria-label={redoLabel ? `Redo ${redoLabel}` : 'Nothing to redo'}
            title={redoLabel ? `Redo ${redoLabel} (Ctrl+Shift+Z)` : 'Nothing to redo'}
          >
            <Redo2 className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="hidden items-center overflow-hidden rounded-lg border border-slate-200 bg-white md:flex">
          <button
            type="button"
            onClick={() => downloadProjectManifest(createProjectManifest())}
            disabled={!hasWork}
            className="flex h-8 items-center gap-1.5 px-2.5 text-[11px] font-semibold text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-30"
            title="Save workflow, layer styling, charts, filters, and views without embedding source data or credentials"
          >
            <Save className="h-3.5 w-3.5" /> Save
          </button>
          <button
            type="button"
            onClick={() => projectInputRef.current?.click()}
            className="flex h-8 items-center gap-1.5 border-l border-slate-200 px-2.5 text-[11px] font-semibold text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800"
            title="Open an ALUR project file"
          >
            <FileUp className="h-3.5 w-3.5" /> Open
          </button>
        </div>
        <input ref={projectInputRef} type="file" accept=".json,.alur.json,application/json" className="hidden" onChange={handleProjectImport} />

        {missingSources.length > 0 && (
          <button
            type="button"
            onClick={() => setRelinkOpen(true)}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-100"
            title="Relink source files required by the opened project"
          >
            <Link2 className="h-3.5 w-3.5" /> Relink {missingSources.length}
          </button>
        )}

        <button
          type="button"
          onClick={() => setAddDataOpen(true)}
          disabled={!duckdbReady}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50 md:px-3 md:py-1.5"
          aria-label="Add data"
        >
          <FilePlus2 className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Add data</span>
        </button>
        <input
          id="alur-file-input"
          ref={fileInputRef}
          type="file"
          multiple
          accept=".parquet,.csv,.json,.geojson,application/json,application/geo+json"
          className="hidden"
          onChange={handleFileChange}
        />

        <button
          type="button"
          onClick={handleNewProject}
          className="hidden items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 xl:flex"
          title="Clear the workspace and start fresh"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          New project
        </button>

        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="hidden rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 md:block"
          title="Settings"
        >
          <Settings className="h-4 w-4" />
        </button>
        <div className="relative md:hidden"><button type="button" onClick={() => setMobileMenuOpen(!isMobileMenuOpen)} className="rounded-lg border border-slate-200 p-2 text-slate-500" aria-label="Project actions" aria-expanded={isMobileMenuOpen}><MoreHorizontal className="h-4 w-4" /></button>{isMobileMenuOpen && <div className="absolute right-0 top-10 z-[100] w-44 rounded-lg border border-slate-200 bg-white p-1 shadow-xl"><button type="button" disabled={!hasWork} onClick={() => { downloadProjectManifest(createProjectManifest()); setMobileMenuOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-30"><Save className="h-3.5 w-3.5" /> Save project</button><button type="button" onClick={() => { projectInputRef.current?.click(); setMobileMenuOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[11px] font-semibold text-slate-600 hover:bg-slate-50"><FileUp className="h-3.5 w-3.5" /> Open project</button><button type="button" onClick={() => { handleNewProject(); setMobileMenuOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[11px] font-semibold text-slate-600 hover:bg-slate-50"><RotateCcw className="h-3.5 w-3.5" /> New project</button><button type="button" onClick={() => { setSettingsOpen(true); setMobileMenuOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[11px] font-semibold text-slate-600 hover:bg-slate-50"><Settings className="h-3.5 w-3.5" /> Settings</button></div>}</div>
      </div>
      <input ref={relinkInputRef} type="file" className="hidden" onChange={handleRelink} />

      {isAddDataOpen && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/35 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !isRemoteLoading) setAddDataOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="add-data-title" className="w-full max-w-xl rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
              <div>
                <h2 id="add-data-title" className="text-sm font-bold text-slate-800">Add data</h2>
                <p className="mt-1 text-xs text-slate-500">Parquet, CSV, JSON, and GeoJSON run locally in your browser.</p>
              </div>
              <button type="button" onClick={() => setAddDataOpen(false)} disabled={isRemoteLoading} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 disabled:opacity-40" aria-label="Close add data dialog"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-4 p-5">
              <button type="button" onClick={() => fileInputRef.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-xs font-bold text-slate-600 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700">
                <FilePlus2 className="h-4 w-4" /> Choose files from this device
              </button>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 rounded-lg border border-slate-200 p-3">
                  <label htmlFor="alur-data-url" className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500"><Link2 className="h-3.5 w-3.5" /> Data URL</label>
                  <input id="alur-data-url" type="url" value={dataUrl} onChange={(event) => setDataUrl(event.target.value)} placeholder="https://…/data.geojson" className="h-9 w-full rounded-md border border-slate-200 px-2.5 text-xs outline-none focus:border-sky-400" />
                  <p className="text-[10px] leading-4 text-slate-400">Public HTTP(S), up to 50 MB. The host must allow browser access.</p>
                  <button type="button" onClick={() => { void handleUrlImport(); }} disabled={!dataUrl.trim() || isRemoteLoading} className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-slate-900 text-[11px] font-bold text-white disabled:opacity-40">{isRemoteLoading && <Loader2 className="h-3 w-3 animate-spin" />} Import URL</button>
                </div>

                <div className="space-y-2 rounded-lg border border-slate-200 p-3">
                  <label htmlFor="alur-pasted-json" className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500"><ClipboardPaste className="h-3.5 w-3.5" /> Paste JSON</label>
                  <textarea id="alur-pasted-json" value={clipboardText} onChange={(event) => setClipboardText(event.target.value)} placeholder='[{"name":"A","value":1}]' className="h-[76px] w-full resize-none rounded-md border border-slate-200 p-2.5 font-mono text-[10px] outline-none focus:border-sky-400" />
                  <button type="button" onClick={() => { void handleClipboardImport(); }} disabled={!clipboardText.trim() || isRemoteLoading} className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-slate-900 text-[11px] font-bold text-white disabled:opacity-40">{isRemoteLoading && <Loader2 className="h-3 w-3 animate-spin" />} Import pasted data</button>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {isRelinkOpen && missingSources.length > 0 && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/35 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setRelinkOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="relink-title" className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
              <div>
                <h2 id="relink-title" className="text-sm font-bold text-slate-800">Relink project data</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">Project files intentionally contain no source records. Choose each original file to restore tables and map layers.</p>
              </div>
              <button type="button" onClick={() => setRelinkOpen(false)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close relink dialog"><X className="h-4 w-4" /></button>
            </div>
            <div className="max-h-80 space-y-2 overflow-y-auto p-4">
              {missingSources.map((source) => (
                <div key={source.nodeId} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-slate-700" title={source.name}>{source.name}</div>
                    <div className="mt-0.5 text-[10px] text-slate-400">{source.format?.toUpperCase() || 'Data file'}{source.size !== undefined ? ` · ${source.size.toLocaleString()} bytes` : ''}</div>
                  </div>
                  <button type="button" onClick={() => chooseRelinkFile(source)} className="shrink-0 rounded-md bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-slate-700">Choose file</button>
                </div>
              ))}
            </div>
            <div className="flex justify-end border-t bg-slate-50 px-4 py-3">
              <button type="button" onClick={() => setRelinkOpen(false)} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100">Relink later</button>
            </div>
          </section>
        </div>
      )}
    </header>
  );
};
