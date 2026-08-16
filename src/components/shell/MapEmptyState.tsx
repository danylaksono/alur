import { useRef, type ChangeEvent } from "react";
import { FilePlus2, MousePointerClick, X } from "lucide-react";
import { useStore } from "../../store/useStore";
import { ingestFile } from "../../services/dataIngestion";

/**
 * First-run overlay shown over the empty map. Non-interactive backdrop so map
 * panning still works around the card. Dismissal is remembered for this
 * browser, so it does not come back on every reload.
 */
export const MapEmptyState = () => {
  const hasWork = useStore((s) => s.nodes.length > 0 || s.mapLayers.length > 0);
  const dismissed = useStore((s) => s.ui.dismissedEmptyState);
  const dismissEmptyState = useStore((s) => s.dismissEmptyState);
  const duckdbReady = useStore((s) => s.duckdbReady);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (hasWork || dismissed) return null;

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    for (const file of files) {
      await ingestFile(file);
    }
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex overflow-y-auto p-4">
      <div className="pointer-events-auto relative m-auto flex max-w-sm flex-col items-center gap-3 rounded-xl border border-slate-200 bg-white/95 p-6 text-center shadow-lg backdrop-blur">
        <button
          type="button"
          onClick={dismissEmptyState}
          title="Dismiss"
          aria-label="Dismiss welcome prompt"
          className="absolute right-2.5 top-2.5 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <div className="rounded-full bg-primary/10 p-3">
          <MousePointerClick className="h-5 w-5 text-primary" />
        </div>
        <h2 className="text-sm font-bold text-slate-800">
          Start exploring your data
        </h2>
        <p className="text-xs leading-relaxed text-slate-500">
          Drop a{" "}
          <span className="font-semibold">Parquet, CSV, JSON, or GeoJSON</span>{" "}
          file to inspect rows, compare distributions, build charts, map spatial
          patterns and create a reproducible workflow. Everything runs in your
          browser.
        </p>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={!duckdbReady}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <FilePlus2 className="h-3.5 w-3.5" />
          {duckdbReady ? "Add data" : "Engine initializing…"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".parquet,.csv,.json,.geojson,application/json,application/geo+json"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>
    </div>
  );
};
