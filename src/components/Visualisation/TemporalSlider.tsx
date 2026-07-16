import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import type { TemporalRange } from '../../services/visualAnalyticsService';
import type { VisualFilter } from '../../types/visualAnalytics';
import { cn } from '../../utils/cn';

const pad = (n: number) => String(n).padStart(2, '0');

const formatIso = (date: string) => {
  try {
    const d = new Date(date);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  } catch {
    return date;
  }
};

const addDays = (date: string, days: number) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const daysBetween = (a: string, b: string) => {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  return Math.max(1, Math.round((db - da) / 86400000));
};

export const TemporalSlider = ({
  range,
  field,
  currentFilter,
  onApply,
}: {
  range: TemporalRange;
  field: string;
  currentFilter?: VisualFilter;
  onApply: (filter: VisualFilter) => void;
}) => {
  const totalDays = daysBetween(range.minDate, range.maxDate);
  const windowDays = Math.max(7, Math.min(365, Math.round(totalDays / 10)));
  const [windowSize, setWindowSize] = useState(windowDays);
  const [currentStart, setCurrentStart] = useState(
    currentFilter?.kind === 'temporal' && currentFilter.start
      ? currentFilter.start
      : range.minDate,
  );
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(3);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentEnd = useMemo(() => addDays(currentStart, windowSize), [currentStart, windowSize]);

  const progress = useMemo(() => {
    const startOffset = daysBetween(range.minDate, currentStart);
    return Math.min(1, startOffset / (totalDays - windowSize));
  }, [range.minDate, currentStart, totalDays, windowSize]);

  useEffect(() => {
    onApply({
      kind: 'temporal',
      field,
      start: currentStart,
      end: currentEnd,
    });
  }, [currentStart, windowSize, field, onApply]);

  useEffect(() => {
    if (playing) {
      const interval = 1200 / speed;
      timer.current = setInterval(() => {
        setCurrentStart((prev) => {
          const next = addDays(prev, windowSize);
          if (daysBetween(next, range.maxDate) <= 1) {
            setPlaying(false);
            return prev;
          }
          return next;
        });
      }, interval);
    } else if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, speed, windowSize, range.maxDate]);

  const handleSlider = (event: React.ChangeEvent<HTMLInputElement>) => {
    const fraction = Number(event.target.value) / 1000;
    const dayOffset = Math.round(fraction * (totalDays - windowSize));
    setCurrentStart(addDays(range.minDate, dayOffset));
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Time · {field}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCurrentStart(range.minDate)}
            disabled={playing}
            className="rounded border border-slate-200 p-1 text-slate-400 hover:bg-slate-50 disabled:opacity-30"
          >
            <SkipBack className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            className={cn(
              'rounded border p-1',
              playing
                ? 'border-purple-300 bg-purple-50 text-purple-600'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50',
            )}
          >
            {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          </button>
          <button
            type="button"
            onClick={() => setCurrentStart(addDays(range.maxDate, -windowSize))}
            disabled={playing}
            className="rounded border border-slate-200 p-1 text-slate-400 hover:bg-slate-50 disabled:opacity-30"
          >
            <SkipForward className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="relative">
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(progress * 1000)}
          onChange={handleSlider}
          className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-purple-600"
        />
      </div>

      <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600">
        <span>{formatIso(currentStart)}</span>
        <span>{formatIso(currentEnd)}</span>
      </div>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Window
          <select
            value={windowSize}
            onChange={(e) => setWindowSize(Number(e.target.value))}
            className="h-7 rounded border border-slate-200 bg-white px-1.5 text-[11px] font-semibold text-slate-700"
          >
            {[7, 14, 30, 90, 180, 365].map((d) => (
              <option key={d} value={d}>{d}d</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Speed
          <input
            type="range"
            min={1}
            max={10}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="h-2 w-16 accent-purple-600"
          />
        </label>
      </div>
    </div>
  );
};
