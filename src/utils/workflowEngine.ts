import type { Edge } from '@xyflow/react';
import type { GISNode } from '../store/useStore';
import type { LayerVisualisation } from '../types/visualisation';
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
 * The final CTE exposes a table-shaped result. Rendering/export callers decide
 * whether to materialize it as a DuckDB-backed layer or serialize it.
 */

export interface WorkflowResult {
  sql: string;
  resultSql: string;
  withClause: string;
  lastAlias: string;
  geomColumn: string;
  geomCrs: string;
  outputLayerName: string;
  visualisationConfig?: WorkflowVisualisationConfig;
}

export type WorkflowVisualisationConfig = Partial<LayerVisualisation> & {
  kind?: LayerVisualisation['kind'];
  field?: string;
  paletteId?: string;
};

const GEOMETRY_RETURNING_FUNCTIONS = new Set([
  'ST_Affine',
  'ST_Boundary',
  'ST_Buffer',
  'ST_BuildArea',
  'ST_Centroid',
  'ST_Collect',
  'ST_CollectionExtract',
  'ST_ConcaveHull',
  'ST_ConvexHull',
  'ST_Difference',
  'ST_EndPoint',
  'ST_Envelope',
  'ST_Force2D',
  'ST_Force3D',
  'ST_GeomFromGeoJSON',
  'ST_GeomFromText',
  'ST_GeomFromWKB',
  'ST_Intersection',
  'ST_LineMerge',
  'ST_MakeEnvelope',
  'ST_MakeLine',
  'ST_MakePolygon',
  'ST_Multi',
  'ST_Normalize',
  'ST_PointN',
  'ST_ReducePrecision',
  'ST_RemoveRepeatedPoints',
  'ST_Reverse',
  'ST_Simplify',
  'ST_SimplifyPreserveTopology',
  'ST_StartPoint',
  'ST_Transform',
  'ST_Union',
]);

const BOOLEAN_SPATIAL_PREDICATES = new Set([
  'ST_Contains',
  'ST_ContainsProperly',
  'ST_CoveredBy',
  'ST_Covers',
  'ST_Crosses',
  'ST_Disjoint',
  'ST_DWithin',
  'ST_Equals',
  'ST_Intersects',
  'ST_Overlaps',
  'ST_Touches',
  'ST_Within',
]);

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

function resultFieldName(operation: string): string {
  return `${operation.replace(/^ST_/, '').toLowerCase()}_result`;
}

function isGeometryReturning(operation: string): boolean {
  return GEOMETRY_RETURNING_FUNCTIONS.has(operation);
}

function isBooleanPredicate(operation: string): boolean {
  return BOOLEAN_SPATIAL_PREDICATES.has(operation);
}

// ─── main builder ─────────────────────────────────────────────────────

