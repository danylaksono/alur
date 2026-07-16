import { useEffect } from 'react';
import { useStore } from './store/useStore';
import { duckdbService } from './services/duckdb';
import { AppShell } from './components/shell/AppShell';

export default function App() {
  const setDuckDBReady = useStore((s) => s.setDuckDBReady);

  useEffect(() => {
    const init = async () => {
      try {
        await duckdbService.init();
        setDuckDBReady(true);
      } catch (e) {
        console.error('DuckDB Init failed', e);
      }
    };
    init();
  }, [setDuckDBReady]);

  return <AppShell />;
}
