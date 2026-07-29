import type { Edge } from '@xyflow/react';
import type { WorkflowNode } from '../store/useStore';
import type { LayerVisualisation } from '../types/visualisation';
import { spatialFunctions } from './spatialFunctions';
import {
  allocationErrors,
  buildAllocationSelects,
  buildMeasureSelect,
  buildTopNQualify,
  summaryMeasureErrors,
  type AllocationConfig,
  type SummaryMeasure,
} from './aggregationSql';
import { buildContributionSelects, buildScoreExpression, scoreModelErrors } from './scoreModel';
import {
  buildExclusionSelects,
  buildKeepExpression,
  filterPredicateErrors,
  type FilterOutcome,
  type FilterPredicate,
} from './filterPredicates';
import type { ScoreModelSpec } from '../types/visualAnalytics';

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
  /** The node whose output the final CTE holds, so callers can attribute the result back to the graph. */
  terminalNodeId: string;
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

export const JOIN_PREDICATES = new Set(['ST_Intersects', 'ST_Within', 'ST_Contains', 'ST_DWithin']);

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
function topoSort(nodes: WorkflowNode[], edges: Edge[]): WorkflowNode[] {
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

export function buildWorkflowSQL(nodes: WorkflowNode[], edges: Edge[], options?: { limit?: number }): WorkflowResult {
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
  const nodeIdByAlias = new Map<string, string>();

  for (const node of sorted) {
    const alias = cteAlias(node.id);
    nodeIdByAlias.set(alias, node.id);
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
          for (const [_key, v] of Object.entries(extraParams)) {
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
    } else if (type === 'join') {
      if (parentAliases.length < 2) {
        throw new Error(`Join node "${node.id}" requires 2 input connections (A = left, B = right).`);
      }
      const sourceA = parentAliases[0];
      const sourceB = parentAliases[1];
      const metaA = nodeMetadata.get(sourceA)!;
      const metaB = nodeMetadata.get(sourceB)!;
      const joinKeyword = config?.joinType === 'inner' ? 'JOIN' : 'LEFT JOIN';
      const mode = config?.mode || 'spatial';

      // Every right-side column gets an r_ prefix (DuckDB COLUMNS regex rename)
      // so B's attributes survive the join without colliding with A's.
      const renamedRight = `(SELECT COLUMNS('(.*)') AS 'r_\\1' FROM ${sourceB})`;
      const rightGeom = `r.${qi(`r_${metaB.geom}`)}`;

      let onClause = '';
      if (mode === 'attribute') {
        const leftKey = config?.leftKey;
        const rightKey = config?.rightKey;
        if (!leftKey || !rightKey) {
          throw new Error(`Join node "${node.id}" needs both key fields for an attribute join.`);
        }
        onClause = `a.${qi(leftKey)} = r.${qi(`r_${rightKey}`)}`;
      } else {
        const predicate = config?.predicate || 'ST_Intersects';
        if (!JOIN_PREDICATES.has(predicate)) {
          throw new Error(`Unsupported join predicate "${predicate}".`);
        }
        onClause = predicate === 'ST_DWithin'
          ? `ST_DWithin(a.${qi(metaA.geom)}, ${rightGeom}, ${Number(config?.distance) || 100})`
          : `${predicate}(a.${qi(metaA.geom)}, ${rightGeom})`;
      }

      // Keep A's geometry; drop B's renamed geometry from the projection.
      ctes.push(
        `${alias} AS (\n  SELECT a.*, r.* EXCLUDE (${qi(`r_${metaB.geom}`)})\n  FROM ${sourceA} a\n  ${joinKeyword} ${renamedRight} r\n    ON ${onClause}\n)`
      );
      nodeMetadata.set(alias, metaA);
      lastAlias = alias;
    } else if (type === 'aggregate') {
      const source = parentAliases[0] || lastAlias;
      if (!source) throw new Error(`Aggregate node "${node.id}" has no source.`);
      const meta = nodeMetadata.get(source)!;
      const mode = config?.mode === 'summary' ? 'summary' : 'spatial';

      if (mode === 'summary') {
        const groupFields: string[] = (Array.isArray(config?.groupBy) ? config.groupBy : [config?.groupBy])
          .filter((field: unknown): field is string => typeof field === 'string' && field.length > 0);
        const measures: SummaryMeasure[] = Array.isArray(config?.measures) ? config.measures : [];
        const errors = summaryMeasureErrors(measures);
        if (errors.length) throw new Error(`Aggregate node "${node.id}": ${errors[0]}`);

        const measureSelects = measures.map(buildMeasureSelect).filter((select): select is string => Boolean(select));
        // Unioning the group geometry keeps the summary mappable. Without it
        // the result is a plain table, which is a legitimate outcome — it just
        // cannot be drawn.
        const keepsGeometry = Boolean(config?.includeGeometry && meta.geom && groupFields.length);
        const selects = [
          ...groupFields.map((field) => qi(field)),
          ...measureSelects,
          ...(keepsGeometry ? [`ST_Union_Agg(${qi(meta.geom)}) AS geom_agg`] : []),
        ];
        const groupByClause = groupFields.length ? `\n  GROUP BY ${groupFields.map(qi).join(', ')}` : '';

        ctes.push(`${alias} AS (\n  SELECT ${selects.join(', ')}\n  FROM ${source}${groupByClause}\n)`);
        nodeMetadata.set(alias, { geom: keepsGeometry ? 'geom_agg' : '', crs: meta.crs });
        lastAlias = alias;
      } else {
        const operation = config?.operation || 'ST_Union_Agg';
        const groupBy = typeof config?.groupBy === 'string' ? config.groupBy : '';

        const selectClause = groupBy
          ? `${qi(groupBy)}, ${operation}(${qi(meta.geom)}) AS geom_agg`
          : `${operation}(${qi(meta.geom)}) AS geom_agg`;

        const groupByClause = groupBy ? ` GROUP BY ${qi(groupBy)}` : '';

        ctes.push(
          `${alias} AS (\n  SELECT ${selectClause}\n  FROM ${source}${groupByClause}\n)`
        );
        nodeMetadata.set(alias, { geom: 'geom_agg', crs: meta.crs });
        lastAlias = alias;
      }
    } else if (type === 'score') {
      const source = parentAliases[0] || lastAlias;
      if (!source) throw new Error(`Score node "${node.id}" has no source.`);
      const meta = nodeMetadata.get(source)!;
      const spec: ScoreModelSpec = config?.scoreModel || { criteria: [], missingValueTreatment: 'zero' };
      const errors = scoreModelErrors(spec);
      if (errors.length) throw new Error(`Score node "${node.id}": ${errors[0]}`);

      const resultField = config?.resultField || 'alur_score';
      const rankField = `${resultField}_rank`;
      // The mean-substitution policy averages over the upstream CTE, so the
      // compiler needs to know which alias that is.
      const scoreOptions = { relation: source };
      const contributions = config?.includeContributions === false ? [] : buildContributionSelects(spec, resultField, scoreOptions);
      const scored = [
        `${buildScoreExpression(spec, scoreOptions)} AS ${qi(resultField)}`,
        ...contributions.map((item) => `${item.expression} AS ${qi(item.alias)}`),
      ];

      // Ranking has to read the score, and a window function cannot reference
      // an alias defined in its own SELECT, so scoring and ranking are two
      // passes. Ties share a rank rather than being separated on row order.
      ctes.push(
        `${alias} AS (\n  SELECT *, RANK() OVER (ORDER BY ${qi(resultField)} DESC NULLS LAST) AS ${qi(rankField)}\n  FROM (\n    SELECT *, ${scored.join(', ')}\n    FROM ${source}\n  )\n)`
      );
      nodeMetadata.set(alias, meta);
      lastAlias = alias;
    } else if (type === 'allocate') {
      const source = parentAliases[0] || lastAlias;
      if (!source) throw new Error(`Allocation node "${node.id}" has no source.`);
      const meta = nodeMetadata.get(source)!;
      const errors = allocationErrors(config || {});
      if (errors.length) throw new Error(`Allocation node "${node.id}": ${errors[0]}`);

      const allocation = config as AllocationConfig;
      const { columns, selects } = buildAllocationSelects(allocation);
      const inner = `SELECT *, ${selects.join(', ')}\n    FROM ${source}`;

      // A cut-off has to filter on the window result, which cannot be
      // referenced from the same SELECT, so it wraps rather than qualifying.
      ctes.push(allocation.mode === 'cut'
        ? `${alias} AS (\n  SELECT *\n  FROM (\n    ${inner}\n  )\n  WHERE ${qi(columns.status)} = 'within'\n)`
        : `${alias} AS (\n  ${inner}\n)`);
      nodeMetadata.set(alias, meta);
      lastAlias = alias;
    } else if (type === 'filter') {
      const source = parentAliases[0] || lastAlias;
      if (!source) throw new Error(`Filter node "${node.id}" has no source.`);
      const meta = nodeMetadata.get(source)!;
      const condition = config?.condition || '1=1';
      const selectionIds = Array.isArray(config?.selectionIds)
        ? config.selectionIds.map(String).filter(Boolean)
        : [];
      if (config?.mode === 'top-n') {
        if (!config?.field) throw new Error(`Filter node "${node.id}" needs a column to rank by.`);
        const count = Number(config?.count);
        if (!Number.isFinite(count) || count < 1) throw new Error(`Filter node "${node.id}" needs how many rows to keep.`);
        ctes.push(
          `${alias} AS (\n  SELECT * FROM ${source}\n  QUALIFY ${buildTopNQualify(config.field, count, config?.direction === 'asc' ? 'asc' : 'desc')}\n)`
        );
      } else if (config?.mode === 'criteria') {
        const predicates: FilterPredicate[] = Array.isArray(config?.predicates) ? config.predicates : [];
        const errors = filterPredicateErrors(predicates);
        if (errors.length) throw new Error(`Filter node "${node.id}": ${errors[0]}`);

        const outcome: FilterOutcome = config?.outcome === 'tag' ? 'tag' : 'drop';
        const keep = buildKeepExpression(predicates);
        const exclusion = buildExclusionSelects(predicates, config?.exclusionField || undefined)!;
        // Dropping and recording are independent: a soft condition annotates a
        // row that survives, so the reason columns are written either way and
        // only the WHERE clause depends on the outcome.
        const where = outcome === 'drop' && keep ? `\n    WHERE ${keep}` : '';

        ctes.push(
          `${alias} AS (\n  SELECT * EXCLUDE (${qi(exclusion.intermediate)}), ${exclusion.outer.join(', ')}\n  FROM (\n    SELECT *, ${exclusion.inner.join(', ')}\n    FROM ${source}${where}\n  )\n)`
        );
      } else if (selectionIds.length) {
        const selectedValues = selectionIds.map((id: string) => `'${id.replace(/'/g, "''")}'`).join(', ');
        const geometryPredicate = meta.geom ? ` WHERE ${qi(meta.geom)} IS NOT NULL` : '';
        ctes.push(
          `${alias} AS (\n  SELECT * EXCLUDE (__alur_selection_row)\n  FROM (\n    SELECT *, ROW_NUMBER() OVER ()::BIGINT AS __alur_selection_row\n    FROM ${source}${geometryPredicate}\n  )\n  WHERE CAST(__alur_selection_row AS VARCHAR) IN (${selectedValues})\n)`
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
    terminalNodeId: nodeIdByAlias.get(lastAlias) || '',
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
export function buildUpToSQL(nodes: WorkflowNode[], edges: Edge[], targetNodeId: string, options?: { limit?: number }): WorkflowResult {
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
