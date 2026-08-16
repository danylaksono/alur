import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Cloud, Crop, Loader2, X } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { getMap } from '../../services/mapRegistry';
import { inspectRemoteSource, probeRemoteSource, readRemoteSource, type RemoteInspection } from '../../services/remoteSource';
import {
  guardFailure,
  REMOTE_CATALOG,
  REMOTE_UNGUARDED_MAX_BYTES,
  type RemoteBbox,
} from '../../utils/remoteSource';
import { cn } from '../../utils/cn';

const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200';

const formatBytes = (bytes?: number | null) => {
  if (!bytes) return 'unknown size';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
};

const boundsFromMap = (): RemoteBbox | null => {
  const map = getMap();
  if (!map) return null;
  const bounds = map.getBounds();
  return {
    minX: bounds.getWest(),
    minY: bounds.getSouth(),
    maxX: bounds.getEast(),
    maxY: bounds.getNorth(),
  };
};

const roundedBbox = (bbox: RemoteBbox) =>
  `${bbox.minX.toFixed(3)}, ${bbox.minY.toFixed(3)} → ${bbox.maxX.toFixed(3)}, ${bbox.maxY.toFixed(3)}`;

/**
 * Configures a remote read before it happens.
 *
 * The order of the steps is the point: inspect the footer first, then decide
 * how much to fetch. Column pruning and the bounding box are only meaningful
 * once the file's schema is known, and knowing whether the file carries a bbox
 * column is what tells the user whether an area filter will be cheap or merely
 * tidy.
 */
