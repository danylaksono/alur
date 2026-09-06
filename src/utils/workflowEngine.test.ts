import { describe, it, expect } from "vitest";
import {
  buildWorkflowSQL,
  buildUpToSQL,
  cteAlias,
  unloadedSourceNodes,
} from "./workflowEngine";
import type { WorkflowNode } from "../store/useStore";
import type { Edge } from "@xyflow/react";

function makeNode(overrides: Partial<WorkflowNode>): WorkflowNode {
  return {
    id: "node-1",
    type: "input",
    position: { x: 0, y: 0 },
    data: {
      label: "Test",
      type: "input",
      config: {},
    },
    ...overrides,
  } as WorkflowNode;
}

describe("cteAlias", () => {
  it("replaces special characters with underscores", () => {
    expect(cteAlias("node-123")).toBe("node_123");
  });

  it("preserves alphanumeric and underscore", () => {
    expect(cteAlias("my_node_1")).toBe("my_node_1");
  });
});

describe("buildWorkflowSQL", () => {
  it("throws when no nodes are provided", () => {
    expect(() => buildWorkflowSQL([], [])).toThrow("No nodes in the workflow.");
  });

  it("throws when input node has no tableName", () => {
    const nodes = [
      makeNode({ id: "n1", data: { label: "Src", type: "input", config: {} } }),
    ];
    expect(() => buildWorkflowSQL(nodes, [])).toThrow("has no table");
  });

  it("generates a simple input-only workflow", () => {
    const nodes = [
      makeNode({
        id: "n1",
        data: {
          label: "Src",
          type: "input",
          config: { tableName: "my_table" },
        },
      }),
    ];
    const result = buildWorkflowSQL(nodes, []);
    expect(result.sql).toContain("WITH n1 AS");
    expect(result.sql).toContain('SELECT * FROM "my_table"');
    expect(result.sql).toContain("LIMIT 5000");
    expect(result.sql).not.toContain("ST_AsGeoJSON");
    expect(result.resultSql).toContain("FROM n1");
    expect(result.geomColumn).toBe("geometry");
  });

  it("generates a buffer analysis workflow", () => {
    const nodes: WorkflowNode[] = [
      makeNode({
        id: "src",
        data: { label: "Src", type: "input", config: { tableName: "london" } },
      }),
      makeNode({
        id: "buf",
        position: { x: 200, y: 0 },
        data: {
          label: "Buffer",
          type: "analysis",
          config: { operation: "ST_Buffer", distance: 500 },
        },
      }),
    ];
    const edges: Edge[] = [
      { id: "e1", source: "src", target: "buf", type: "smoothstep" },
    ];
    const result = buildWorkflowSQL(nodes, edges);
    expect(result.sql).toContain("ST_Buffer");
    expect(result.sql).toContain("500");
    expect(result.sql).toContain("geom_buffered");
  });

  it("generates a filter workflow", () => {
    const nodes: WorkflowNode[] = [
      makeNode({
        id: "src",
        data: { label: "Src", type: "input", config: { tableName: "data" } },
      }),
      makeNode({
        id: "flt",
        position: { x: 200, y: 0 },
        data: {
          label: "Filter",
          type: "filter",
          config: { condition: "population > 1000" },
        },
      }),
    ];
    const edges: Edge[] = [
      { id: "e1", source: "src", target: "flt", type: "smoothstep" },
    ];
    const result = buildWorkflowSQL(nodes, edges);
    expect(result.sql).toContain("WHERE population > 1000");
  });

  it("records why each row was excluded and still removes the failures", () => {
    const nodes: WorkflowNode[] = [
      makeNode({
        id: "src",
        data: { label: "Src", type: "input", config: { tableName: "data" } },
      }),
      makeNode({
        id: "flt",
        position: { x: 200, y: 0 },
        data: {
          label: "Eligibility",
          type: "filter",
          config: {
            mode: "criteria",
            predicates: [
              {
                id: "a",
                label: "Large enough",
                expression: "area > 500",
                severity: "hard",
              },
              {
                id: "b",
                label: "Near a stop",
                expression: "stop_m < 400",
                severity: "soft",
              },
            ],
          },
        },
      }),
    ];
    const edges: Edge[] = [
      { id: "e1", source: "src", target: "flt", type: "smoothstep" },
    ];
    const result = buildWorkflowSQL(nodes, edges);

    expect(result.sql).toContain("WHERE COALESCE((area > 500), FALSE)");
    expect(result.sql).toContain("THEN 'Large enough'");
    expect(result.sql).toContain('AS "alur_excluded_by"');
    expect(result.sql).toContain('AS "alur_excluded_count"');
    // The intermediate list is consumed by the outer projection and dropped,
    // so downstream nodes never see it.
    expect(result.sql).toContain('EXCLUDE ("__alur_exclusion_reasons")');
  });

  it("keeps every row when the filter only tags", () => {
    const nodes: WorkflowNode[] = [
      makeNode({
        id: "src",
        data: { label: "Src", type: "input", config: { tableName: "data" } },
      }),
      makeNode({
        id: "flt",
        position: { x: 200, y: 0 },
        data: {
          label: "Eligibility",
          type: "filter",
          config: {
            mode: "criteria",
            outcome: "tag",
            predicates: [
              {
                id: "a",
                label: "Large enough",
                expression: "area > 500",
                severity: "hard",
              },
            ],
          },
        },
      }),
    ];
    const edges: Edge[] = [
      { id: "e1", source: "src", target: "flt", type: "smoothstep" },
    ];
    const result = buildWorkflowSQL(nodes, edges);

    expect(result.sql).toContain('AS "alur_excluded"');
    // Tagging must not filter: the exclusion is recorded, not enacted.
    expect(result.sql).not.toContain("WHERE COALESCE");
  });

  it("rejects a criteria filter with no conditions", () => {
    const nodes: WorkflowNode[] = [
      makeNode({
        id: "src",
        data: { label: "Src", type: "input", config: { tableName: "data" } },
      }),
      makeNode({
        id: "flt",
        position: { x: 200, y: 0 },
        data: {
          label: "Filter",
          type: "filter",
          config: { mode: "criteria", predicates: [] },
        },
      }),
    ];
    const edges: Edge[] = [
      { id: "e1", source: "src", target: "flt", type: "smoothstep" },
    ];
    expect(() => buildWorkflowSQL(nodes, edges)).toThrow(
      /at least one condition/i,
    );
  });

  it("generates a reproducible row-selection filter workflow", () => {
    const nodes: WorkflowNode[] = [
      makeNode({
        id: "src",
        data: { label: "Src", type: "input", config: { tableName: "data" } },
      }),
      makeNode({
        id: "flt",
        position: { x: 200, y: 0 },
        data: {
          label: "Selected rows",
          type: "filter",
          config: { condition: "Selection", selectionIds: ["2", "5"] },
        },
      }),
    ];
    const edges: Edge[] = [
      { id: "e1", source: "src", target: "flt", type: "smoothstep" },
    ];
    const result = buildWorkflowSQL(nodes, edges);
    expect(result.sql).toContain(
      "ROW_NUMBER() OVER ()::BIGINT AS __alur_selection_row",
    );
    expect(result.sql).toContain("IN ('2', '5')");
    expect(result.sql).toContain("EXCLUDE (__alur_selection_row)");
  });

  it("generates an aggregate workflow", () => {
    const nodes: WorkflowNode[] = [
      makeNode({
        id: "src",
        data: { label: "Src", type: "input", config: { tableName: "zones" } },
      }),
      makeNode({
        id: "agg",
        position: { x: 200, y: 0 },
        data: {
          label: "Agg",
          type: "aggregate",
          config: { operation: "ST_Union_Agg", groupBy: "city" },
        },
      }),
    ];
    const edges: Edge[] = [
      { id: "e1", source: "src", target: "agg", type: "smoothstep" },
    ];
    const result = buildWorkflowSQL(nodes, edges);
    expect(result.sql).toContain("ST_Union_Agg");
    expect(result.sql).toContain("GROUP BY");
    expect(result.sql).toContain('"city"');
  });

  it("generates an attribute computation workflow", () => {
    const nodes: WorkflowNode[] = [
      makeNode({
        id: "src",
        data: { label: "Src", type: "input", config: { tableName: "data" } },
      }),
      makeNode({
        id: "attr",
        position: { x: 200, y: 0 },
        data: {
          label: "Attr",
          type: "attribute",
          config: { expression: "pop / area", resultField: "density" },
        },
      }),
    ];
    const edges: Edge[] = [
      { id: "e1", source: "src", target: "attr", type: "smoothstep" },
    ];
    const result = buildWorkflowSQL(nodes, edges);
    expect(result.sql).toContain("pop / area");
    expect(result.sql).toContain('"density"');
  });

  it("generates a multi-input spatial join workflow", () => {
    const nodes: WorkflowNode[] = [
      makeNode({
        id: "a",
        data: { label: "A", type: "input", config: { tableName: "polygons" } },
      }),
      makeNode({
        id: "b",
        data: { label: "B", type: "input", config: { tableName: "lines" } },
      }),
      makeNode({
        id: "inter",
        position: { x: 200, y: 0 },
        data: {
          label: "Intersect",
          type: "analysis",
          config: { operation: "ST_Intersection" },
        },
      }),
    ];
    const edges: Edge[] = [
      { id: "e1", source: "a", target: "inter", type: "smoothstep" },
      { id: "e2", source: "b", target: "inter", type: "smoothstep" },
    ];
    const result = buildWorkflowSQL(nodes, edges);
    expect(result.sql).toContain("ST_Intersection");
    expect(result.sql).toContain("ST_Intersects");
    expect(result.sql).toContain("geom_multi_result");
  });

  it("respects target handles for two-input operations", () => {
    const nodes: WorkflowNode[] = [
      makeNode({
        id: "a",
        data: { label: "A", type: "input", config: { tableName: "polygons" } },
      }),
      makeNode({
        id: "b",
        data: { label: "B", type: "input", config: { tableName: "lines" } },
      }),
      makeNode({
        id: "diff",
        position: { x: 200, y: 0 },
        data: {
          label: "Diff",
          type: "analysis",
          config: { operation: "ST_Difference" },
        },
      }),
    ];
    const edges: Edge[] = [
      {
        id: "e1",
        source: "b",
        target: "diff",
        targetHandle: "input-1",
        type: "smoothstep",
      },
      {
        id: "e2",
        source: "a",
        target: "diff",
        targetHandle: "input-0",
        type: "smoothstep",
      },
    ];

    const result = buildWorkflowSQL(nodes, edges);

    expect(result.sql).toContain('ST_Difference(a."geometry", b."geometry")');
  });

  it("keeps geometry when a scalar single-input function is used", () => {
    const nodes: WorkflowNode[] = [
      makeNode({
        id: "src",
        data: {
          label: "Src",
          type: "input",
          config: { tableName: "polygons" },
        },
      }),
      makeNode({
        id: "area",
        position: { x: 200, y: 0 },
        data: {
          label: "Area",
          type: "analysis",
          config: { operation: "ST_Area" },
        },
      }),
    ];
    const edges: Edge[] = [
      { id: "e1", source: "src", target: "area", type: "smoothstep" },
    ];

    const result = buildWorkflowSQL(nodes, edges);

    expect(result.sql).toContain('ST_Area("geometry") AS "area_result"');
    expect(result.sql).not.toContain("ST_AsGeoJSON");
    expect(result.geomColumn).toBe("geometry");
  });

  it("uses boolean two-input predicates as filters while preserving source geometry", () => {
    const nodes: WorkflowNode[] = [
      makeNode({
        id: "a",
        data: { label: "A", type: "input", config: { tableName: "polygons" } },
      }),
      makeNode({
        id: "b",
        data: { label: "B", type: "input", config: { tableName: "points" } },
      }),
      makeNode({
        id: "contains",
        position: { x: 200, y: 0 },
        data: {
          label: "Contains",
          type: "analysis",
          config: { operation: "ST_Contains" },
        },
      }),
    ];
    const edges: Edge[] = [
      {
        id: "e1",
        source: "a",
        target: "contains",
        targetHandle: "input-0",
        type: "smoothstep",
      },
      {
        id: "e2",
        source: "b",
        target: "contains",
        targetHandle: "input-1",
        type: "smoothstep",
      },
    ];

    const result = buildWorkflowSQL(nodes, edges);

    expect(result.sql).toContain(
      'ST_Contains(a."geometry", b."geometry") AS "contains_result"',
    );
    expect(result.sql).toContain(
      'WHERE ST_Contains(a."geometry", b."geometry")',
    );
    expect(result.sql).not.toContain("ST_AsGeoJSON");
    expect(result.geomColumn).toBe("geometry");
  });

  it("rejects table functions as normal analysis nodes", () => {
    const nodes: WorkflowNode[] = [
      makeNode({
        id: "src",
        data: {
          label: "Src",
          type: "input",
          config: { tableName: "polygons" },
        },
      }),
      makeNode({
        id: "read",
        position: { x: 200, y: 0 },
        data: {
          label: "Read",
          type: "analysis",
          config: { operation: "ST_Read" },
        },
      }),
    ];
    const edges: Edge[] = [
      { id: "e1", source: "src", target: "read", type: "smoothstep" },
    ];

    expect(() => buildWorkflowSQL(nodes, edges)).toThrow(
      "cannot be used as a row-by-row analysis node",
    );
  });

  it("creates an addressable CTE for output nodes", () => {
    const nodes: WorkflowNode[] = [
      makeNode({
        id: "src",
        data: { label: "Src", type: "input", config: { tableName: "data" } },
      }),
      makeNode({
        id: "out",
        position: { x: 200, y: 0 },
        data: { label: "Out", type: "output", config: {} },
      }),
    ];
    const edges: Edge[] = [
      { id: "e1", source: "src", target: "out", type: "smoothstep" },
    ];

    const result = buildWorkflowSQL(nodes, edges);

    expect(result.withClause).toContain("out AS");
    expect(result.sql).toContain("FROM out");
    expect(result.outputLayerName).toBe("workflow_out");
  });

  it("passes visualisation nodes through SQL and exposes style metadata", () => {
    const nodes: WorkflowNode[] = [
      makeNode({
        id: "src",
        data: { label: "Src", type: "input", config: { tableName: "data" } },
      }),
      makeNode({
        id: "style",
        position: { x: 200, y: 0 },
        data: {
          label: "Style",
          type: "visualisation",
          config: {
            kind: "choropleth",
            field: "need",
            method: "quantile",
            classCount: 5,
          },
        },
      }),
      makeNode({
        id: "out",
        position: { x: 400, y: 0 },
        data: { label: "Out", type: "output", config: {} },
      }),
    ];
    const edges: Edge[] = [
      { id: "e1", source: "src", target: "style", type: "smoothstep" },
      { id: "e2", source: "style", target: "out", type: "smoothstep" },
    ];

    const result = buildWorkflowSQL(nodes, edges);

    expect(result.withClause).toContain("style AS");
    expect(result.withClause).toContain("SELECT * FROM src");
    expect(result.visualisationConfig).toMatchObject({
      kind: "choropleth",
      field: "need",
    });
  });

  it("topologically sorts nodes correctly", () => {
    const nodes: WorkflowNode[] = [
      makeNode({
        id: "z",
        position: { x: 400, y: 0 },
        data: { label: "Output", type: "output", config: {} },
      }),
      makeNode({
        id: "buf",
        position: { x: 200, y: 0 },
        data: {
          label: "Buffer",
          type: "analysis",
          config: { operation: "ST_Buffer", distance: 100 },
        },
      }),
      makeNode({
        id: "src",
        data: { label: "Src", type: "input", config: { tableName: "data" } },
      }),
    ];
    const edges: Edge[] = [
      { id: "e1", source: "src", target: "buf", type: "smoothstep" },
      { id: "e2", source: "buf", target: "z", type: "smoothstep" },
    ];
    const result = buildWorkflowSQL(nodes, edges);
    const srcIdx = result.sql.indexOf("src AS");
    const bufIdx = result.sql.indexOf("buf AS");
    expect(srcIdx).toBeLessThan(bufIdx);
    expect(result.sql).toContain("LIMIT 5000");
  });
});

