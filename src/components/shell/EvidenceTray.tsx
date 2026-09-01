import { ChevronDown, ChevronUp, Gauge } from 'lucide-react';
import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { KpiShelf } from '../Visualisation/KpiShelf';

export const EvidenceTray = () => {
  const [open, setOpen] = useState(true);
  const count = useStore((state) => state.visualAnalytics.kpis.length);
  if (!count) return null;
  return <section className="shrink-0 border-t border-slate-200 bg-slate-50" aria-label="Evidence tray">
    <button type="button" onClick={() => setOpen(!open)} className="pressable flex h-7 w-full items-center gap-1.5 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-500" aria-expanded={open}><Gauge className="h-3 w-3 text-sky-600" /> Evidence tray <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px]">{count}</span>{open ? <ChevronDown className="ml-auto h-3 w-3" /> : <ChevronUp className="ml-auto h-3 w-3" />}</button>
    {open && <KpiShelf />}
  </section>;
};
