import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { buildWorkflowSQL } from '../utils/workflowEngine';

export function useWorkflowSync() {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const fragments = useStore((s) => s.fragments);
  const isManualSQL = useStore((s) => s.isManualSQL);
  const setManualSQL = useStore((s) => s.setManualSQL);

  const buildSqlPreview = () => {
    if (!nodes || nodes.length === 0) {
      return '-- SQL preview will appear here once you add input and analysis nodes.';
    }
    try {
      const { sql } = buildWorkflowSQL(nodes, edges, { fragments });
      return sql;
    } catch (err: any) {
      return `-- Preview unavailable: ${err.message}`;
    }
  };

  const sqlPreview = buildSqlPreview();

  useEffect(() => {
    if (!isManualSQL) {
      setManualSQL(sqlPreview);
    }
  }, [sqlPreview, isManualSQL, setManualSQL]);

  return { sqlPreview };
}
