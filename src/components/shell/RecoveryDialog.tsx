import { useRef, useState, type ChangeEvent } from 'react';
import { History, Link2, X } from 'lucide-react';
import { useProjectRecovery } from '../../hooks/useProjectRecovery';
import {
  applyProjectManifest,
  applyRelinkedLayerPresentation,
  sourceMatchesFile,
} from '../../services/projectService';
import { ingestFile } from '../../services/dataIngestion';
import type { ProjectSourceDescriptor } from '../../types/project';
import { useStore } from '../../store/useStore';

export const RecoveryDialog = () => {
  const { candidate, setCandidate, discard } = useProjectRecovery();
  const addToast = useStore((state) => state.addToast);
  const [sources, setSources] = useState<ProjectSourceDescriptor[] | null>(null);
  const targetRef = useRef<ProjectSourceDescriptor | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!candidate) return null;

  const restore = () => {
    const missing = applyProjectManifest(candidate.manifest);
    setSources(missing);
    if (!missing.length) {
      setCandidate(null);
      addToast({ type: 'success', message: 'Recovered your last workspace.' });
    }
  };

  const choose = (source: ProjectSourceDescriptor) => {
    targetRef.current = source;
    inputRef.current?.click();
  };

  const relink = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    const source = targetRef.current;
    if (!file || !source || !sources) return;
    if (!sourceMatchesFile(source, file)) {
      addToast({ type: 'error', message: `Choose the original ${source.name} file.` });
      return;
    }
    const result = await ingestFile(file, { nodeId: source.nodeId });
    if (!result) return;
    if (result.layerId) applyRelinkedLayerPresentation(source.nodeId, result.layerId, candidate.manifest);
    const remaining = sources.filter((item) => item.nodeId !== source.nodeId);
    setSources(remaining);
    if (!remaining.length) {
      setCandidate(null);
      addToast({ type: 'success', message: 'Recovered and relinked your workspace.' });
    }
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/35 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="recovery-title" className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div>
            <h2 id="recovery-title" className="flex items-center gap-2 text-sm font-bold text-slate-800"><History className="h-4 w-4 text-sky-600" /> Recover your workspace?</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">A recovery snapshot from {new Date(candidate.createdAt).toLocaleString()} is available.</p>
          </div>
          <button type="button" onClick={() => { void discard(); }} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Discard recovery snapshot"><X className="h-4 w-4" /></button>
        </div>
        {sources === null ? (
          <div className="space-y-4 p-5">
            <p className="text-xs leading-5 text-slate-600">Restore the workflow, filters, charts, metrics, styles, and workspace layout. Source records were not saved and may need to be relinked.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { void discard(); }} className="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">Discard</button>
              <button type="button" onClick={restore} className="rounded-md bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-700">Restore workspace</button>
            </div>
          </div>
        ) : (
          <div>
            <div className="space-y-2 p-4">
              <p className="pb-1 text-xs leading-5 text-slate-500">Relink the original source files to finish recovery.</p>
              {sources.map((source) => (
                <div key={source.nodeId} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <span className="truncate text-xs font-semibold text-slate-700">{source.name}</span>
                  <button type="button" onClick={() => choose(source)} className="flex shrink-0 items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-white"><Link2 className="h-3 w-3" /> Choose file</button>
                </div>
              ))}
            </div>
            <div className="flex justify-end border-t bg-slate-50 px-4 py-3">
              <button type="button" onClick={() => setCandidate(null)} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600">Relink later</button>
            </div>
          </div>
        )}
        <input ref={inputRef} type="file" className="hidden" onChange={relink} />
      </section>
    </div>
  );
};

