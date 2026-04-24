import type { Edge } from '@xyflow/react';
import type { GISNode } from '../store/useStore';
import { spatialFunctions } from './spatialFunctions';

/**
 * Workflow Engine
 * ---------------
 * Traverses the node graph (respecting edge connections) and builds a
 * chained CTE SQL pipeline that DuckDB can execute in one shot.
 *
 * Execution flow:
 *   Input node  → zero or more Analysis/Attribute nodes → Output node
 *
 * The final CTE always transforms geometry back to EPSG:4326 and emits
 * ST_AsGeoJSON so the result can be rendered on the map.
 */

export interface WorkflowResult {
  sql: string;
  outputLayerName: string;
}

// ─── helpers ──────────────────────────────────────────────────────────

/** Topologically sort nodes from sources (no incoming edges) to sinks. */
function topoSort(nodes: GISNode[], edges: Edge[]): GISNode[] {
  const adj = new Map<string, string[]>();
  const inDeg = new Map<string, number>();

  nodes.forEach((n) => {
    adj.set(n.id, []);
    inDeg.set(n.id, 0);
  });

  edges.forEach((e) => {
    adj.get(e.source)?.push(e.target);
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
  });

  const queue = nodes.filter((n) => (inDeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const sorted: string[] = [];

  while (queue.length) {
    const id = queue.shift()!;
    sorted.push(id);
    for (const neighbour of adj.get(id) ?? []) {
      const newDeg = (inDeg.get(neighbour) ?? 1) - 1;
      inDeg.set(neighbour, newDeg);
      if (newDeg === 0) queue.push(neighbour);
    }
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  return sorted.map((id) => nodeMap.get(id)!).filter(Boolean);
}

/** Escape an identifier for DuckDB (double-quote). */
function qi(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Create a safe CTE alias from a node id. */
function cteAlias(nodeId: string): string {
  return nodeId.replace(/[^a-zA-Z0-9_]/g, '_');
}

// ─── main builder ─────────────────────────────────────────────────────

export function buildWorkflowSQL(nodes: GISNode[], edges: Edge[]): WorkflowResult {
  if (!nodes.length) {
    throw new Error('No nodes in the workflow.');
  }

  const sorted = topoSort(nodes, edges);

  // Map each node to its parent CTE alias (the node that feeds into it)
  const parentOf = new Map<string, string>();
  edges.forEach((e) => {
    parentOf.set(e.target, e.source);
  });

  const ctes: string[] = [];
  let lastAlias = '';
  let geomColumn = 'geometry'; // track which column holds the geometry
  // Track the current CRS so we know when we need to transform back
  let currentCrs = 'EPSG:4326';

  for (const node of sorted) {
    const alias = cteAlias(node.id);
    const { type, config } = node.data;
    const parentAlias = parentOf.has(node.id)
      ? cteAlias(parentOf.get(node.id)!)
      : null;

    if (type === 'input') {
      const tableName = config?.tableName;
      if (!tableName) {
        throw new Error(`Input node "${node.id}" has no table loaded.`);
      }
      ctes.push(`${alias} AS (\n  SELECT * FROM ${qi(tableName)}\n)`);
      lastAlias = alias;
      geomColumn = 'geometry';
      currentCrs = 'EPSG:4326';
    } else if (type === 'analysis') {
      const source = parentAlias ?? lastAlias;
      if (!source) throw new Error(`Analysis node "${node.id}" has no source.`);

      const operation = config?.operation || 'ST_Buffer';

      if (operation === 'ST_Transform') {
        const srcCrs = config?.sourceCrs || 'EPSG:4326';
        const tgtCrs = config?.targetCrs || 'EPSG:3857';
        ctes.push(
          `${alias} AS (\n  SELECT *, ST_Transform(${qi(geomColumn)}, '${srcCrs}', '${tgtCrs}') AS geom_transformed\n  FROM ${source}\n)`
        );
        geomColumn = 'geom_transformed';
        currentCrs = tgtCrs;
        lastAlias = alias;
      } else if (operation === 'ST_Buffer') {
        const distance = config?.distance ?? 100;
        ctes.push(
          `${alias} AS (\n  SELECT *, ST_Buffer(${qi(geomColumn)}, ${distance}) AS geom_buffered\n  FROM ${source}\n)`
        );
        geomColumn = 'geom_buffered';
        lastAlias = alias;
      } else {
        // Generic single-geometry function
        const fn = spatialFunctions.find((f) => f.name === operation);
        const inputCount = fn?.requiredInputCount ?? 1;
        if (inputCount === 1) {
          ctes.push(
            `${alias} AS (\n  SELECT *, ${operation}(${qi(geomColumn)}) AS geom_result\n  FROM ${source}\n)`
          );
          geomColumn = 'geom_result';
        } else {
          // For 2-input functions we'd need a second source via a JOIN.
          // For now, just apply with the same geom to avoid errors.
          ctes.push(
            `${alias} AS (\n  SELECT *, ${operation}(${qi(geomColumn)}, ${qi(geomColumn)}) AS geom_result\n  FROM ${source}\n)`
          );
          geomColumn = 'geom_result';
        }
        lastAlias = alias;
      }
    } else if (type === 'attribute') {
      const source = parentAlias ?? lastAlias;
      if (!source) throw new Error(`Attribute node "${node.id}" has no source.`);
      const expression = config?.expression || '1';
      const resultField = config?.resultField || 'new_value';
      ctes.push(
        `${alias} AS (\n  SELECT *, ${expression} AS ${qi(resultField)}\n  FROM ${source}\n)`
      );
      lastAlias = alias;
    } else if (type === 'output') {
      // Output nodes don't change data; they just mark the end
      if (parentAlias) lastAlias = parentAlias;
    }
  }

  if (!lastAlias) {
    throw new Error('Could not determine the final step in the workflow.');
  }

  // If current CRS is not 4326, we need to transform back for map display
  let finalGeomExpr: string;
  if (currentCrs !== 'EPSG:4326') {
    finalGeomExpr = `ST_AsGeoJSON(ST_Transform(${qi(geomColumn)}, '${currentCrs}', 'EPSG:4326'))`;
  } else {
    finalGeomExpr = `ST_AsGeoJSON(${qi(geomColumn)})`;
  }

  const sql = `WITH ${ctes.join(',\n')}\nSELECT *, ${finalGeomExpr} AS geojson\nFROM ${lastAlias}\nLIMIT 5000;`;

  return {
    sql,
    outputLayerName: 'workflow_result',
  };
}
