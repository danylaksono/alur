import { useState, type ComponentType } from 'react';
import { ArrowRight, BarChart3, GitCompareArrows, ScanSearch, Sparkles, Users } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { CompareWorkspace } from '../Compare/CompareWorkspace';
import { VariantPanel } from '../Variants/VariantPanel';
import { cn } from '../../utils/cn';

type AnalyseTask = 'home' | 'compare';

const TaskCard = ({ icon: Icon, title, question, action, onClick, disabled, quiet = false }: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  question: string;
  action: string;
  onClick: () => void;
  disabled?: boolean;
  quiet?: boolean;
}) => <button type="button" onClick={onClick} disabled={disabled} className={cn('group flex min-h-40 flex-col rounded-2xl border bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-45', quiet ? 'border-slate-200' : 'border-blue-100')}>
  <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl', quiet ? 'bg-slate-100 text-slate-600' : 'bg-blue-50 text-blue-700')}><Icon className="h-4 w-4" /></span>
  <strong className="mt-4 text-sm text-slate-900">{title}</strong>
  <span className="mt-1 text-xs leading-5 text-slate-600">{question}</span>
  <span className="mt-auto flex items-center gap-1 pt-4 text-[10px] font-bold text-blue-700">{disabled ? 'Add data first' : action}<ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" /></span>
</button>;

export const AnalyseWorkspace = () => {
  const [task, setTask] = useState<AnalyseTask>('home');
  const datasets = useStore((state) => state.datasetRegistry);
  const comparisons = useStore((state) => state.visualAnalytics.comparisons || []);
  const setActiveComparison = useStore((state) => state.setActiveComparison);
  const setWorkspaceMode = useStore((state) => state.setWorkspaceMode);
  const setActiveRailTab = useStore((state) => state.setActiveRailTab);
  const openDrawerTab = useStore((state) => state.openDrawerTab);
  const addToast = useStore((state) => state.addToast);
  const hasData = Object.keys(datasets).length > 0;

  const continueInExplore = (destination: 'inspect' | 'rank' | 'relate' | 'group') => {
    setWorkspaceMode('explore');
    if (destination === 'inspect') {
      openDrawerTab('table');
      addToast({ type: 'success', message: 'Select a row or map feature to inspect its details.' });
      return;
    }
    if (destination === 'rank') {
      setActiveRailTab('charts');
      addToast({ type: 'success', message: 'Create a bar chart, then order it to inspect high and low values.' });
      return;
    }
    if (destination === 'relate') {
      setActiveRailTab('charts');
      addToast({ type: 'success', message: 'Create a scatter chart to explore the relationship between two numeric fields.' });
      return;
    }
    setActiveRailTab('layers');
    addToast({ type: 'success', message: 'Use filters or spatial selection to define a group, then save it as a cohort.' });
  };

  if (task === 'compare') return <CompareWorkspace onBack={() => setTask('home')} />;

  return <main className="min-w-0 flex-1 overflow-y-auto bg-slate-50 px-4 py-8 md:px-8 md:py-10" aria-labelledby="analyse-heading">
    <div className="mx-auto max-w-5xl">
      <header className="max-w-2xl">
        <p className="text-[10px] font-bold uppercase tracking-[.18em] text-blue-600">Analyse</p>
        <h1 id="analyse-heading" className="mt-2 text-2xl font-black tracking-tight text-slate-950 md:text-3xl">What would you like to understand?</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Choose a question. ALUR will open the relevant tools and keep the technical options out of the way until you need them.</p>
      </header>

      {!hasData && <section className="mt-7 rounded-2xl border border-blue-100 bg-blue-50/60 p-5" aria-label="Add data to begin"><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-sm font-bold text-slate-900">Begin with a dataset</h2><p className="mt-1 text-xs text-slate-600">Parquet, CSV, JSON and GeoJSON files can be analysed locally in your browser.</p></div><button type="button" onClick={() => document.getElementById('alur-file-input')?.click()} className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white">Add data</button></div></section>}

      <section className="mt-8" aria-labelledby="common-questions-heading">
        <div className="flex items-end justify-between gap-4"><div><h2 id="common-questions-heading" className="text-sm font-extrabold text-slate-900">Common questions</h2><p className="mt-1 text-xs text-slate-500">Start with the outcome you need, rather than choosing a chart or method.</p></div></div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <TaskCard icon={ScanSearch} title="Inspect data" question="What is here, and what do I know about a selected place or record?" action="Open Explore" disabled={!hasData} onClick={() => continueInExplore('inspect')} />
          <TaskCard icon={GitCompareArrows} title="Compare groups" question="How do datasets, cohorts, places, time windows or scenarios differ?" action="Set up a comparison" disabled={!hasData} onClick={() => setTask('compare')} />
          <TaskCard icon={BarChart3} title="Rank values" question="Which records or places have the highest, lowest or most important values?" action="Open Visualise" disabled={!hasData} onClick={() => continueInExplore('rank')} />
        </div>
      </section>

      {comparisons.length > 0 && <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5" aria-labelledby="saved-analysis-heading"><div className="flex items-center justify-between gap-3"><div><h2 id="saved-analysis-heading" className="text-sm font-extrabold text-slate-900">Continue a saved comparison</h2><p className="mt-1 text-xs text-slate-500">Saved definitions retain their operands and source versions.</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-600">{comparisons.length}</span></div><div className="mt-3 grid gap-2 sm:grid-cols-2">{comparisons.slice(0, 4).map((comparison) => <button key={comparison.id} type="button" onClick={() => { setActiveComparison(comparison.id); setTask('compare'); }} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-3 text-left hover:border-blue-300 hover:bg-blue-50/40"><span className="min-w-0"><strong className="block truncate text-xs text-slate-800">{comparison.name}</strong><span className="mt-0.5 block text-[10px] text-slate-500">{comparison.operands.length} groups · {comparison.measures.length} measure{comparison.measures.length === 1 ? '' : 's'}</span></span><ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-400" /></button>)}</div></section>}

      <details className="group mt-8 rounded-2xl border border-slate-200 bg-white">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"><span><strong className="flex items-center gap-2 text-sm text-slate-800"><Sparkles className="h-4 w-4 text-violet-600" /> More ways to analyse</strong><span className="mt-1 block text-xs text-slate-500">Relationships, grouping and scenario tools are available when your question needs them.</span></span><span className="text-[10px] font-bold text-blue-700 group-open:hidden">Show</span><span className="hidden text-[10px] font-bold text-blue-700 group-open:inline">Hide</span></summary>
        <div className="border-t border-slate-100 p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <TaskCard quiet icon={BarChart3} title="Explore relationships" question="Do two measures appear to change together, and which records depart from the pattern?" action="Open Visualise" disabled={!hasData} onClick={() => continueInExplore('relate')} />
            <TaskCard quiet icon={Users} title="Define a group or area" question="Which records or places belong in a meaningful subset for later analysis?" action="Open Explore" disabled={!hasData} onClick={() => continueInExplore('group')} />
          </div>
          <details className="mt-5 rounded-xl bg-slate-50 p-4"><summary className="cursor-pointer text-xs font-bold text-slate-700">Scenario tools <span className="font-normal text-slate-500">(advanced)</span></summary><p className="mt-2 text-[10px] leading-4 text-slate-500">Create workflow-backed alternatives only when you need to test hypothetical changes. Ordinary exploration and comparison do not require a scenario.</p><VariantPanel /></details>
        </div>
      </details>
    </div>
  </main>;
};
