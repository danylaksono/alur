import { useRef, type ChangeEvent } from 'react';
import { FilePlus2, MousePointerClick } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { ingestFile } from '../../services/dataIngestion';

/**
 * First-run overlay shown over the empty map. Non-interactive backdrop so map
 * panning still works around the card.
 */
export const MapEmptyState = () => {
  const hasWork = useStore((s) => s.nodes.length > 0 || s.mapLayers.length > 0);
  const duckdbReady = useStore((s) => s.duckdbReady);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (hasWork) return null;

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    for (const file of files) {
      await ingestFile(file);
    }
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      <div className="pointer-events-auto flex max-w-sm flex-col items-center gap-3 rounded-xl border border-slate-200 bg-white/95 p-6 text-center shadow-lg backdrop-blur">
        <div className="rounded-full bg-slate-100 p-3">
          <MousePointerClick className="h-5 w-5 text-slate-500" />
        </div>
        <h2 className="text-sm font-bold text-slate-800">Start with your data</h2>
        <p className="text-xs leading-relaxed text-slate-500">
          Drop a <span className="font-semibold">Parquet</span> or <span className="font-semibold">CSV</span> file
          anywhere on the map, or use the button below. Everything runs in your browser — nothing is uploaded.
        </p>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={!duckdbReady}
          className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <FilePlus2 className="h-3.5 w-3.5" />
          {duckdbReady ? 'Add data' : 'Engine initializing…'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".parquet,.csv"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>
    </div>
  );
};
