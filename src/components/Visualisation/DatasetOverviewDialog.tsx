import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Database, Loader2, Search, X } from 'lucide-react';
import { useStore } from '../../store/useStore';
import type { DatasetProfile } from '../../types/datasets';
import type { VisualFilter } from '../../types/visualAnalytics';
import { metadataForLayer } from '../../utils/datasetMetadata';
import { queryLayerDatasetProfile } from '../../services/visualAnalyticsService';
import { FieldQuickExploreMenu } from './FieldQuickExploreMenu';
import { FilterEditorDialog } from './FilterEditorDialog';
import { useAnalyticsCommands } from '../../hooks/useAnalyticsCommands';

const formatNumber = (value: number | undefined) => value === undefined ? 'n/a' : value.toLocaleString(undefined, { maximumFractionDigits: 2, notation: Math.abs(value) >= 100_000 ? 'compact' : 'standard' });

export const DatasetOverviewDialog = () => {
  const layerId = useStore((state) => state.ui.datasetOverviewLayerId);
  const layer = useStore((state) => state.mapLayers.find((item) => item.id === state.ui.datasetOverviewLayerId));
  const setOpen = useStore((state) => state.setDatasetOverviewLayerId);
  const openDrawerTab = useStore((state) => state.openDrawerTab);
  const setLayerFilters = useStore((state) => state.setLayerFilters);
  const execute = useAnalyticsCommands();
  const [profile, setProfile] = useState<DatasetProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [newFilter, setNewFilter] = useState<VisualFilter | null>(null);
  const metadata = useMemo(() => layer ? metadataForLayer(layer) : null, [layer]);

  useEffect(() => {
    if (!layer) { setProfile(null); return; }
    let cancelled = false;
    let timer = 0;
    setProfile(null);
    setError(null);
    setLoading(true);
    const run = () => queryLayerDatasetProfile(layer)
      .then((next) => { if (!cancelled) setProfile(next); })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Profile query failed'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    timer = window.setTimeout(run, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [layer]);

  useEffect(() => {
    if (!layerId) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !newFilter) setOpen(null); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [layerId, newFilter, setOpen]);

  if (!layerId || !layer || !metadata) return null;
  const fields = (profile?.fields || metadata.fields).filter((field) => `${field.name} ${field.type} ${field.semanticType}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const runCommand = (command: Parameters<typeof execute>[0]) => { void execute(command); };
  const inspectField = (field?: string, missing = false) => {
    if (field && missing) {
      const filters = useStore.getState().visualAnalytics.datasets[layer.id]?.filters || [];
      setLayerFilters(layer.id, [...filters.filter((item) => !(item.kind === 'null' && item.field === field)), { kind: 'null', field, isNull: true }]);
    }
    openDrawerTab('table');
    setOpen(null);
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/35 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(null); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="dataset-overview-title" className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b bg-slate-50 px-5 py-4">
          <div className="min-w-0">
            <h2 id="dataset-overview-title" className="truncate text-base font-extrabold text-slate-800">{layer.name}</h2>
            <p className="mt-1 text-[11px] text-slate-500">Dataset overview · cheap metadata appears immediately; detailed statistics are cached by source version.</p>
          </div>
          <button type="button" onClick={() => setOpen(null)} aria-label="Close dataset overview" className="rounded-md p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-700"><X className="h-4 w-4" /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Rows', (profile?.rowCount ?? metadata.rowCount ?? layer.featureCount).toLocaleString()],
              ['Fields', (profile?.fieldCount ?? metadata.fields.length).toLocaleString()],
              ['Geometry', metadata.geometryKind || 'Unknown'],
              ['CRS', profile?.geometry?.crs || metadata.crs || 'Unknown'],
            ].map(([label, value]) => <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 p-3"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div><div className="mt-1 truncate text-lg font-extrabold capitalize text-slate-800" title={value}>{value}</div></div>)}
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <section>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 text-xs font-bold text-slate-700"><Database className="h-4 w-4 text-sky-600" /> Fields</h3>
                <label className="flex h-8 w-64 max-w-full items-center gap-2 rounded-md border border-slate-200 bg-white px-2 focus-within:border-sky-400">
                  <Search className="h-3.5 w-3.5 text-slate-400" /><span className="sr-only">Search fields</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search fields" className="min-w-0 flex-1 text-xs outline-none" />
                </label>
              </div>
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <div className="grid grid-cols-[minmax(8rem,1fr)_7rem_6rem_7rem_2rem] gap-2 bg-slate-50 px-3 py-2 text-[9px] font-semibold uppercase tracking-wide text-slate-400"><span>Field</span><span>Type</span><span>Missing</span><span>Range / distinct</span><span /></div>
                <div className="max-h-[45vh] divide-y divide-slate-100 overflow-y-auto">
                  {fields.map((field) => {
                    const detailed = profile?.fields.find((item) => item.name === field.name) || null;
                    return <div key={field.name} className="grid grid-cols-[minmax(8rem,1fr)_7rem_6rem_7rem_2rem] items-center gap-2 px-3 py-2 text-[11px] hover:bg-slate-50">
                      <div className="min-w-0"><div className="truncate font-semibold text-slate-700" title={field.name}>{field.name}</div><div className="text-[9px] capitalize text-slate-400">{field.semanticType}</div></div>
                      <span className="truncate font-mono text-[9px] text-slate-400" title={field.type}>{field.type}</span>
                      <button type="button" disabled={!detailed} onClick={() => detailed?.nullCount && inspectField(field.name, true)} className="text-left tabular-nums text-slate-500 enabled:hover:text-sky-700">{detailed ? `${(detailed.nullPercent * 100).toFixed(1)}%` : '…'}</button>
                      <span className="min-w-0 truncate tabular-nums text-slate-500" title={detailed ? `${detailed.distinctCount.toLocaleString()} distinct` : 'Profiling'}>
                        {detailed?.semanticType === 'numeric' ? <span className="block"><span className="block truncate">{formatNumber(detailed.min)}–{formatNumber(detailed.max)}</span>{detailed.quantiles && detailed.quantiles.length > 1 && <span className="mt-0.5 flex h-1 items-center gap-px" aria-label={`Quantiles ${detailed.quantiles.map(formatNumber).join(', ')}`}>{detailed.quantiles.map((value, index) => <span key={`${value}-${index}`} className="h-1 flex-1 rounded-full bg-sky-400" style={{ opacity: 0.25 + index * 0.15 }} />)}</span>}</span> : detailed?.semanticType === 'temporal' ? `${detailed.temporalStart?.slice(0, 10) || 'n/a'}–${detailed.temporalEnd?.slice(0, 10) || 'n/a'}` : detailed ? `${detailed.distinctCount.toLocaleString()} distinct` : '…'}
                      </span>
                      <FieldQuickExploreMenu field={field} onChart={() => runCommand({ type: 'create-chart', datasetId: layer.id, field: field.name })} onFilter={setNewFilter} onProfile={() => inspectField(field.name)} onStyle={() => runCommand({ type: 'open-layer-style', datasetId: layer.id, field: field.name })} onPinMetric={field.semanticType === 'numeric' ? () => runCommand({ type: 'pin-kpi', datasetId: layer.id, field: field.name }) : undefined} />
                    </div>;
                  })}
                  {!fields.length && <div className="px-3 py-8 text-center text-xs text-slate-400">No matching fields.</div>}
                </div>
              </div>
            </section>

            <aside className="space-y-3">
              <div className="flex items-center justify-between"><h3 className="text-xs font-bold text-slate-700">Quality signals</h3>{loading && <Loader2 className="h-4 w-4 animate-spin text-sky-500" />}</div>
              <p className="text-[10px] leading-relaxed text-slate-400">Signals identify values worth inspecting; unusual data is not necessarily erroneous.</p>
              {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-[11px] text-rose-700">Detailed profiling failed: {error}</div>}
              {profile && !profile.issues.length && <div className="flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-[11px] text-emerald-700"><CheckCircle2 className="h-4 w-4 shrink-0" /> No prominent quality signals in the profiled fields.</div>}
              {profile?.issues.map((issue) => <button key={issue.id} type="button" onClick={() => inspectField(issue.field, issue.action === 'filter-missing')} className={`flex w-full gap-2 rounded-lg border p-3 text-left text-[11px] leading-relaxed ${issue.severity === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-sky-100 bg-sky-50 text-sky-800'}`}><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{issue.message}<span className="mt-1 block text-[9px] font-semibold uppercase tracking-wide opacity-70">Inspect in table</span></span></button>)}
              {profile?.geometry && <div className="rounded-lg border border-slate-200 p-3 text-[10px] text-slate-500"><div className="font-semibold uppercase tracking-wide text-slate-400">Spatial metadata</div><dl className="mt-2 grid grid-cols-2 gap-1"><dt>CRS confidence</dt><dd className="text-right capitalize">{profile.geometry.crsConfidence}</dd><dt>Sample valid</dt><dd className="text-right">{profile.geometry.sampledFeatures ? `${profile.geometry.sampledValid}/${profile.geometry.sampledFeatures}` : 'not sampled'}</dd><dt>Extent</dt><dd className="truncate text-right" title={JSON.stringify(profile.geometry.extent)}>{profile.geometry.extent ? 'available' : 'unknown'}</dd></dl></div>}
            </aside>
          </div>
        </div>
      </section>
      {newFilter && <FilterEditorDialog filter={newFilter} title={`Filter ${newFilter.field}`} onApply={(filter) => { const filters = useStore.getState().visualAnalytics.datasets[layer.id]?.filters || []; setLayerFilters(layer.id, [...filters.filter((item) => !(item.field === filter.field && item.kind === filter.kind)), filter]); setNewFilter(null); }} onCancel={() => setNewFilter(null)} />}
    </div>
  );
};
