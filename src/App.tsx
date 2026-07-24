import { useEffect } from 'react';
import { useStore } from './store/useStore';
import { duckdbService } from './services/duckdb';
import { AppShell } from './components/shell/AppShell';

export default function App() {
  const setDuckDBReady = useStore((s) => s.setDuckDBReady);

  useEffect(() => {
    const init = async () => {
      const { startLoadingOperation } = useStore.getState();
      startLoadingOperation({
        id: 'engine-initialisation',
        title: 'Starting the analysis engine',
        detail: 'Preparing DuckDB and spatial tools…',
        progress: 20,
      });
      try {
        await duckdbService.init();
        setDuckDBReady(true);
      } catch (e) {
        console.error('DuckDB Init failed', e);
        useStore.getState().addToast({ type: 'error', message: 'The analysis engine failed to start.' });
      } finally {
        useStore.getState().finishLoadingOperation('engine-initialisation');
      }
    };
    init();
  }, [setDuckDBReady]);

  return <AppShell />;
}
