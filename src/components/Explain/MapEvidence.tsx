import { AlertCircle, Map } from 'lucide-react';
import type { MapEvidenceCapture } from '../../types/story';
import type { ExplainCard } from '../../types/visualAnalytics';

const cameraLabel = (camera: MapEvidenceCapture['camera']) =>
  `${camera.latitude.toFixed(4)}, ${camera.longitude.toFixed(4)} · z${camera.zoom.toFixed(1)}`
  + (camera.bearing ? ` · ${Math.round(camera.bearing)}°` : '')
  + (camera.pitch ? ` · ${Math.round(camera.pitch)}° pitch` : '');

/**
 * Renders what was actually captured from the map, and says so plainly when
 * nothing was. This card used to promise a "replayable map view" while
 * preserving nothing, which is worse than showing a gap.
 */
export const MapEvidence = ({ card }: { card: ExplainCard }) => {
  const capture = card.frozenValues as MapEvidenceCapture | undefined;

  if (!capture?.image) {
    return (
      <div className="flex h-full min-h-32 items-center justify-center rounded-lg bg-slate-100 p-4 text-center">
        <div>
          <AlertCircle className="mx-auto h-6 w-6 text-amber-500" />
          <p className="mt-2 text-xs font-semibold text-slate-700">No map image was captured</p>
          <p className="mt-1 text-[11px] leading-4 text-slate-500">
            {capture?.failureReason || 'Capture this card again while the map is visible.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <figure className="flex h-full min-h-0 flex-col">
      <img
        src={capture.image}
        alt={card.title ? `Map: ${card.title}` : 'Captured map view'}
        className="min-h-0 w-full flex-1 rounded-lg border border-slate-200 object-cover"
        loading="lazy"
      />
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
        <span className="flex items-center gap-1 font-semibold text-slate-600">
          <Map className="h-3 w-3" />{capture.layers.length} {capture.layers.length === 1 ? 'layer' : 'layers'}
        </span>
        {capture.layers.slice(0, 3).map((layer) => (
          <span key={layer.name} className="truncate rounded-full bg-slate-100 px-1.5 py-0.5">{layer.name}</span>
        ))}
        {capture.layers.length > 3 && <span>+{capture.layers.length - 3} more</span>}
        <span className="ml-auto font-mono tabular-nums">{cameraLabel(capture.camera)}</span>
      </figcaption>
    </figure>
  );
};
