# ALUR: Production Roadmap

This document outlines the architectural evolution and feature roadmap for GeoModeler Pro, transitioning from a prototype to a production-grade GIS processing modeler.

## Status: All Phases Completed - Production Ready Prototype 🚀

---

## Phase 1: Power & Extensibility (The “Core” Engine) [DONE]
**Goal**: Transition from linear pipelines to a true DAG (Directed Acyclic Graph) modeler capable of complex spatial operations.

### 1.1 Multi-Input Nodes [DONE]
- **Requirement**: Support operations involving multiple tables (e.g., Joins, Intersections, Differences).
- **Implementation**:
    - [x] Update `AnalysisNode` to support dynamic input handles (Source A, Source B).
    - [x] Refactor `workflowEngine.ts` to handle multiple parent dependencies per node.
    - [x] Update `llmToolDefinitions.ts` to allow the LLM to specify source/target relationships for multi-input operations.

### 1.2 Spatial Aggregations [DONE]
- **Requirement**: Summarize spatial data (e.g., “Dissolve boundaries,” “Sum area by category”).
- **Implementation**:
    - [x] Add `ST_Union_Agg` and `ST_Envelope_Agg` support.
    - [x] Introduce grouping logic in a new `AggregateNode`.
    - [x] Update `workflowEngine.ts` to support `GROUP BY` and aggregate spatial functions.

### 1.3 Performance Optimization
- **Requirement**: Handle large datasets (>100k features) without UI lag.
## Status: Phase 2 [DONE]

---

## Phase 1: Power & Extensibility (The “Core” Engine) [DONE]
…
## Phase 2: Professional Data Handling [DONE]
**Goal**: Provide industry-standard data inspection and portability.

### 2.1 Attribute Inspector (TanStack Table) [DONE]
- **Requirement**: High-performance tabular view for data inspection.
- **Implementation**:
    - [x] Integrate `@tanstack/react-table`.
    - [x] Implement a “Preview Panel” that updates based on the selected node in the Flow.
    - [x] Add node selection state in Zustand store.

### 2.2 Data Export Service [DONE]
- **Requirement**: Download results as GeoParquet, CSV, or GeoJSON.
- **Implementation**:
    - [x] Use DuckDB `COPY ... TO` command.
    - [x] Utilize `duckdb.copyFileToBuffer` to generate downloadable Blobs.
    - [x] Integrated Export buttons in Footer and Attribute Inspector.

---

## Phase 3: Advanced UX & LLM Intelligence
**Goal**: Create a seamless “AI-First” modeling experience.

### 3.1 Metadata-Aware Nodes [DONE]
- **Requirement**: Nodes should show available columns/types.
- **Implementation**:
    - [x] Fetch schema via `PRAGMA table_info` when a node is executed.
    - [x] Store schema in the Zustand store and display in node UI using `NodeSchema` component.

### 3.2 LLM Planner & Self-Correction [DONE]
- **Requirement**: Complex workflow generation and auto-fixing of SQL errors.
- **Implementation**:
    - [x] Update system prompt with “Chain of Thought” instructions.
    - [x] Inject real-time schema metadata into the AI context for “Schema Awareness”.
    - [x] Create a feedback loop where DuckDB errors are passed back to the LLM via chat history for self-correction.

