import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { BookOpen, ChevronDown, ClipboardPaste, FilePlus2, FileUp, Link2, Loader2, Pencil, Redo2, RotateCcw, Save, Search, Settings, Undo2, X } from 'lucide-react';
import { UNTITLED_PROJECT_NAME, useStore } from '../../store/useStore';
import { ingestClipboardText, ingestFile, ingestUrl } from '../../services/dataIngestion';
import { cn } from '../../utils/cn';
import {
  applyProjectManifest,
  applyRelinkedLayerPresentation,
  createProjectManifest,
  downloadProjectManifest,
  parseProjectManifest,
  restoreSourcesFromCache,
  sourceMatchesFile,
} from '../../services/projectService';
import type { ProjectManifest, ProjectSourceDescriptor } from '../../types/project';
import { parseStory } from '../../services/storyService';

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
  const projectName = useStore((s) => s.project.name);
  const setProjectName = useStore((s) => s.setProjectName);
  const openStory = useStore((s) => s.openStory);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const storyInputRef = useRef<HTMLInputElement>(null);
  const relinkInputRef = useRef<HTMLInputElement>(null);
  const relinkTargetRef = useRef<ProjectSourceDescriptor | null>(null);
  const [importedProject, setImportedProject] = useState<ProjectManifest | null>(null);
  const [missingSources, setMissingSources] = useState<ProjectSourceDescriptor[]>([]);
  const [isRelinkOpen, setRelinkOpen] = useState(false);
  const [isAddDataOpen, setAddDataOpen] = useState(false);
  const [dataUrl, setDataUrl] = useState('');
  const [clipboardText, setClipboardText] = useState('');
  const [isRemoteLoading, setRemoteLoading] = useState(false);
  const [isProjectMenuOpen, setProjectMenuOpen] = useState(false);
  const [isRenaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const undoLabel = analysisHistory.past[analysisHistory.past.length - 1]?.label;
  const redoLabel = analysisHistory.future[0]?.label;

  useEffect(() => {
    if (!isProjectMenuOpen) return;
    const closeOnOutside = (event: MouseEvent) => {
      if (!projectMenuRef.current?.contains(event.target as Node)) setProjectMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProjectMenuOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isProjectMenuOpen]);

  const startRename = () => {
    setNameDraft(projectName);
    setRenaming(true);
    setProjectMenuOpen(false);
    requestAnimationFrame(() => nameInputRef.current?.select());
  };

  const commitRename = () => {
    setProjectName(nameDraft.trim());
    setRenaming(false);
  };

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
      const declared = applyProjectManifest(manifest);
      setImportedProject(manifest);
      // Anything this browser cached on the way in comes back without asking.
      const { restored, missing } = await restoreSourcesFromCache(declared, manifest);
      setMissingSources(missing);
      setRelinkOpen(missing.length > 0);
      addToast({
        type: missing.length ? 'warning' : 'success',
        message: missing.length
          ? `Opened project${restored.length ? `, restoring ${restored.length} of ${declared.length} sources from this browser` : ''}. Relink ${missing.length} source ${missing.length === 1 ? 'file' : 'files'} to restore the rest.`
          : restored.length
            ? `Opened project and restored ${restored.length} source ${restored.length === 1 ? 'file' : 'files'} from this browser.`
            : 'Opened project.',
      });
    } catch (error: any) {
      addToast({ type: 'error', message: `Could not open project: ${error?.message || 'Unknown error'}` });
    }
  };

  // Stories are read-only and self-contained, so opening one never touches the
  // workspace — it just puts a reader on top of whatever is already loaded.
  const handleStoryImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      openStory(parseStory(await file.text()));
    } catch (error: any) {
      addToast({ type: 'error', message: `Could not open story: ${error?.message || 'Unknown error'}` });
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
      <div className="flex min-w-0 items-center gap-2" role="group" aria-label="ALUR interactive visual analytics">
        <img src="/alur-mark.svg" alt="" className="h-8 w-8 shrink-0" />
        <h1 className="hidden text-[13px] font-extrabold leading-none tracking-[0.16em] text-slate-900 sm:block">ALUR</h1>

        <span className="hidden h-5 w-px shrink-0 bg-slate-200 sm:block" aria-hidden="true" />

        {/* Project identity and its file actions live together: this is where
            users look for "which project am I in" and "save it". */}
        <div ref={projectMenuRef} className="relative min-w-0">
          {isRenaming ? (
            <input
              ref={nameInputRef}
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitRename();
                if (event.key === 'Escape') setRenaming(false);
              }}
              maxLength={120}
              aria-label="Project name"
              placeholder={UNTITLED_PROJECT_NAME}
              className="h-8 w-44 rounded-lg border border-sky-300 px-2 text-[13px] font-semibold text-slate-800 outline-none ring-2 ring-sky-100 md:w-56"
            />
          ) : (
            <button
              type="button"
              onClick={() => setProjectMenuOpen(!isProjectMenuOpen)}
              onDoubleClick={startRename}
              className="flex h-8 min-w-0 max-w-[9rem] items-center gap-1 rounded-lg px-2 text-[13px] font-semibold text-slate-800 transition-colors hover:bg-slate-100 md:max-w-[16rem]"
              aria-haspopup="menu"
              aria-expanded={isProjectMenuOpen}
              title={`${projectName || UNTITLED_PROJECT_NAME} — project actions`}
            >
              <span className={cn('truncate', !projectName && 'font-medium text-slate-500')}>
                {projectName || UNTITLED_PROJECT_NAME}
              </span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            </button>
          )}

          {isProjectMenuOpen && (
            <div role="menu" aria-label="Project actions" className="absolute left-0 top-9 z-[100] w-52 rounded-lg border border-slate-200 bg-white p-1 shadow-xl">
              <button type="button" role="menuitem" onClick={startRename} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
                <Pencil className="h-3.5 w-3.5" /> Rename project
              </button>
              <button type="button" role="menuitem" disabled={!hasWork} onClick={() => { downloadProjectManifest(createProjectManifest()); setProjectMenuOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35" title="Save workflow, layer styling, charts, filters, and views without embedding source data or credentials">
                <Save className="h-3.5 w-3.5" /> Save project
              </button>
              <button type="button" role="menuitem" onClick={() => { projectInputRef.current?.click(); setProjectMenuOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
                <FileUp className="h-3.5 w-3.5" /> Open project…
              </button>
              <button type="button" role="menuitem" onClick={() => { storyInputRef.current?.click(); setProjectMenuOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[11px] font-semibold text-slate-600 hover:bg-slate-50" title="Read a shared explanation — no data needed">
                <BookOpen className="h-3.5 w-3.5" /> Open story…
              </button>
              <div className="my-1 h-px bg-slate-100" />
              <button type="button" role="menuitem" onClick={() => { handleNewProject(); setProjectMenuOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
                <RotateCcw className="h-3.5 w-3.5" /> New project
              </button>
            </div>
          )}
        </div>

        {hasWork && (
          <span
            className={cn(
              'hidden shrink-0 text-[10px] font-medium lg:inline',
              recoverySave.status === 'error' ? 'text-rose-600' : 'text-slate-500',
            )}
            title={recoverySave.savedAt ? `Recovery saved ${new Date(recoverySave.savedAt).toLocaleString()}` : 'Local crash recovery status'}
            aria-live="polite"
          >
            {recoverySave.status === 'saving' ? 'Saving…' : recoverySave.status === 'saved' ? 'Saved locally' : recoverySave.status === 'error' ? 'Recovery unavailable' : 'Not saved yet'}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Workspace mode now lives in the rail. A permanent green "ready" dot
            teaches nothing, so the engine only speaks up while starting. */}
        {!duckdbReady && (
          <span className="mr-1 hidden items-center gap-1.5 text-[11px] text-muted-foreground md:flex" title="DuckDB engine initializing">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
            Starting engine…
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

        <input ref={projectInputRef} type="file" accept=".json,.alur.json,application/json" className="hidden" onChange={handleProjectImport} />
        <input ref={storyInputRef} type="file" accept=".json,.alur-story.json,application/json" className="hidden" onChange={handleStoryImport} />

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
          onClick={() => setSettingsOpen(true)}
          className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
          title="Settings"
          aria-label="Settings"
        >
          <Settings className="h-4 w-4" />
        </button>
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
