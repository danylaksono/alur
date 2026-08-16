import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { buildWorkflowSQL, cteAlias } from '../utils/workflowEngine';
import { indicativeParameters } from '../utils/workflowParameters';
import { duckdbService } from '../services/duckdb';

export function useSchemaFetcher() {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const fragments = useStore((s) => s.fragments);
  const variants = useStore((s) => s.visualAnalytics.variants);
  const duckdbReady = useStore((s) => s.duckdbReady);
  const setNodeSchema = useStore((s) => s.setNodeSchema);

  useEffect(() => {
    const fetchSchemas = async () => {
      if (!duckdbReady || nodes.length === 0) return;

      try {
        const { withClause, needsH3 } = buildWorkflowSQL(nodes, edges, { fragments, parameters: indicativeParameters(variants) });
        // H3 nodes resolve through DuckDB's community h3 extension; make sure
        // it is loaded before any per-node schema query touches them.
        if (needsH3) await duckdbService.ensureH3();

        for (const node of nodes) {
          try {
            const alias = cteAlias(node.id);
            const schemaSql = `${withClause} SELECT * FROM ${alias} LIMIT 0;`;
            const result = await duckdbService.query(schemaSql);
            const arrowSchema = result.schema;
            const schema = arrowSchema.fields.map((field) => ({
              name: field.name,
              type: String(field.type),
            }));
            setNodeSchema(node.id, schema);
          } catch {
            // Node might not be ready or valid yet
          }
        }
      } catch {
        // Workflow might not be ready
      }
    };

    fetchSchemas();
  }, [nodes, edges, fragments, variants, duckdbReady, setNodeSchema]);
}
