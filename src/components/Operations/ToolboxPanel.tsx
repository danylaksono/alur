import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Download, Loader2, Package, Play, Plug, Search, Workflow } from 'lucide-react';
import { useStore } from '../../store/useStore';
import type { OperationManifest, PluginCatalogue } from '../../types/operations';
import { operationHost } from '../../services/operationHost';
import type { LoadedPlugin } from '../../services/operationHostCore';
import catalogue from '../../data/pluginCatalogue.json';
import { AlgorithmDialog } from './AlgorithmDialog';
import { nextNodePosition } from '../../utils/nodePlacement';

/**
 * The toolbox: everything installed, browsable and searchable in one list.
 *
 * A palette rather than a loader, and the difference matters. Pointing the app
 * at one URL and configuring whatever came back means an analyst has to know
 * what exists before they can look for it. A toolbox inverts that — the question
 * becomes "what can this do?" rather than "what is the address of the thing I
 * already know I want" — and it is the only arrangement that survives a growing
 * set of plugins.
 *
 * Nothing here names a calculation. The tree, its groups and its search index
 * are read entirely from what the installed plugins declare.
 */

type Entry = { plugin: LoadedPlugin; manifest: OperationManifest };

/** Words a search should match, gathered from what the manifest declares. */
const haystack = (entry: Entry) =>
  [
    entry.manifest.label,
    entry.manifest.description,
    entry.manifest.group ?? '',
    entry.plugin.plugin.label,
    ...(entry.manifest.keywords ?? []),
  ]
    .join(' ')
    .toLowerCase();

