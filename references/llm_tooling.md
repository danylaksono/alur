# LLM Tooling for GeoModeler Pro

This document describes how the GeoModeler Pro app should expose tools to an LLM and how future development should keep the tool contract aligned.

## Current state

- The current OpenRouter integration in `src/utils/openrouter.ts` sends a normal chat completion request.
- The model prompt describes available actions, but there is no real tool-calling payload attached.
- The chat component currently uses a heuristic fallback based on text matching.

## Desired architecture

The app will expose a set of structured tools to the LLM using JSON Schema function definitions.
The model should be able to return a tool invocation instead of free text, and the client should parse that invocation and execute the corresponding local action.

## Tool definitions

The supported tools are defined in `src/utils/toolDefinitions.ts`.
They include:

- `add_node`
  - Add a new workflow node to the React Flow model.
  - Used for input, analysis, and output nodes.
  - Parameters: `type`, `label`, optional `id`, optional `config`, optional `position`.

- `connect_nodes`
  - Connect two workflow nodes by their ids.
  - Parameters: `source_id`, `target_id`.

- `update_node`
  - Update an existing node configuration.
  - Parameters: `id`, `config`.

- `run_spatial_query`
  - Execute a DuckDB spatial SQL query and return a result summary or GeoJSON payload.
  - Parameters: `sql`, optional `resultFormat`.

- `add_geojson_layer`
  - Render a GeoJSON layer on the map.
  - Parameters: `layerId`, `geojson`, `colorBy`, optional `opacity`.

- `add_h3_layer`
  - Render an H3 hexagonal choropleth layer on the map.
  - Parameters: `layerId`, `geojson`, `colorBy`, optional `opacity`.

## JSON Schema requirements

The tool definitions use JSON Schema with clear descriptions and required fields.
This ensures the LLM can validate argument structure and return a strongly typed tool call.

Example structure for a tool invocation:

```json
{
  "type": "function",
  "function": {
    "name": "addH3Layer",
    "description": "Add a styled H3 hexagonal choropleth layer to the map.",
    "parameters": {
      "type": "object",
      "properties": {
        "layerId": { "type": "string" },
        "geojson": { "type": "string" },
        "colorBy": { "type": "string" },
        "opacity": { "type": "number" }
      },
      "required": ["layerId", "geojson", "colorBy"]
    }
  }
}
```

## Future alignment

- Add any new LLM-visible action to `src/utils/toolDefinitions.ts` first.
- Update `src/utils/openrouter.ts` to include the tool definitions in the LLM request payload.
- Keep `references/llm_tooling.md` in sync with the actual tool list.
- Prefer structured function calls over free-text prompt parsing whenever the provider supports it.

## Implementation notes

- `add_node` can reference the current spatial function catalogue via `operation`.
- `run_spatial_query` should be used for SQL-driven analysis pipelines.
- `add_geojson_layer` and `add_h3_layer` are map rendering helpers that can be added once map layer code is available.

## Guiding principle

Always keep the prompt and tool schema in sync with actual application capabilities.
When a tool changes shape, update the schema, the prompt, and this document together.
