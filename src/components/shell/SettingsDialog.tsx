import { useEffect, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, Loader2, X, XCircle } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { testOpenRouterConnection } from '../../utils/openrouter';

export const SettingsDialog = () => {
  const isOpen = useStore((s) => s.ui.isSettingsOpen);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);

  const [apiKey, setApiKey] = useState(settings.openRouterApiKey);
  const [modelId, setModelId] = useState(settings.openRouterModelId);
  const [showKey, setShowKey] = useState(false);
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'failed'>('idle');

  useEffect(() => {
    if (isOpen) {
      setApiKey(settings.openRouterApiKey);
      setModelId(settings.openRouterModelId);
      setTestState('idle');
      setShowKey(false);
    }
  }, [isOpen, settings.openRouterApiKey, settings.openRouterModelId]);

  if (!isOpen) return null;

  const handleTest = async () => {
    setTestState('testing');
    const ok = await testOpenRouterConnection(apiKey.trim());
    setTestState(ok ? 'ok' : 'failed');
  };

  const handleSave = () => {
    updateSettings({
      openRouterApiKey: apiKey.trim(),
      openRouterModelId: modelId.trim() || 'openai/gpt-4o-mini',
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