export const ToolboxPanel = () => {
  const addToast = useStore((state) => state.addToast);
  const addNode = useStore((state) => state.addNode);
  const navigate = useStore((state) => state.navigate);
  const requestWorkflowFit = useStore((state) => state.requestWorkflowFit);

  const [plugins, setPlugins] = useState<LoadedPlugin[]>([]);
  const [query, setQuery] = useState('');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState<Entry | null>(null);

  // What ships with the app, asked for once. The host answers from providers it
  // registered at start-up, so nothing is fetched and this cannot fail for
  // network reasons.
  useEffect(() => {
    let cancelled = false;
    operationHost
      .installed()
      .then((installed) => { if (!cancelled) setPlugins(installed); })
      .catch((error) => addToast({
        type: 'error',
        message: `The calculation host would not start: ${error instanceof Error ? error.message : String(error)}`,
      }));
    return () => { cancelled = true; };
  }, [addToast]);

  const known = (catalogue as PluginCatalogue).plugins.filter(
    (entry) => !plugins.some((loaded) => loaded.plugin.name === entry.name),
  );

  const load = async (override?: string) => {
    const target = (override ?? url).trim();
    if (!target) return;
    setLoading(true);
    try {
      // A plugin manifest is the supported route; a bare module still loads, so
      // anything written before packaging existed keeps working.
      const loaded = target.endsWith('.json')
        ? await operationHost.loadPlugin(target)
        : {
          plugin: {
            contract: 1, name: 'unpackaged', label: 'Loaded by URL', version: '—',
            entry: target, calculations: [],
          },
          entryUrl: target,
          calculations: await operationHost.load(target),
        } satisfies LoadedPlugin;

      setPlugins((current) => [
        ...current.filter((existing) => existing.plugin.name !== loaded.plugin.name),
        loaded,
      ]);
      setUrl('');
      addToast({
        type: 'success',
        message: `Installed ${loaded.plugin.label} — ${loaded.calculations.length} calculation${loaded.calculations.length === 1 ? '' : 's'}.`,
      });
    } catch (error) {
      addToast({ type: 'error', message: `Could not install the plugin: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setLoading(false);
    }
  };

  const entries = useMemo(
    () => plugins.flatMap((plugin) => plugin.calculations.map((manifest) => ({ plugin, manifest }))),
    [plugins],
  );

  const matched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    const words = needle.split(/\s+/);
    return entries.filter((entry) => {
      const text = haystack(entry);
      return words.every((word) => text.includes(word));
    });
  }, [entries, query]);

  /**
   * Plugin, then group, then algorithm — the shape the tree renders.
   *
   * Rebuilt from the matches rather than filtered in place, so searching hides
   * an empty group instead of leaving a heading with nothing under it.
   */
  const tree = useMemo(() => {
    const byPlugin = new Map<string, { plugin: LoadedPlugin; groups: Map<string, Entry[]> }>();
    for (const entry of matched) {
      const name = entry.plugin.plugin.name;
      const bucket = byPlugin.get(name) ?? { plugin: entry.plugin, groups: new Map<string, Entry[]>() };
      const group = entry.manifest.group?.trim() || '';
      const list = bucket.groups.get(group) ?? [];
      list.push(entry);
      bucket.groups.set(group, list);
      byPlugin.set(name, bucket);
    }
    for (const bucket of byPlugin.values()) {
      for (const list of bucket.groups.values()) list.sort((a, b) => a.manifest.label.localeCompare(b.manifest.label));
    }
    return [...byPlugin.values()];
  }, [matched]);

  const toggle = (key: string) => setCollapsed((current) => ({ ...current, [key]: !current[key] }));

  /**
   * The same algorithm, placed as a step instead of run once.
   *
   * This is the whole point of a toolbox over a menu of dialogs: an algorithm
   * you ran and an algorithm you built into a pipeline are the same algorithm,
   * so it is one list with two gestures rather than two lists that drift.
   */
  const place = (entry: Entry) => {
    const id = `calculation-${Date.now()}`;
    addNode({
      id,
      type: 'calculation',
      position: nextNodePosition(useStore.getState().nodes),
      data: {
        label: entry.manifest.label,
        type: 'calculation',
        config: {
          pluginUrl: entry.plugin.entryUrl,
          calculationId: entry.manifest.id,
          calculationVersion: entry.manifest.version,
          label: entry.manifest.label,
          fields: {},
          parameters: Object.fromEntries(
            entry.manifest.parameters.map((parameter) => [parameter.id, parameter.defaultValue]),
          ),
          outputId: entry.manifest.outputs[0]?.id,
        },
      },
    });
    navigate('workflow');
    requestWorkflowFit();
    addToast({
      type: 'info',
      message: `Added ${entry.manifest.label} to the workflow. Connect its inputs, then run it on the node.`,
    });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden" role="region" aria-label="Calculations toolbox">
      <div className="border-b border-slate-100 px-3 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search calculations…"
            aria-label="Search calculations"
            className="w-full rounded-md border border-slate-200 py-1 pl-7 pr-2 text-[11px] text-slate-700 focus:border-slate-400 focus:outline-none"
          />
        </div>
        {query.trim() && (
          <p className="mt-1 text-[9px] text-slate-400">
            {matched.length} of {entries.length} {entries.length === 1 ? 'calculation' : 'calculations'}
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {!entries.length && (
          <p className="flex items-start gap-1.5 px-1 py-3 text-[10px] leading-relaxed text-slate-400">
            <Plug className="mt-0.5 h-3 w-3 shrink-0" />
            Nothing is installed yet. Add a plugin below and its calculations appear here.
          </p>
        )}

        {tree.map(({ plugin, groups }) => {
          const pluginKey = plugin.plugin.name;
          const pluginOpen = !collapsed[pluginKey];
          return (
            <div key={pluginKey} className="mb-1">
              <button
                type="button"
                onClick={() => toggle(pluginKey)}
                className="pressable flex w-full items-center gap-1 rounded-md px-1 py-1 text-left hover:bg-slate-50"
              >
                {pluginOpen ? <ChevronDown className="h-3 w-3 shrink-0 text-slate-400" /> : <ChevronRight className="h-3 w-3 shrink-0 text-slate-400" />}
                <Package className="h-3 w-3 shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1 truncate text-[10px] font-bold text-slate-700">{plugin.plugin.label}</span>
                <span className="shrink-0 text-[9px] text-slate-400">{plugin.plugin.version}</span>
              </button>

              {pluginOpen && [...groups.entries()]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([group, items]) => {
                  const groupKey = `${pluginKey}/${group}`;
                  const groupOpen = !collapsed[groupKey];
                  return (
                    <div key={groupKey} className="ml-3">
                      {group && (
                        <button
                          type="button"
                          onClick={() => toggle(groupKey)}
                          className="pressable flex w-full items-center gap-1 rounded-md px-1 py-0.5 text-left hover:bg-slate-50"
                        >
                          {groupOpen ? <ChevronDown className="h-2.5 w-2.5 shrink-0 text-slate-300" /> : <ChevronRight className="h-2.5 w-2.5 shrink-0 text-slate-300" />}
                          <span className="min-w-0 flex-1 truncate text-[9px] font-bold uppercase tracking-wider text-slate-400">{group}</span>
                        </button>
                      )}
                      {(groupOpen || !group) && items.map((entry) => (
                        <div key={entry.manifest.id} className="group flex items-center rounded-md hover:bg-blue-50">
                          <button
                            type="button"
                            onClick={() => setOpen(entry)}
                            title={entry.manifest.description}
                            className="pressable flex min-w-0 flex-1 items-center gap-1.5 py-1 pl-4 pr-1 text-left"
                          >
                            <Play className="h-2.5 w-2.5 shrink-0 text-slate-300 group-hover:text-blue-500" />
                            <span className="min-w-0 flex-1 truncate text-[10px] text-slate-700 group-hover:text-blue-700">{entry.manifest.label}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => place(entry)}
                            title="Add to the workflow as a step"
                            aria-label={`Add ${entry.manifest.label} to the workflow`}
                            className="pressable mr-1 shrink-0 rounded p-1 text-slate-300 opacity-0 hover:bg-white hover:text-blue-600 focus:opacity-100 group-hover:opacity-100"
                          >
                            <Workflow className="h-2.5 w-2.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>

      <div className="border-t border-slate-100 px-3 py-3">
        <h3 className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">Add a plugin</h3>
        {known.length > 0 && (
          <select
            value=""
            onChange={(event) => { if (event.target.value) void load(event.target.value); }}
            className="mb-1 w-full rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-700 focus:border-slate-400 focus:outline-none"
            aria-label="Known plugins"
          >
            <option value="">Choose a known plugin…</option>
            {known.map((entry) => <option key={entry.url} value={entry.url}>{entry.label}</option>)}
          </select>
        )}
        <div className="flex gap-1">
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void load(); }}
            placeholder="https://…/alur.plugin.json"
            aria-label="Plugin manifest URL"
            className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-700 focus:border-slate-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || !url.trim()}
            className="pressable flex items-center gap-1 rounded-md bg-slate-800 px-2 py-1 text-[10px] font-bold text-white hover:bg-slate-700 disabled:opacity-40"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} Add
          </button>
        </div>
      </div>

      {open && (
        <AlgorithmDialog
          key={open.manifest.id}
          manifest={open.manifest}
          entryUrl={open.plugin.entryUrl}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
};