describe("buildUpToSQL", () => {
  it("builds SQL up to a target node, excluding downstream nodes", () => {
    const nodes: WorkflowNode[] = [
      makeNode({
        id: "src",
        data: { label: "Src", type: "input", config: { tableName: "data" } },
      }),
      makeNode({
        id: "buf",
        position: { x: 200, y: 0 },
        data: {
          label: "Buffer",
          type: "analysis",
          config: { operation: "ST_Buffer", distance: 100 },
        },
      }),
      makeNode({
        id: "flt",
        position: { x: 400, y: 0 },
        data: {
          label: "Filter",
          type: "filter",
          config: { condition: "need > 10" },
        },
      }),
    ];
    const edges: Edge[] = [
      { id: "e1", source: "src", target: "buf", type: "smoothstep" },
      { id: "e2", source: "buf", target: "flt", type: "smoothstep" },
    ];

    // Build up to 'buf' — should include src + buf but NOT flt
    const result = buildUpToSQL(nodes, edges, "buf");
    expect(result.sql).toContain("src AS");
    expect(result.sql).toContain("buf AS");
    expect(result.sql).not.toContain("flt AS");
  });

  it("throws for unknown target node", () => {
    const nodes = [
      makeNode({
        id: "src",
        data: { label: "Src", type: "input", config: { tableName: "data" } },
      }),
    ];
    expect(() => buildUpToSQL(nodes, [], "nonexistent")).toThrow(
      "does not exist",
    );
  });
});