export function buildWorkflowSQL(nodes: GISNode[], edges: Edge[], options?: { limit?: number }): WorkflowResult {
  if (!nodes.length) {
    throw new Error('No nodes in the workflow.');
  }

  const resultLimit = options?.limit ?? 5000;

  const sorted = topoSort(nodes, edges);

  // Map each node to its parent edges. Handles keep two-input spatial ops deterministic.
  const parentsMap = new Map<string, Edge[]>();
  edges.forEach((e) => {
    const existing = parentsMap.get(e.target) || [];
    parentsMap.set(e.target, [...existing, e]);
  });

  const ctes: string[] = [];
  let lastAlias = '';
  // Track geometry column and CRS per CTE
  const nodeMetadata = new Map<string, { geom: string; crs: string }>();
  const visualisationMetadata = new Map<string, WorkflowVisualisationConfig>();

  for (const node of sorted) {
    const alias = cteAlias(node.id);
    const { type, config } = node.data;
    const parentEdges = [...(parentsMap.get(node.id) || [])].sort((a, b) =>
      String(a.targetHandle || '').localeCompare(String(b.targetHandle || ''))
    );
    const parentAliases = parentEdges.map(edge => cteAlias(edge.source));

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
      if (!fn) {
        throw new Error(`Unsupported spatial operation "${operation}".`);
      }
      if (fn.category === 'Table' || fn.category === 'Macro') {
        throw new Error(`Operation "${operation}" is a ${fn.category.toLowerCase()} function and cannot be used as a row-by-row analysis node.`);
      }
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
          if (isGeometryReturning(operation)) {
            sql = `SELECT *, ${operation}(${funcArgs}) AS geom_result FROM ${source}`;
            newGeom = 'geom_result';
          } else {
            const fieldName = config?.resultField || resultFieldName(operation);
            sql = `SELECT *, ${operation}(${funcArgs}) AS ${qi(fieldName)} FROM ${source}`;
            newGeom = meta.geom;
          }
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

        const leftGeom = `a.${qi(metaA.geom)}`;
        const rightGeom = `b.${qi(metaB.geom)}`;
        if (isGeometryReturning(operation)) {
          ctes.push(
            `${alias} AS (\n  SELECT a.*, ${operation}(${leftGeom}, ${rightGeom}) AS geom_multi_result\n  FROM ${sourceA} a, ${sourceB} b\n  WHERE ST_Intersects(${leftGeom}, ${rightGeom})\n)`
          );
          nodeMetadata.set(alias, { geom: 'geom_multi_result', crs: metaA.crs });
        } else {
          const fieldName = config?.resultField || resultFieldName(operation);
          const predicate = `${operation}(${leftGeom}, ${rightGeom})`;
          const whereClause = isBooleanPredicate(operation)
            ? `\n  WHERE ${predicate}`
            : `\n  WHERE ST_Intersects(${leftGeom}, ${rightGeom})`;
          ctes.push(
            `${alias} AS (\n  SELECT a.*, ${predicate} AS ${qi(fieldName)}\n  FROM ${sourceA} a, ${sourceB} b${whereClause}\n)`
          );
          nodeMetadata.set(alias, { geom: metaA.geom, crs: metaA.crs });
        }
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
      const selectionIds = Array.isArray(config?.selectionIds)
        ? config.selectionIds.map(String).filter(Boolean)
        : [];
      if (selectionIds.length) {
        const selectedValues = selectionIds.map((id: string) => `'${id.replace(/'/g, "''")}'`).join(', ');
        const geometryPredicate = meta.geom ? ` WHERE ${qi(meta.geom)} IS NOT NULL` : '';
        ctes.push(
          `${alias} AS (\n  SELECT * EXCLUDE (__ymn_selection_row)\n  FROM (\n    SELECT *, ROW_NUMBER() OVER ()::BIGINT AS __ymn_selection_row\n    FROM ${source}${geometryPredicate}\n  )\n  WHERE CAST(__ymn_selection_row AS VARCHAR) IN (${selectedValues})\n)`
        );
      } else {
        ctes.push(
          `${alias} AS (\n  SELECT * FROM ${source} WHERE ${condition}\n)`
        );
      }
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
    } else if (type === 'visualisation') {
      const source = parentAliases[0] || lastAlias;
      if (!source) throw new Error(`Visualisation node "${node.id}" has no source.`);
      const meta = nodeMetadata.get(source)!;
      ctes.push(`${alias} AS (\n  SELECT * FROM ${source}\n)`);
      nodeMetadata.set(alias, meta);
      visualisationMetadata.set(alias, config || {});
      lastAlias = alias;
    } else if (type === 'output') {
      if (parentAliases.length > 0) {
        const source = parentAliases[0];
        ctes.push(`${alias} AS (\n  SELECT * FROM ${source}\n)`);
        lastAlias = alias;
        nodeMetadata.set(alias, nodeMetadata.get(source)!);
        const sourceVisualisation = visualisationMetadata.get(source);
        if (sourceVisualisation) visualisationMetadata.set(alias, sourceVisualisation);
      }
    }
  }

  if (!lastAlias) {
    throw new Error('Could not determine the final step in the workflow.');
  }

  const finalMeta = nodeMetadata.get(lastAlias)!;
  const withClause = `WITH ${ctes.join(',\n')}`;
  const resultSql = `${withClause}\nSELECT *\nFROM ${lastAlias}`;
  const sql = `${resultSql}\nLIMIT ${resultLimit};`;

  return {
    sql,
    resultSql,
    withClause,
    lastAlias,
    geomColumn: finalMeta.geom,
    geomCrs: finalMeta.crs,
    outputLayerName: `workflow_${lastAlias}`,
    visualisationConfig: visualisationMetadata.get(lastAlias),
  };
}

/**
 * Build SQL that executes the workflow up to (and including) a specific target node.
 * Useful for step-through / per-node execution.
 */
export function buildUpToSQL(nodes: GISNode[], edges: Edge[], targetNodeId: string, options?: { limit?: number }): WorkflowResult {
  if (!nodes.length) throw new Error('No nodes in the workflow.');
  if (!nodes.some((node) => node.id === targetNodeId)) {
    throw new Error(`Target node "${targetNodeId}" does not exist.`);
  }

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
