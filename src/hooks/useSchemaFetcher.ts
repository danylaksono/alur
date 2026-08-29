import { useEffect } from "react";
import { useStore } from "../store/useStore";
import { buildUpToSQL, buildWorkflowSQL, cteAlias } from "../utils/workflowEngine";
import { indicativeParameters } from "../utils/workflowParameters";
import { duckdbService } from "../services/duckdb";

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

      const parameters = indicativeParameters(variants);

      const readSchema = async (nodeId: string, withClause: string) => {
        const alias = cteAlias(nodeId);
        const result = await duckdbService.query(
          `${withClause} SELECT * FROM ${alias} LIMIT 0;`,
        );
        setNodeSchema(
          nodeId,
          result.schema.fields.map((field) => ({
            name: field.name,
            type: String(field.type),
          })),
        );
      };

      try {
        const { withClause, needsH3 } = buildWorkflowSQL(nodes, edges, {
          fragments,
          parameters,
        });
        // H3 nodes resolve through DuckDB's community h3 extension; make sure
        // it is loaded before any per-node schema query touches them.
        if (needsH3) await duckdbService.ensureH3();

        for (const node of nodes) {
          try {
            await readSchema(node.id, withClause);
          } catch {
            // Node might not be ready or valid yet
          }
        }
      } catch {
        // One node that will not compile used to cost every node its columns,
        // because the whole graph is built in a single pass. That is fatal for a
        // calculation node in particular: it cannot compile until it has been
        // run, and it cannot be configured until the columns above it are known,
        // so the node could never be set up at all. Falling back to a build per
        // node costs more only in the case that was previously a dead end.
        for (const node of nodes) {
          try {
            const branch = buildUpToSQL(nodes, edges, node.id, { fragments, parameters });
            if (branch.needsH3) await duckdbService.ensureH3();
            await readSchema(node.id, branch.withClause);
          } catch {
            // This node genuinely is not ready; its neighbours still are.
          }
        }
      }
    };

    fetchSchemas();
  }, [nodes, edges, fragments, variants, duckdbReady, setNodeSchema]);
}