describe("join node", () => {
  const joinNodes = (
    config: Record<string, unknown>,
  ): { nodes: WorkflowNode[]; edges: Edge[] } => ({
    nodes: [
      makeNode({
        id: "left",
        data: { label: "Left", type: "input", config: { tableName: "points" } },
      }),
      makeNode({
        id: "right",
        position: { x: 0, y: 200 },
        data: {
          label: "Right",
          type: "input",
          config: { tableName: "polygons" },
        },
      }),
      makeNode({
        id: "jn",
        position: { x: 300, y: 100 },
        data: { label: "Join", type: "join", config },
      }),
    ],
    edges: [
      {
        id: "e1",
        source: "left",
        target: "jn",
        targetHandle: "input-0",
        type: "smoothstep",
      },
      {
        id: "e2",
        source: "right",
        target: "jn",
        targetHandle: "input-1",
        type: "smoothstep",
      },
    ],
  });

  it("compiles a spatial join with renamed right-side columns", () => {
    const { nodes, edges } = joinNodes({
      mode: "spatial",
      predicate: "ST_Intersects",
      joinType: "left",
    });
    const result = buildWorkflowSQL(nodes, edges);
    expect(result.sql).toContain("LEFT JOIN");
    expect(result.sql).toContain(`COLUMNS('(.*)') AS 'r_\\1'`);
    expect(result.sql).toContain('ST_Intersects(a."geometry", r."r_geometry")');
    expect(result.sql).toContain('EXCLUDE ("r_geometry")');
    expect(result.geomColumn).toBe("geometry");
  });

  it("compiles an attribute join on key columns", () => {
    const { nodes, edges } = joinNodes({
      mode: "attribute",
      joinType: "inner",
      leftKey: "ward_code",
      rightKey: "code",
    });
    const result = buildWorkflowSQL(nodes, edges);
    expect(result.sql).toContain("JOIN");
    expect(result.sql).not.toContain("LEFT JOIN");
    expect(result.sql).toContain('a."ward_code" = r."r_code"');
  });

  it("compiles a within-distance join with the configured distance", () => {
    const { nodes, edges } = joinNodes({
      mode: "spatial",
      predicate: "ST_DWithin",
      distance: 250,
    });
    const result = buildWorkflowSQL(nodes, edges);
    expect(result.sql).toContain(
      'ST_DWithin(a."geometry", r."r_geometry", 250)',
    );
  });

  it("throws without two inputs or missing attribute keys", () => {
    const { nodes, edges } = joinNodes({ mode: "attribute" });
    expect(() => buildWorkflowSQL(nodes, edges)).toThrow(
      "needs both key fields",
    );

    const single = joinNodes({ mode: "spatial" });
    expect(() => buildWorkflowSQL(single.nodes, [single.edges[0]])).toThrow(
      "requires 2 input connections",
    );
  });
});

