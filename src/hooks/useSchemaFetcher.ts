import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { buildWorkflowSQL, cteAlias } from '../utils/workflowEngine';
import { duckdbService } from '../services/duckdb';

export function useSchemaFetcher() {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const duckdbReady = useStore((s) => s.duckdbReady);
  const setNodeSchema = useStore((s) => s.setNodeSchema);

  useEffect(() => {
    const fetchSchemas = async () => {
      if (!duckdbReady || nodes.length === 0) return;

      try {
        const { withClause } = buildWorkflowSQL(nodes, edges);

        for (const node of nodes) {
          try {
            const alias = cteAlias(node.id);
            const schemaSql = `${withClause} DESCRIBE ${alias};`;
            const result = await duckdbService.query(schemaSql);
            const schema = result.toArray().map((r: any) => {
              const raw = typeof r.toJSON === 'function' ? r.toJSON() : r;
              return {
                name: raw.column_name,
                type: raw.column_type
              };
            });
            setNodeSchema(node.id, schema);
          } catch (e) {
            // Node might not be ready or valid yet
          }
        }
      } catch (e) {
        // Workflow might not be ready
      }
    };

    fetchSchemas();
  }, [nodes, edges, duckdbReady, setNodeSchema]);
}
