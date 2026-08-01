import { useEffect, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, Loader2, X, XCircle } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { clearSourceCache, sourceCacheUsage } from '../../services/sourceCache';
import { testOpenRouterConnection } from '../../utils/openrouter';

const formatBytes = (bytes: number) => {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`;
  return `${bytes} B`;
};

export const SettingsDialog = () => {
  const isOpen = useStore((s) => s.ui.isSettingsOpen);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);

  const [apiKey, setApiKey] = useState(settings.openRouterApiKey);
  const [modelId, setModelId] = useState(settings.openRouterModelId);
  const [authorName, setAuthorName] = useState(settings.authorName);
  const [showKey, setShowKey] = useState(false);
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'failed'>('idle');
  const [cacheUsage, setCacheUsage] = useState<{ count: number; bytes: number } | null>(null);
  const [isClearingCache, setClearingCache] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setApiKey(settings.openRouterApiKey);
      setModelId(settings.openRouterModelId);
      setAuthorName(settings.authorName);
      setTestState('idle');
      setShowKey(false);
      setCacheUsage(null);
      void sourceCacheUsage().then(setCacheUsage).catch(() => setCacheUsage({ count: 0, bytes: 0 }));
    }
  }, [isOpen, settings.openRouterApiKey, settings.openRouterModelId, settings.authorName]);

  if (!isOpen) return null;

  const handleTest = async () => {
    setTestState('testing');
    const ok = await testOpenRouterConnection(apiKey.trim());
    setTestState(ok ? 'ok' : 'failed');
  };

  const handleClearCache = async () => {
    setClearingCache(true);
    try {
      await clearSourceCache();
      setCacheUsage({ count: 0, bytes: 0 });
    } finally {
      setClearingCache(false);
    }
  };

  const handleSave = () => {
    updateSettings({
      openRouterApiKey: apiKey.trim(),
      openRouterModelId: modelId.trim() || 'openai/gpt-4o-mini',
      authorName: authorName.trim(),
    });
    setSettingsOpen(false);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4"
      onClick={() => setSettingsOpen(false)}
    >
      <div
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Settings"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-bold text-slate-800">Settings</h2>
          <button
            type="button"
            onClick={() => setSettingsOpen(false)}
            className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          <div>
            <h3 className="mb-1 text-xs font-semibold text-slate-700">You</h3>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-slate-600">Name</span>
              <input
                type="text"
                value={authorName}
                onChange={(e) => setAuthorName(e.target.value)}
                placeholder="Shown as the author of stories you share"
                maxLength={80}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
              />
            </label>
          </div>

          <div className="border-t border-slate-100 pt-4">
            <h3 className="mb-1 text-xs font-semibold text-slate-700">AI Copilot (bring your own key)</h3>
            <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
              The copilot calls OpenRouter directly from your browser. Your key is stored only in
              this browser's local storage and is never bundled with the app or sent anywhere else.
            </p>

            <label className="mb-3 block">
              <span className="mb-1 block text-[11px] font-semibold text-slate-600">OpenRouter API key</span>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => { setApiKey(e.target.value); setTestState('idle'); }}
                  placeholder="sk-or-…"
                  autoComplete="off"
                  className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-3 pr-9 font-mono text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600"
                  title={showKey ? 'Hide key' : 'Show key'}
                >
                  {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-slate-600">Model ID</span>
              <input
                type="text"
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                placeholder="openai/gpt-4o-mini"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
              />
              <span className="mt-1 block text-[11px] text-slate-400">
                Any OpenRouter model ID, e.g. <code>anthropic/claude-haiku-4.5</code> or <code>openai/gpt-4o-mini</code>.
              </span>
            </label>
          </div>

          {/* Cached data is written to the user's disk without being asked for,
              so it has to be visible and removable from somewhere obvious. */}
          <div className="border-t border-slate-100 pt-4">
            <h3 className="mb-1 text-xs font-semibold text-slate-700">Cached data files</h3>
            <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
              A copy of each file you load is kept in this browser so reopening a project does not mean
              finding every file again. Nothing leaves your device, and clearing this only means you will
              be asked to pick those files the next time you open a project that uses them.
            </p>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <span className="text-[11px] font-semibold text-slate-600">
                {cacheUsage === null
                  ? 'Checking…'
                  : cacheUsage.count === 0
                    ? 'Nothing cached'
                    : `${cacheUsage.count} file${cacheUsage.count === 1 ? '' : 's'} · ${formatBytes(cacheUsage.bytes)}`}
              </span>
              <button
                type="button"
                disabled={!cacheUsage?.count || isClearingCache}
                onClick={handleClearCache}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isClearingCache ? 'Clearing…' : 'Clear'}
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t bg-slate-50 px-4 py-3">
          <button
            type="button"
            onClick={handleTest}
            disabled={!apiKey.trim() || testState === 'testing'}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {testState === 'testing' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {testState === 'ok' && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
            {testState === 'failed' && <XCircle className="h-3.5 w-3.5 text-rose-500" />}
            {testState === 'ok' ? 'Connection OK' : testState === 'failed' ? 'Connection failed' : 'Test connection'}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSettingsOpen(false)}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-700"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