export const RemoteSourceDialog = ({ nodeId, onClose }: { nodeId?: string; onClose: () => void }) => {
  const addToast = useStore((s) => s.addToast);

  const [url, setUrl] = useState('');
  const [inspecting, setInspecting] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inspection, setInspection] = useState<RemoteInspection | null>(null);
  const [bbox, setBbox] = useState<RemoteBbox | null>(null);
  const [limitText, setLimitText] = useState('');
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);

  const limit = useMemo(() => {
    const parsed = Number(limitText.trim());
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }, [limitText]);

  const refusal = inspection ? guardFailure({ byteSize: inspection.byteSize, bbox, limit }) : null;

  const inspect = async (candidate: string) => {
    setError(null);
    setInspection(null);
    setSelectedColumns([]);
    setInspecting(true);
    try {
      const probe = await probeRemoteSource(candidate);
      const result = await inspectRemoteSource(probe);
      setInspection(result);
      if (result.byteSize && result.byteSize > REMOTE_UNGUARDED_MAX_BYTES && !bbox) {
        setBbox(boundsFromMap());
      }
    } catch (err: any) {
      setError(err?.message || 'The remote file could not be inspected.');
    } finally {
      setInspecting(false);
    }
  };

  const read = async () => {
    if (!inspection || refusal) return;
    setReading(true);
    try {
      const result = await readRemoteSource({
        url: inspection.url,
        nodeId,
        bbox,
        limit,
        columns: selectedColumns,
        inspection,
      });
      if (result) onClose();
    } catch (err: any) {
      addToast({ type: 'error', message: err?.message || 'The remote read failed.' });
    } finally {
      setReading(false);
    }
  };

  const toggleColumn = (name: string) =>
    setSelectedColumns((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    );

  /*
   * Portalled to the body because this dialog is opened from inside a node,
   * and React Flow puts a `transform` on the node canvas. A transformed
   * ancestor becomes the containing block for `position: fixed`, so without
   * the portal the overlay is positioned against the canvas and scales with
   * the zoom level instead of covering the window.
   */
  return createPortal(
    <div className="fixed inset-0 z-[400] flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-xl border border-slate-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Read remote data"
      >
        <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
            <Cloud className="h-4 w-4 text-blue-600" />
            Read remote data
          </h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-600" htmlFor="alur-remote-url">
              Parquet or GeoParquet URL
            </label>
            <div className="flex gap-2">
              <input
                id="alur-remote-url"
                autoFocus
                className={inputClass}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter' && url.trim()) void inspect(url); }}
                placeholder="https://data.source.coop/…/buildings.parquet"
              />
              <button
                type="button"
                onClick={() => void inspect(url)}
                disabled={!url.trim() || inspecting}
                className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {inspecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Inspect'}
              </button>
            </div>
            <p className="mt-1 text-[10px] leading-4 text-slate-400">
              The file stays where it is. Only the parts you ask for are fetched, so the host must allow
              cross-origin reads and honour range requests.
            </p>
          </div>

          {!inspection && !inspecting && (
            <div>
              <span className="mb-1.5 block text-[11px] font-semibold text-slate-600">Or start from a known dataset</span>
              <div className="space-y-1.5">
                {REMOTE_CATALOG.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => { setUrl(entry.url); void inspect(entry.url); }}
                    className="w-full rounded-lg border border-slate-200 p-2 text-left transition-colors hover:border-blue-200 hover:bg-blue-50/60"
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-xs font-semibold text-foreground">{entry.name}</span>
                      <span className="shrink-0 text-[10px] text-slate-400">{formatBytes(entry.byteSize)}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{entry.description}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-slate-400">{entry.publisher}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && (
            <p className="flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-[11px] font-medium text-rose-700">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {error}
            </p>
          )}

          {inspection && (
            <>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                <p className="font-semibold text-slate-800">{inspection.name}</p>
                <p className="mt-0.5">
                  {formatBytes(inspection.byteSize)}
                  {inspection.rowCount !== null && ` · ${inspection.rowCount.toLocaleString()} rows`}
                  {` · ${inspection.fields.length} columns`}
                </p>
                <p className="mt-1 text-[10px]">
                  {inspection.bboxPushdown
                    ? 'Has a bbox column, so an area filter skips row groups without reading them.'
                    : 'No bbox column, so an area filter still reads every row — a row limit is the cheaper guard.'}
                  {!inspection.acceptsRanges && ' The host did not advertise range support.'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="mb-1 block text-[11px] font-semibold text-slate-600">Area</span>
                  {bbox ? (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 px-2 py-1.5">
                      <p className="font-mono text-[10px] leading-4 text-blue-900">{roundedBbox(bbox)}</p>
                      <button type="button" onClick={() => setBbox(null)} className="mt-1 text-[10px] font-semibold text-blue-700 hover:underline">
                        Clear
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        const next = boundsFromMap();
                        if (!next) addToast({ type: 'warning', message: 'The map is not ready yet.' });
                        setBbox(next);
                      }}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2 text-[11px] font-semibold text-slate-500 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                    >
                      <Crop className="h-3 w-3" /> Use current map view
                    </button>
                  )}
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-slate-600" htmlFor="alur-remote-limit">
                    Row limit
                  </label>
                  <input
                    id="alur-remote-limit"
                    className={inputClass}
                    value={limitText}
                    onChange={(event) => setLimitText(event.target.value)}
                    inputMode="numeric"
                    placeholder="e.g. 50000"
                  />
                </div>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-slate-600">Columns</span>
                  <span className="text-[10px] text-slate-400">
                    {selectedColumns.length ? `${selectedColumns.length} selected` : 'All columns'}
                  </span>
                </div>
                <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                  {inspection.fields.map((field) => (
                    <button
                      key={field.name}
                      type="button"
                      onClick={() => toggleColumn(field.name)}
                      title={field.type}
                      className={cn(
                        'rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors',
                        selectedColumns.includes(field.name)
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                      )}
                    >
                      {field.name}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[10px] leading-4 text-slate-400">
                  Picking columns is the cheapest saving there is — Parquet stores them separately, so the
                  ones you leave out are never fetched. Geometry is always kept.
                </p>
              </div>

              {refusal && (
                <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-800">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {refusal}
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t bg-slate-50 px-4 py-3">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void read()}
            disabled={!inspection || Boolean(refusal) || reading}
            className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {reading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {reading ? 'Reading…' : 'Read into workflow'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