describe("terminal node attribution", () => {
  it("names the node whose output the final CTE holds", () => {
    const nodes = [
      makeNode({
        id: "input-1",
        data: {
          label: "In",
          type: "input",
          config: { tableName: "wards" },
        } as any,
      }),
      makeNode({
        id: "filter-1",
        type: "filter",
        data: {
          label: "Filter",
          type: "filter",
          config: { condition: "need > 10" },
        } as any,
      }),
    ];
    const edges: Edge[] = [{ id: "e1", source: "input-1", target: "filter-1" }];
    expect(buildWorkflowSQL(nodes, edges).terminalNodeId).toBe("filter-1");
  });

  it("names the target node when running only part of the graph", () => {
    const nodes = [
      makeNode({
        id: "input-1",
        data: {
          label: "In",
          type: "input",
          config: { tableName: "wards" },
        } as any,
      }),
      makeNode({
        id: "filter-1",
        type: "filter",
        data: {
          label: "Filter",
          type: "filter",
          config: { condition: "need > 10" },
        } as any,
      }),
      makeNode({
        id: "attribute-1",
        type: "attribute",
        data: {
          label: "Score",
          type: "attribute",
          config: { expression: "need * 2", resultField: "score" },
        } as any,
      }),
    ];
    const edges: Edge[] = [
      { id: "e1", source: "input-1", target: "filter-1" },
      { id: "e2", source: "filter-1", target: "attribute-1" },
    ];
    expect(buildUpToSQL(nodes, edges, "filter-1").terminalNodeId).toBe(
      "filter-1",
    );
  });
});

describe("summary aggregation", () => {
  const summaryNodes = (config: Record<string, unknown>) => ({
    nodes: [
      makeNode({
        id: "input-1",
        data: {
          label: "In",
          type: "input",
          config: { tableName: "cells" },
        } as any,
      }),
      makeNode({
        id: "agg-1",
        type: "aggregate",
        data: {
          label: "Summarise",
          type: "aggregate",
          config: { mode: "summary", ...config },
        } as any,
      }),
    ],
    edges: [{ id: "e1", source: "input-1", target: "agg-1" }] as Edge[],
  });

  it("groups numeric measures by one or more keys", () => {
    const { nodes, edges } = summaryNodes({
      groupBy: ["substation_id"],
      measures: [
        { id: "m1", fn: "sum", field: "proposed_kw" },
        { id: "m2", fn: "count" },
      ],
    });
    const sql = buildWorkflowSQL(nodes, edges).sql;
    expect(sql).toContain(
      'SUM(TRY_CAST("proposed_kw" AS DOUBLE)) AS "sum_proposed_kw"',
    );
    expect(sql).toContain('COUNT(*) AS "row_count"');
    expect(sql).toContain('GROUP BY "substation_id"');
  });

  it("supports several group keys", () => {
    const { nodes, edges } = summaryNodes({
      groupBy: ["ward", "year"],
      measures: [{ id: "m1", fn: "avg", field: "cost" }],
    });
    expect(buildWorkflowSQL(nodes, edges).sql).toContain(
      'GROUP BY "ward", "year"',
    );
  });

  it("aggregates the whole table when no key is given", () => {
    const { nodes, edges } = summaryNodes({
      measures: [{ id: "m1", fn: "sum", field: "cost" }],
    });
    const sql = buildWorkflowSQL(nodes, edges).sql;
    expect(sql).toContain('SUM(TRY_CAST("cost" AS DOUBLE))');
    expect(sql).not.toContain("GROUP BY");
  });

  it("unions the group geometry when asked, so the summary stays mappable", () => {
    const { nodes, edges } = summaryNodes({
      groupBy: ["ward"],
      measures: [{ id: "m1", fn: "sum", field: "cost" }],
      includeGeometry: true,
    });
    const result = buildWorkflowSQL(nodes, edges);
    expect(result.sql).toContain('ST_Union_Agg("geometry") AS geom_agg');
    expect(result.geomColumn).toBe("geom_agg");
  });

  it("reports no geometry column when the summary is a plain table", () => {
    const { nodes, edges } = summaryNodes({
      groupBy: ["ward"],
      measures: [{ id: "m1", fn: "count" }],
    });
    expect(buildWorkflowSQL(nodes, edges).geomColumn).toBe("");
  });

  it("refuses to compile a half-configured measure", () => {
    const { nodes, edges } = summaryNodes({
      measures: [{ id: "m1", fn: "sum" }],
    });
    expect(() => buildWorkflowSQL(nodes, edges)).toThrow("needs a column");
  });

  it("still dissolves geometry in spatial mode", () => {
    const nodes = [
      makeNode({
        id: "input-1",
        data: {
          label: "In",
          type: "input",
          config: { tableName: "cells" },
        } as any,
      }),
      makeNode({
        id: "agg-1",
        type: "aggregate",
        data: {
          label: "Dissolve",
          type: "aggregate",
          config: { operation: "ST_Union_Agg", groupBy: "ward" },
        } as any,
      }),
    ];
    const sql = buildWorkflowSQL(nodes, [
      { id: "e1", source: "input-1", target: "agg-1" },
    ]).sql;
    expect(sql).toContain('ST_Union_Agg("geometry") AS geom_agg');
    expect(sql).toContain('GROUP BY "ward"');
  });
});

