import { AlertTriangle, CheckCircle2, CircleAlert, Lightbulb, X } from 'lucide-react';
import type { ExplainDocument } from '../../types/visualAnalytics';
import type { ExplainHealthIssue } from '../../utils/explainEvidence';
import { explainHealthCounts } from '../../utils/explainEvidence';
import { cn } from '../../utils/cn';

export const ExplainOutline = ({ document, issues, selectedCardId, onSelectCard, onClose, className }: {
  document: ExplainDocument;
  issues: ExplainHealthIssue[];
  selectedCardId?: string;
  onSelectCard: (cardId: string) => void;
  onClose?: () => void;
  className?: string;
}) => {
  const counts = explainHealthCounts(issues);
  const revealSection = (sectionId: string) => globalThis.document.getElementById(`explain-section-${sectionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const revealCard = (cardId: string) => { onSelectCard(cardId); globalThis.document.getElementById(`explain-card-${cardId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  return <aside className={cn('flex min-h-0 w-60 shrink-0 flex-col border-r border-slate-200 bg-white', className)} aria-label="Explanation outline">
    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><div><p className="text-[9px] font-bold uppercase tracking-[.16em] text-blue-600">Document</p><h2 className="text-sm font-extrabold text-slate-900">Outline</h2></div>{onClose && <button type="button" onClick={onClose} className="pressable rounded p-1 text-slate-600" aria-label="Close outline"><X className="h-4 w-4" /></button>}</div>
    <nav className="min-h-0 flex-1 overflow-y-auto p-3" aria-label="Explanation sections">
      {document.sections.map((section) => {
        const cards = document.cards.filter((card) => card.sectionId === section.id);
        return <div key={section.id} className="mb-3"><button type="button" onClick={() => revealSection(section.id)} className="pressable flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[10px] font-extrabold uppercase tracking-wide text-slate-600 hover:bg-slate-50"><span className="truncate">{section.title}</span><span className="tabular-nums text-slate-500">{cards.length}</span></button><div className="mt-1 space-y-0.5">{cards.map((card) => <button key={card.id} type="button" onClick={() => revealCard(card.id)} className={cn('pressable flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[10px] text-slate-600 hover:bg-slate-50', selectedCardId === card.id && 'bg-blue-50 font-bold text-blue-800')}><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" /><span className="truncate">{card.title || card.takeaway || card.claim || card.kind}</span></button>)}</div></div>;
      })}
    </nav>
    <div className="border-t border-slate-100 p-3">
      <div className="grid grid-cols-3 gap-1 text-center text-[9px]"><span className="rounded-md bg-rose-50 px-1 py-1.5 font-bold text-rose-700"><CircleAlert className="mx-auto mb-0.5 h-3 w-3" />{counts.errors}</span><span className="rounded-md bg-amber-50 px-1 py-1.5 font-bold text-amber-800"><AlertTriangle className="mx-auto mb-0.5 h-3 w-3" />{counts.warnings}</span><span className="rounded-md bg-blue-50 px-1 py-1.5 font-bold text-blue-700"><Lightbulb className="mx-auto mb-0.5 h-3 w-3" />{counts.suggestions}</span></div>
      <div className="mt-2 max-h-32 space-y-1 overflow-y-auto">{issues.length ? issues.slice(0, 6).map((issue) => <button key={issue.id} type="button" onClick={() => issue.cardId ? revealCard(issue.cardId) : issue.sectionId ? revealSection(issue.sectionId) : undefined} className="pressable flex w-full items-start gap-1.5 rounded px-1 py-1 text-left text-[9px] leading-4 text-slate-600 hover:bg-slate-50"><AlertTriangle className={cn('mt-0.5 h-3 w-3 shrink-0', issue.severity === 'error' ? 'text-rose-600' : issue.severity === 'warning' ? 'text-amber-600' : 'text-blue-600')} />{issue.message}</button>) : <p className="flex items-center gap-1 text-[9px] font-semibold text-emerald-700"><CheckCircle2 className="h-3 w-3" /> Evidence structure looks complete.</p>}</div>
    </div>
  </aside>;
};
