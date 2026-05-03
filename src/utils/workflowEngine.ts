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
  withClause: string;
  lastAlias: string;
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
export function cteAlias(nodeId: string): string {
  return nodeId.replace(/[^a-zA-Z0-9_]/g, '_');
}

// ─── main builder ─────────────────────────────────────────────────────

export function buildWorkflowSQL(nodes: GISNode[], edges: Edge[], options?: { limit?: number }): WorkflowResult {
  if (!nodes.length) {
    throw new Error('No nodes in the workflow.');
  }

  const resultLimit = options?.limit ?? 5000;

  const sorted = topoSort(nodes, edges);

  // Map each node to its parent(s) CTE aliases
  const parentsMap = new Map<string, string[]>();
  edges.forEach((e) => {
    const existing = parentsMap.get(e.target) || [];
    parentsMap.set(e.target, [...existing, e.source]);
  });

  const ctes: string[] = [];
  let lastAlias = '';
  // Track geometry column and CRS per CTE
  const nodeMetadata = new Map<string, { geom: string; crs: string }>();

  for (const node of sorted) {
    const alias = cteAlias(node.id);
    const { type, config } = node.data;
    const parentIds = parentsMap.get(node.id) || [];
    const parentAliases = parentIds.map(id => cteAlias(id));

    if (type === 'input') {
      const tableName = config?.tableName;
      if (!tableName) {
        throw new Error(`Input node "${node.id}" has no table loaded.`);
      }
      ctes.push(`${alias} AS (\n  SELECT * FROM ${qi(tableName)}\n)`);
      lastAlias = alias;
      nodeMetadata.set(alias, { geom: 'geometry', crs: 'EPSG:4326' });
    } else if (type === 'analysis') {
      const operation = config?.operation || 'ST_Buffer';
      const fn = spatialFunctions.find((f) => f.name === operation);
      const inputCount = fn?.requiredInputCount ?? 1;

      const buildExtraArgs = (): string => {
        const args: string[] = [];

        // Named parameters from node config (generic system)
        const extraParams = config?.params as Record<string, unknown> | undefined;
        if (extraParams) {
          for (const [k, v] of Object.entries(extraParams)) {
            if (v === undefined || v === null || v === '') continue;
            if (typeof v === 'number' || typeof v === 'boolean') {
              args.push(String(v));
            } else if (typeof v === 'string') {
              // Check if it's a numeric string
              const num = Number(v);
              if (!Number.isNaN(num)) {
                args.push(v);
              } else {
                args.push(`'${v.replace(/'/g, "''")}'`);
              }
            }
          }
        }

        return args.length > 0 ? `, ${args.join(', ')}` : '';
      };

      if (inputCount === 1) {
        const source = parentAliases[0] || lastAlias;
        if (!source) throw new Error(`Analysis node "${node.id}" has no source.`);
        const meta = nodeMetadata.get(source) || { geom: 'geometry', crs: 'EPSG:4326' };
        
        let sql = '';
        let newGeom = 'geom_result';
        let newCrs = meta.crs;

        if (operation === 'ST_Transform') {
          const srcCrs = config?.sourceCrs || meta.crs;
          const tgtCrs = config?.targetCrs || 'EPSG:3857';
          sql = `SELECT *, ST_Transform(${qi(meta.geom)}, '${srcCrs}', '${tgtCrs}') AS geom_transformed FROM ${source}`;
          newGeom = 'geom_transformed';
          newCrs = tgtCrs;
        } else if (operation === 'ST_Buffer') {
          const distance = config?.distance ?? config?.params?.distance ?? 100;
          sql = `SELECT *, ST_Buffer(${qi(meta.geom)}, ${distance}) AS geom_buffered FROM ${source}`;
          newGeom = 'geom_buffered';
        } else {
          const funcArgs = `${qi(meta.geom)}${buildExtraArgs()}`;
          sql = `SELECT *, ${operation}(${funcArgs}) AS geom_result FROM ${source}`;
        }

        ctes.push(`${alias} AS (\n  ${sql}\n)`);
        nodeMetadata.set(alias, { geom: newGeom, crs: newCrs });
        lastAlias = alias;
      } else {
        // Multi-input functions (e.g., ST_Intersection, ST_Difference)
        if (parentAliases.length < 2) {
          throw new Error(`Operation "${operation}" requires 2 input connections.`);
        }
        const sourceA = parentAliases[0];
        const sourceB = parentAliases[1];
        const metaA = nodeMetadata.get(sourceA)!;
        const metaB = nodeMetadata.get(sourceB)!;

        // Optimization: Use a spatial join (filtered cross join) for 2-input operations
        // This avoids N*M complexity by only calculating results for intersecting geometries
        ctes.push(
          `${alias} AS (\n  SELECT a.*, ${operation}(a.${qi(metaA.geom)}, b.${qi(metaB.geom)}) AS geom_multi_result\n  FROM ${sourceA} a, ${sourceB} b\n  WHERE ST_Intersects(a.${qi(metaA.geom)}, b.${qi(metaB.geom)})\n)`
        );
        nodeMetadata.set(alias, { geom: 'geom_multi_result', crs: metaA.crs });
        lastAlias = alias;
      }
    } else if (type === 'aggregate') {
      const source = parentAliases[0] || lastAlias;
      if (!source) throw new Error(`Aggregate node "${node.id}" has no source.`);
      const meta = nodeMetadata.get(source)!;
      const operation = config?.operation || 'ST_Union_Agg';
      const groupBy = config?.groupBy || '';
      
      const selectClause = groupBy 
        ? `${qi(groupBy)}, ${operation}(${qi(meta.geom)}) AS geom_agg`
        : `${operation}(${qi(meta.geom)}) AS geom_agg`;
      
      const groupByClause = groupBy ? ` GROUP BY ${qi(groupBy)}` : '';
      
      ctes.push(
        `${alias} AS (\n  SELECT ${selectClause}\n  FROM ${source}${groupByClause}\n)`
      );
      nodeMetadata.set(alias, { geom: 'geom_agg', crs: meta.crs });
      lastAlias = alias;
    } else if (type === 'filter') {
      const source = parentAliases[0] || lastAlias;
      if (!source) throw new Error(`Filter node "${node.id}" has no source.`);
      const meta = nodeMetadata.get(source)!;
      const condition = config?.condition || '1=1';
      ctes.push(
        `${alias} AS (\n  SELECT * FROM ${source} WHERE ${condition}\n)`
      );
      nodeMetadata.set(alias, meta);
      lastAlias = alias;
    } else if (type === 'attribute') {
      const source = parentAliases[0] || lastAlias;
      if (!source) throw new Error(`Attribute node "${node.id}" has no source.`);
      const meta = nodeMetadata.get(source)!;
      const expression = config?.expression || '1';
      const resultField = config?.resultField || 'new_value';
      ctes.push(
        `${alias} AS (\n  SELECT *, ${expression} AS ${qi(resultField)}\n  FROM ${source}\n)`
      );
      nodeMetadata.set(alias, meta);
      lastAlias = alias;
    } else if (type === 'output') {
      if (parentAliases.length > 0) {
        const source = parentAliases[0];
        lastAlias = source;
        nodeMetadata.set(alias, nodeMetadata.get(source)!);
      }
    }
  }

  if (!lastAlias) {
    throw new Error('Could not determine the final step in the workflow.');
  }

  const finalMeta = nodeMetadata.get(lastAlias)!;
  let finalGeomExpr: string;
  if (finalMeta.crs !== 'EPSG:4326') {
    finalGeomExpr = `ST_AsGeoJSON(ST_Transform(${qi(finalMeta.geom)}, '${finalMeta.crs}', 'EPSG:4326'))`;
  } else {
    finalGeomExpr = `ST_AsGeoJSON(${qi(finalMeta.geom)})`;
  }

  const withClause = `WITH ${ctes.join(',\n')}`;
  const sql = `${withClause}\nSELECT *, ${finalGeomExpr} AS geojson\nFROM ${lastAlias}\nLIMIT ${resultLimit};`;

  return {
    sql,
    withClause,
    lastAlias,
    outputLayerName: 'workflow_result',
  };
}

/**
 * Build SQL that executes the workflow up to (and including) a specific target node.
 * Useful for step-through / per-node execution.
 */
export function buildUpToSQL(nodes: GISNode[], edges: Edge[], targetNodeId: string, options?: { limit?: number }): WorkflowResult {
  if (!nodes.length) throw new Error('No nodes in the workflow.');

  // Find all nodes that are ancestors of the target (including the target itself)
  const parentMap = new Map<string, string[]>();
  edges.forEach((e) => {
    const existing = parentMap.get(e.target) || [];
    parentMap.set(e.target, [...existing, e.source]);
  });

  const ancestors = new Set<string>();
  const walk = (id: string) => {
    if (ancestors.has(id)) return;
    ancestors.add(id);
    (parentMap.get(id) || []).forEach(walk);
  };
  walk(targetNodeId);

  const relevantNodes = nodes.filter((n) => ancestors.has(n.id));
  const relevantEdgeIds = new Set(edges.filter((e) => relevantNodes.some((n) => n.id === e.source) && relevantNodes.some((n) => n.id === e.target)).map((e) => e.id));
  const relevantEdges = edges.filter((e) => relevantEdgeIds.has(e.id));

  return buildWorkflowSQL(relevantNodes, relevantEdges, options);
}