describe("allocation", () => {
  const allocateNodes = (config: Record<string, unknown>) => ({
    nodes: [
      makeNode({
        id: "input-1",
        data: {
          label: "In",
          type: "input",
          config: { tableName: "candidates" },
        } as any,
      }),
      makeNode({
        id: "alloc-1",
        type: "allocate",
        data: { label: "Allocate", type: "allocate", config } as any,
      }),
    ],
    edges: [{ id: "e1", source: "input-1", target: "alloc-1" }] as Edge[],
  });

  it("flags rows against the limit without dropping any", () => {
    const { nodes, edges } = allocateNodes({
      orderBy: "score",
      amountField: "cost",
      limit: 10000000,
    });
    const sql = buildWorkflowSQL(nodes, edges).sql;
    expect(sql).toContain("ROWS UNBOUNDED PRECEDING");
    expect(sql).toContain('"cost_status"');
    expect(sql).not.toContain("WHERE \"cost_status\" = 'within'");
  });

  it("drops rows past the limit in cut mode", () => {
    const { nodes, edges } = allocateNodes({
      orderBy: "score",
      amountField: "cost",
      limit: 5000,
      mode: "cut",
    });
    expect(buildWorkflowSQL(nodes, edges).sql).toContain(
      `WHERE "cost_status" = 'within'`,
    );
  });

  it("gives the straddling row a partial share in scale mode", () => {
    const { nodes, edges } = allocateNodes({
      orderBy: "score",
      amountField: "cost",
      limit: 5000,
      mode: "scale",
    });
    expect(buildWorkflowSQL(nodes, edges).sql).toContain('"allocated_cost"');
  });

  it("keeps the upstream geometry, so an allocation is still mappable", () => {
    const { nodes, edges } = allocateNodes({
      orderBy: "score",
      amountField: "cost",
      limit: 5000,
    });
    expect(buildWorkflowSQL(nodes, edges).geomColumn).toBe("geometry");
  });

  it("refuses to compile without a limit", () => {
    const { nodes, edges } = allocateNodes({
      orderBy: "score",
      amountField: "cost",
    });
    expect(() => buildWorkflowSQL(nodes, edges)).toThrow("numeric limit");
  });
});

describe("top-N filtering", () => {
  const topNNodes = (config: Record<string, unknown>) => ({
    nodes: [
      makeNode({
        id: "input-1",
        data: {
          label: "In",
          type: "input",
          config: { tableName: "candidates" },
        } as any,
      }),
      makeNode({
        id: "filter-1",
        type: "filter",
        data: {
          label: "Top N",
          type: "filter",
          config: { mode: "top-n", ...config },
        } as any,
      }),
    ],
    edges: [{ id: "e1", source: "input-1", target: "filter-1" }] as Edge[],
  });

  it("qualifies on rank rather than nesting a subquery", () => {
    const { nodes, edges } = topNNodes({ field: "score", count: 50 });
    const sql = buildWorkflowSQL(nodes, edges).sql;
    expect(sql).toContain('QUALIFY RANK() OVER (ORDER BY "score" DESC) <= 50');
  });

  it("refuses to compile without a column or a count", () => {
    expect(() =>
      buildWorkflowSQL(
        ...(Object.values(topNNodes({ count: 50 })) as [any, any]),
      ),
    ).toThrow("column to rank by");
    expect(() =>
      buildWorkflowSQL(
        ...(Object.values(topNNodes({ field: "score" })) as [any, any]),
      ),
    ).toThrow("how many rows");
  });
});

