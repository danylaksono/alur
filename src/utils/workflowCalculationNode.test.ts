import { describe, expect, it } from "vitest";
import type { Edge } from "@xyflow/react";
import type { WorkflowNode } from "../store/useStore";
import { buildUpToSQL, buildWorkflowSQL, cteAlias, unloadedSourceNodes } from "./workflowEngine";

/**
 * How a calculation behaves in the compiled graph.
 *
 * The claim under test is that a calculation is a *cut* in the SQL chain, not a
 * step in it: everything above it has already run by the time the graph is
 * compiled, so it must not be compiled again, and the node itself must read as
 * an ordinary table so that every node type downstream keeps working without
 * being taught that calculations exist.
 */

const node = (overrides: Partial<WorkflowNode>): WorkflowNode =>
  ({
    id: "n",
    type: "input",
    position: { x: 0, y: 0 },
    data: { label: "Node", type: "input", config: {} },
    ...overrides,
  }) as WorkflowNode;

const source = (id: string, tableName: string) =>
  node({ id, data: { label: id, type: "input", config: { tableName } } });

const calculation = (id: string, config: Record<string, unknown> = {}) =>
  node({ id, type: "calculation", data: { label: "Cluster", type: "calculation", config } });

const edge = (id: string, from: string, to: string, handle?: string): Edge =>
  ({ id, source: from, target: to, ...(handle ? { targetHandle: handle } : {}) }) as Edge;

describe("a calculation node in the compiled graph", () => {
  it("reads as an ordinary table once it has been run", () => {
    const result = buildWorkflowSQL([calculation("c1", { tableName: "calc_out" })], []);
    expect(result.sql).toContain(`${cteAlias("c1")} AS`);
    expect(result.sql).toContain('SELECT * FROM "calc_out"');
  });

  it("names the step that would make it queryable rather than the shortfall", () => {
    expect(() => buildWorkflowSQL([calculation("c1")], [])).toThrow(/has not been run yet/);
  });

  it("is reported alongside the other sources nothing is behind yet", () => {
    const nodes = [source("in", "t"), calculation("c1")];
    expect(unloadedSourceNodes(nodes).map((item) => item.id)).toEqual(["c1"]);
  });

  it("drops what fed it, because that data was read before the calculation ran", () => {
    // in → filter → c1 → out. By compile time c1 holds its own table, so
    // recompiling the branch above it is at best dead weight.
    const nodes = [
      source("in", "buildings"),
      node({ id: "f1", data: { label: "Filter", type: "filter", config: { field: "x", operator: ">", value: 1 } } }),
      calculation("c1", { tableName: "calc_out" }),
      node({ id: "o1", data: { label: "Out", type: "output", config: {} } }),
    ];
    const edges = [
      edge("e1", "in", "f1"),
      edge("e2", "f1", "c1", "in-units"),
      edge("e3", "c1", "o1"),
    ];

    const result = buildWorkflowSQL(nodes, edges);
    expect(result.sql).not.toContain(`${cteAlias("in")} AS`);
    expect(result.sql).not.toContain(`${cteAlias("f1")} AS`);
    expect(result.sql).toContain('SELECT * FROM "calc_out"');
    expect(result.terminalNodeId).toBe("o1");
  });

  it("still compiles a branch that a calculation is not the only consumer of", () => {
    // `in` feeds both the calculation and an output of its own, so it survives.
    const nodes = [
      source("in", "buildings"),
      calculation("c1", { tableName: "calc_out" }),
      node({ id: "o1", data: { label: "Out", type: "output", config: {} } }),
    ];
    const edges = [edge("e1", "in", "c1", "in-units"), edge("e2", "in", "o1")];

    const result = buildWorkflowSQL(nodes, edges);
    expect(result.sql).toContain(`${cteAlias("in")} AS`);
    expect(result.sql).toContain(`${cteAlias("c1")} AS`);
  });

  it("lets an unrun calculation's own upstream still be built on its own", () => {
    // The node cannot compile, but the branch feeding it must — otherwise its
    // columns are unknowable and the node could never be configured at all.
    const nodes = [source("in", "buildings"), calculation("c1")];
    const edges = [edge("e1", "in", "c1", "in-units")];

    expect(() => buildWorkflowSQL(nodes, edges)).toThrow(/has not been run yet/);
    expect(buildUpToSQL(nodes, edges, "in").sql).toContain('SELECT * FROM "buildings"');
  });

  it("leaves a graph with no calculation in it exactly as it was", () => {
    const nodes = [
      source("in", "buildings"),
      node({ id: "a1", data: { label: "Buffer", type: "analysis", config: { operation: "ST_Buffer", params: { radius: 10 } } } }),
      node({ id: "o1", data: { label: "Out", type: "output", config: {} } }),
    ];
    const edges = [edge("e1", "in", "a1"), edge("e2", "a1", "o1")];

    const result = buildWorkflowSQL(nodes, edges);
    for (const id of ["in", "a1", "o1"]) expect(result.sql).toContain(`${cteAlias(id)} AS`);
  });
});
