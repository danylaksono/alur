import { CheckCircle2, Circle, Route } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { ANALYSIS_PATTERNS, patternReadiness } from '../../patterns/analysisPatterns';
import { cn } from '../../utils/cn';

export const PatternGuide = ({ compact = false }: { compact?: boolean }) => {
  const analytics = useStore((state) => state.visualAnalytics);
  const activePatternId = analytics.activePatternId;
  const setActivePattern = useStore((state) => state.setActivePattern);
  const selected = ANALYSIS_PATTERNS.find((pattern) => pattern.id === activePatternId);
  const readiness = selected ? patternReadiness(selected.id, analytics) : [];
  return <section className={cn('rounded-xl border border-slate-200 bg-white', compact ? 'mt-5 p-3' : 'p-4')}>
    <div className="flex items-center gap-2"><Route className="h-4 w-4 text-violet-600" /><h3 className="text-xs font-bold text-slate-800">Analysis pattern</h3></div>
    <select value={activePatternId || ''} onChange={(event) => setActivePattern(event.target.value || undefined)} className="mt-2 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-[11px]" aria-label="Optional analysis pattern"><option value="">No pattern guidance</option>{ANALYSIS_PATTERNS.map((pattern) => <option key={pattern.id} value={pattern.id}>{pattern.name}</option>)}</select>
    {selected && <div className="mt-3"><p className="text-[10px] leading-relaxed text-slate-500">{selected.description}</p><ul className="mt-2 space-y-1.5">{readiness.map((item) => <li key={item.id} className="flex gap-2 text-[10px]" title={item.ready ? 'Covered' : item.note}>{item.ready ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" /> : <Circle className="h-3.5 w-3.5 shrink-0 text-slate-300" />}<span className={item.ready ? 'text-slate-700' : 'text-slate-500'}>{item.label}{!item.ready && <span className="text-slate-400"> — {item.note}</span>}</span></li>)}</ul><p className="mt-2 text-[9px] leading-relaxed text-slate-400">Advisory only. Jump between capabilities in any order.</p></div>}
  </section>;
};