describe("composite score", () => {
  const scoreNodes = (config: Record<string, unknown>) => ({
    nodes: [
      makeNode({
        id: "input-1",
        data: {
          label: "In",
          type: "input",
          config: { tableName: "candidates" },
        } as any,
      }),
      makeNode({
        id: "score-1",
        type: "score",
        data: { label: "Score", type: "score", config } as any,
      }),
    ],
    edges: [{ id: "e1", source: "input-1", target: "score-1" }] as Edge[],
  });

  const model = {
    criteria: [
      {
        field: "heat",
        weight: 3,
        direction: "higher",
        normalisation: "min-max",
      },
      { field: "imd", weight: 1, direction: "lower", normalisation: "rank" },
    ],
    missingValueTreatment: "zero",
  };

  it("emits a score, a rank and one contribution column per criterion", () => {
    const { nodes, edges } = scoreNodes({
      scoreModel: model,
      resultField: "priority",
    });
    const sql = buildWorkflowSQL(nodes, edges).sql;
    expect(sql).toContain('AS "priority"');
    expect(sql).toContain('AS "priority_rank"');
    expect(sql).toContain('AS "priority_c_heat"');
    expect(sql).toContain('AS "priority_c_imd"');
  });

  it("ranks in a second pass, because a window cannot read its own SELECT alias", () => {
    const { nodes, edges } = scoreNodes({
      scoreModel: model,
      resultField: "priority",
    });
    const sql = buildWorkflowSQL(nodes, edges).sql;
    expect(sql).toContain('RANK() OVER (ORDER BY "priority" DESC NULLS LAST)');
    // The ranking SELECT wraps the scoring one, so RANK appears before the
    // score column it reads.
    expect(sql.indexOf("RANK() OVER")).toBeLessThan(
      sql.indexOf('AS "priority"'),
    );
  });

  it("honours weight, direction and normalisation from the model", () => {
    const { nodes, edges } = scoreNodes({
      scoreModel: model,
      resultField: "priority",
    });
    const sql = buildWorkflowSQL(nodes, edges).sql;
    expect(sql).toContain("(0.75) *");
    expect(sql).toContain("(0.25) *");
    expect(sql).toContain("PERCENT_RANK() OVER (ORDER BY");
  });

  it("drops the contribution columns when they are turned off", () => {
    const { nodes, edges } = scoreNodes({
      scoreModel: model,
      resultField: "priority",
      includeContributions: false,
    });
    const sql = buildWorkflowSQL(nodes, edges).sql;
    expect(sql).toContain('AS "priority"');
    expect(sql).not.toContain("priority_c_heat");
  });

  it("defaults its output column so a freshly dropped node still compiles", () => {
    const { nodes, edges } = scoreNodes({ scoreModel: model });
    expect(buildWorkflowSQL(nodes, edges).sql).toContain('AS "alur_score"');
  });

  it("keeps the upstream geometry, so a scored layer is still mappable", () => {
    const { nodes, edges } = scoreNodes({ scoreModel: model });
    expect(buildWorkflowSQL(nodes, edges).geomColumn).toBe("geometry");
  });

  it("refuses to compile an empty or unweighted model", () => {
    expect(() =>
      buildWorkflowSQL(
        ...(Object.values(
          scoreNodes({
            scoreModel: { criteria: [], missingValueTreatment: "zero" },
          }),
        ) as [any, any]),
      ),
    ).toThrow("at least one criterion");
    expect(() =>
      buildWorkflowSQL(
        ...(Object.values(
          scoreNodes({
            scoreModel: {
              criteria: [
                {
                  field: "heat",
                  weight: 0,
                  direction: "higher",
                  normalisation: "min-max",
                },
              ],
              missingValueTreatment: "zero",
            },
          }),
        ) as [any, any]),
      ),
    ).toThrow("above zero");
  });
});

describe("variant parameters", () => {
  const parameterised = (config: Record<string, unknown>) => ({
    nodes: [
      makeNode({
        id: "input-1",
        data: {
          label: "In",
          type: "input",
          config: { tableName: "candidates" },
        } as any,
      }),
      makeNode({
        id: "filter-1",
        type: "filter",
        data: {
          label: "Top N",
          type: "filter",
          config: { mode: "top-n", ...config },
        } as any,
      }),
    ],
    edges: [{ id: "e1", source: "input-1", target: "filter-1" }] as Edge[],
  });

  it("compiles a reference into the value the variant supplied", () => {
    const { nodes, edges } = parameterised({
      field: "score",
      count: { $param: "topN" },
    });
    expect(
      buildWorkflowSQL(nodes, edges, { parameters: { topN: 25 } }).sql,
    ).toContain("<= 25");
  });

  it("produces different SQL for different variants from one graph", () => {
    const { nodes, edges } = parameterised({
      field: "score",
      count: { $param: "topN" },
    });
    const first = buildWorkflowSQL(nodes, edges, {
      parameters: { topN: 10 },
    }).sql;
    const second = buildWorkflowSQL(nodes, edges, {
      parameters: { topN: 200 },
    }).sql;
    expect(first).toContain("<= 10");
    expect(second).toContain("<= 200");
  });

  it("uses a declared default when no variant is being run", () => {
    const { nodes, edges } = parameterised({
      field: "score",
      count: { $param: "topN", default: 50 },
    });
    expect(buildWorkflowSQL(nodes, edges).sql).toContain("<= 50");
  });

  it("fails with an actionable message when nothing supplies the value", () => {
    const { nodes, edges } = parameterised({
      field: "score",
      count: { $param: "topN" },
    });
    expect(() => buildWorkflowSQL(nodes, edges)).toThrow(
      /needs a value for "topN"/,
    );
  });
});

describe("unloadedSourceNodes", () => {
  const loaded = makeNode({
    id: "a",
    data: { label: "A", type: "input", config: { tableName: "places" } } as any,
  });
  const loading = makeNode({
    id: "b",
    data: {
      label: "B",
      type: "input",
      config: { remoteUrl: "https://h/x.parquet" },
    } as any,
  });
  const drawn = makeNode({
    id: "c",
    data: { label: "C", type: "geometry", config: {} } as any,
  });
  const step = makeNode({
    id: "d",
    type: "analysis",
    data: {
      label: "D",
      type: "analysis",
      config: { operation: "ST_Buffer" },
    } as any,
  });

  it("names the sources that have nothing behind them yet", () => {
    expect(
      unloadedSourceNodes([loaded, loading, drawn, step]).map(
        (node) => node.id,
      ),
    ).toEqual(["b", "c"]);
    expect(unloadedSourceNodes([loaded, step])).toEqual([]);
  });

  it("agrees with what buildWorkflowSQL refuses to compile", () => {
    const edges: Edge[] = [{ id: "e1", source: "b", target: "d" }] as Edge[];
    expect(unloadedSourceNodes([loading, step])).toHaveLength(1);
    expect(() => buildWorkflowSQL([loading, step], edges)).toThrow(
      /has no table loaded/,
    );

    const readyEdges: Edge[] = [
      { id: "e2", source: "a", target: "d" },
    ] as Edge[];
    expect(unloadedSourceNodes([loaded, step])).toHaveLength(0);
    expect(() => buildWorkflowSQL([loaded, step], readyEdges)).not.toThrow();
  });

  it("flags a source that is unrelated to the node being previewed, because the compiler still visits it", () => {
    const edges: Edge[] = [{ id: "e3", source: "a", target: "d" }] as Edge[];
    expect(unloadedSourceNodes([loaded, step, loading])).toHaveLength(1);
    expect(() => buildWorkflowSQL([loaded, step, loading], edges)).toThrow(
      /has no table loaded/,
    );
  });
});

describe("h3 node", () => {
  const src = makeNode({
    id: "src",
    data: { label: "Src", type: "input", config: { tableName: "places" } },
  });
  const h3 = (config: Record<string, unknown>) =>
    makeNode({
      id: "h3-1",
      position: { x: 200, y: 0 },
      data: { label: "H3", type: "h3", config },
    });

  it("turns lat/lng into an H3 cell string and flags needsH3", () => {
    const edges: Edge[] = [
      { id: "e1", source: "src", target: "h3-1", type: "smoothstep" },
    ];
    const result = buildWorkflowSQL(
      [
        src,
        h3({
          operation: "h3_latlng_to_cell",
          latField: "lat",
          lngField: "lng",
          resolution: 7,
        }),
      ],
      edges,
    );

    expect(result.sql).toContain('h3_latlng_to_cell_string("lat", "lng", 7)');
    expect(result.sql).toContain('AS "h3_cell"');
    expect(result.needsH3).toBe(true);
    expect(result.geomColumn).toBe("geometry");
  });

  it("wraps cell-to-parent via string/h3 conversions so no 2^53 precision is lost", () => {
    const edges: Edge[] = [
      { id: "e1", source: "src", target: "h3-1", type: "smoothstep" },
    ];
    const result = buildWorkflowSQL(
      [
        src,
        h3({
          operation: "h3_cell_to_parent",
          cellField: "h3_cell",
          resolution: 5,
          resultField: "parent",
        }),
      ],
      edges,
    );

    expect(result.sql).toContain(
      'h3_h3_to_string(h3_cell_to_parent(h3_string_to_h3("h3_cell"), 5))',
    );
    expect(result.sql).toContain('AS "parent"');
    expect(result.needsH3).toBe(true);
  });

  it("emits a WKT boundary for a cell column", () => {
    const edges: Edge[] = [
      { id: "e1", source: "src", target: "h3-1", type: "smoothstep" },
    ];
    const result = buildWorkflowSQL(
      [
        src,
        h3({
          operation: "h3_cell_to_boundary_wkt",
          cellField: "h3_cell",
          resultField: "h3_wkt",
        }),
      ],
      edges,
    );

    expect(result.sql).toContain(
      'h3_cell_to_boundary_wkt(h3_string_to_h3("h3_cell"))',
    );
    expect(result.sql).toContain('AS "h3_wkt"');
    expect(result.needsH3).toBe(true);
  });

  it("rejects unknown operations and missing required fields", () => {
    const edges: Edge[] = [
      { id: "e1", source: "src", target: "h3-1", type: "smoothstep" },
    ];
    expect(() =>
      buildWorkflowSQL([src, h3({ operation: "h3_nope" })], edges),
    ).toThrow(/Unsupported H3 operation/);
    expect(() =>
      buildWorkflowSQL([src, h3({ operation: "h3_cell_to_parent" })], edges),
    ).toThrow(/incomplete.*cell column/i);
  });

  it("polyfills a geometry column into dissolved cells with a mappable boundary", () => {
    const edges: Edge[] = [
      { id: "e1", source: "src", target: "h3-1", type: "smoothstep" },
    ];
    const result = buildWorkflowSQL(
      [src, h3({ mode: "polyfill", geometryField: "geometry", resolution: 8 })],
      edges,
    );

    expect(result.sql).toContain(
      'h3_polygon_wkt_to_cells_string(ST_AsText("geometry"), 8)',
    );
    expect(result.sql).toContain("COUNT(*) AS feature_count");
    expect(result.sql).toContain(
      "ST_GeomFromText(h3_cell_to_boundary_wkt(cell)) AS geometry",
    );
    expect(result.sql).toContain("GROUP BY 1");
    expect(result.needsH3).toBe(true);
    expect(result.geomColumn).toBe("geometry");
  });

  it("encodes a summed attribute onto each cell and buffers lines when asked", () => {
    const edges: Edge[] = [
      { id: "e1", source: "src", target: "h3-1", type: "smoothstep" },
    ];
    const result = buildWorkflowSQL(
      [
        src,
        h3({
          mode: "polyfill",
          geometryField: "geometry",
          resolution: 7,
          aggregate: "sum",
          valueField: "population",
          resultField: "pop_total",
          buffer: 500,
        }),
      ],
      edges,
    );

    expect(result.sql).toContain('ST_AsText(ST_Buffer("geometry", 500))');
    expect(result.sql).toContain('SUM(__alur_h3_value) AS "pop_total"');
    expect(result.sql).toContain('"population" AS __alur_h3_value');
    expect(result.sql).toContain(
      'WHERE "geometry" IS NOT NULL AND "population" IS NOT NULL',
    );
    expect(result.sql).toContain("COUNT(*) AS feature_count");
  });

  it("rejects an incomplete polyfill node", () => {
    const edges: Edge[] = [
      { id: "e1", source: "src", target: "h3-1", type: "smoothstep" },
    ];
    expect(() =>
      buildWorkflowSQL([src, h3({ mode: "polyfill", resolution: 9 })], edges),
    ).toThrow(/incomplete.*geometry column/i);
    expect(() =>
      buildWorkflowSQL(
        [
          src,
          h3({ mode: "polyfill", geometryField: "geometry", aggregate: "avg" }),
        ],
        edges,
      ),
    ).toThrow(/incomplete.*value column/i);
  });

  it("exports a pure cell table (no geometry) when includeGeometry is off", () => {
    const edges: Edge[] = [
      { id: "e1", source: "src", target: "h3-1", type: "smoothstep" },
    ];
    const result = buildWorkflowSQL(
      [
        src,
        h3({
          mode: "polyfill",
          geometryField: "geometry",
          resolution: 8,
          includeGeometry: false,
        }),
      ],
      edges,
    );

    expect(result.sql).toContain(
      'h3_polygon_wkt_to_cells_string(ST_AsText("geometry"), 8)',
    );
    expect(result.sql).not.toContain("h3_cell_to_boundary_wkt");
    expect(result.geomColumn).toBe("");
    expect(result.needsH3).toBe(true);
  });

  it("turns a cell column into a mappable geometry via the encode op", () => {
    const edges: Edge[] = [
      { id: "e1", source: "src", target: "h3-1", type: "smoothstep" },
    ];
    const result = buildWorkflowSQL(
      [
        src,
        h3({
          operation: "h3_cell_to_boundary_geometry",
          cellField: "h3_cell",
          resultField: "h3_geom",
        }),
      ],
      edges,
    );

    expect(result.sql).toContain(
      'ST_GeomFromText(h3_cell_to_boundary_wkt(h3_string_to_h3("h3_cell"))) AS "h3_geom"',
    );
    expect(result.geomColumn).toBe("h3_geom");
    expect(result.geomCrs).toBe("EPSG:4326");
    expect(result.needsH3).toBe(true);
  });
});

describe("circular connections", () => {
  const chain = (): { nodes: WorkflowNode[]; edges: Edge[] } => ({
    nodes: [
      makeNode({ id: "src", data: { label: "Src", type: "input", config: { tableName: "london" } } }),
      makeNode({ id: "a1", data: { label: "A1", type: "attribute", config: { expression: "1" } } }),
      makeNode({ id: "a2", data: { label: "A2", type: "attribute", config: { expression: "2" } } }),
    ],
    edges: [
      { id: "e1", source: "src", target: "a1" },
      { id: "e2", source: "a1", target: "a2" },
    ],
  });

  it("compiles every step of an acyclic chain", () => {
    const { nodes, edges } = chain();
    const sql = buildWorkflowSQL(nodes, edges).sql;
    expect(sql).toContain(cteAlias("a1"));
    expect(sql).toContain(cteAlias("a2"));
  });

  it("refuses rather than silently dropping the looped steps", () => {
    const { nodes, edges } = chain();
    edges.push({ id: "loop", source: "a2", target: "a1" });
    // Previously this returned a successful build containing only the input.
    expect(() => buildWorkflowSQL(nodes, edges)).toThrow(/Circular connection/);
    expect(() => buildWorkflowSQL(nodes, edges)).toThrow(/A1, A2/);
  });
});

describe("bypassed steps", () => {
  it("passes its input through instead of applying itself", () => {
    const nodes: WorkflowNode[] = [
      makeNode({ id: "src", data: { label: "Src", type: "input", config: { tableName: "london" } } }),
      makeNode({
        id: "buf",
        data: { label: "Buffer", type: "analysis", config: { operation: "ST_Buffer", distance: 500 }, disabled: true },
      }),
    ];
    const edges: Edge[] = [{ id: "e1", source: "src", target: "buf" }];
    const result = buildWorkflowSQL(nodes, edges);

    // The step is still a CTE, so anything downstream keeps its source alias…
    expect(result.sql).toContain(`${cteAlias("buf")} AS (`);
    expect(result.sql).toContain(`SELECT * FROM ${cteAlias("src")}`);
    // …but its own operation is gone.
    expect(result.sql).not.toContain("ST_Buffer");
  });

  it("keeps the upstream geometry column so downstream steps still work", () => {
    const nodes: WorkflowNode[] = [
      makeNode({ id: "src", data: { label: "Src", type: "input", config: { tableName: "london" } } }),
      makeNode({ id: "skip", data: { label: "Skip", type: "attribute", config: { expression: "1" }, disabled: true } }),
      makeNode({ id: "buf", data: { label: "Buffer", type: "analysis", config: { operation: "ST_Buffer", distance: 250 } } }),
    ];
    const edges: Edge[] = [
      { id: "e1", source: "src", target: "skip" },
      { id: "e2", source: "skip", target: "buf" },
    ];
    const result = buildWorkflowSQL(nodes, edges);
    expect(result.sql).toContain("ST_Buffer");
    expect(result.geomColumn).toBe("geom_buffered");
  });

  it("does not bypass a source node, which has nothing to pass through", () => {
    const nodes: WorkflowNode[] = [
      makeNode({ id: "src", data: { label: "Src", type: "input", config: { tableName: "london" }, disabled: true } }),
    ];
    const result = buildWorkflowSQL(nodes, []);
    expect(result.sql).toContain('FROM "london"');
  });
});

describe("group boxes", () => {
  const withGroup = (): { nodes: WorkflowNode[]; edges: Edge[] } => ({
    nodes: [
      makeNode({ id: "src", data: { label: "Src", type: "input", config: { tableName: "london" } } }),
      makeNode({ id: "a1", data: { label: "A1", type: "attribute", config: { expression: "1" } } }),
      makeNode({ id: "box", data: { label: "Cleaning", type: "group", config: {} } }),
    ],
    edges: [{ id: "e1", source: "src", target: "a1" }],
  });

  it("compiles to exactly the same SQL with or without a box on the canvas", () => {
    const { nodes, edges } = withGroup();
    const annotated = buildWorkflowSQL(nodes, edges).sql;
    const plain = buildWorkflowSQL(nodes.filter((n) => n.data.type !== "group"), edges).sql;
    expect(annotated).toBe(plain);
  });

  it("never emits a CTE for a box", () => {
    const { nodes, edges } = withGroup();
    expect(buildWorkflowSQL(nodes, edges).sql).not.toContain(cteAlias("box"));
  });

  it("does not let a box become the terminal step", () => {
    const { nodes, edges } = withGroup();
    expect(buildWorkflowSQL(nodes, edges).terminalNodeId).toBe("a1");
  });

  it("reports an empty workflow when the canvas holds only boxes", () => {
    const nodes = [makeNode({ id: "box", data: { label: "Empty", type: "group", config: {} } })];
    expect(() => buildWorkflowSQL(nodes, [])).toThrow("No nodes in the workflow.");
  });

  it("is invisible to a run-up-to-here as well", () => {
    const { nodes, edges } = withGroup();
    expect(buildUpToSQL(nodes, edges, "a1").sql).not.toContain(cteAlias("box"));
  });
});
