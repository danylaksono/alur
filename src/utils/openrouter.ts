import axios from 'axios';
import { llmToolDefinitions } from './toolDefinitions';
import { useStore } from '../store/useStore';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_KEY_URL = 'https://openrouter.ai/api/v1/key';

/** Thrown when the user has not configured an OpenRouter API key yet. */
export class OpenRouterConfigError extends Error {
  constructor() {
    super('No OpenRouter API key configured. Open Settings to add one.');
    this.name = 'OpenRouterConfigError';
  }
}

export const testOpenRouterConnection = async (apiKey: string): Promise<boolean> => {
  if (!apiKey) return false;
  try {
    // GET /key returns the key's metadata; an invalid key returns 401.
    const response = await axios.get(OPENROUTER_KEY_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return response.status === 200;
  } catch {
    return false;
  }
};

export const callOpenRouter = async (messages: any[]) => {
  const { openRouterApiKey, openRouterModelId } = useStore.getState().settings;
  if (!openRouterApiKey) {
    throw new OpenRouterConfigError();
  }

  const systemPrompt = `
You are an expert GIS AI Assistant for "YMNNGIS - You Might Not Need A Desktop GIS".
Your goal is to help users build complex spatial workflows using DuckDB-Wasm Spatial SQL.

### CAPABILITIES
1. **DAG Workflow Construction**: You can build multi-node workflows. Use "input" for data, "analysis" for spatial ops, "aggregate" for summaries, "attribute" for field calcs, and "output" for maps.
2. **Spatial Logic**: You understand spatial relationships (joins, intersections, buffers, transforms).
3. **Multi-Input Operations**: For operations requiring two inputs (e.g., ST_Intersection), you MUST connect two source nodes to the target analysis node using "connect_nodes" with "target_handle" set to "input-0" (Source A) and "input-1" (Source B).
4. **Self-Correction**: If a previous SQL execution failed (look for "SQL execution error" in history), analyze the error and propose a corrected node configuration or workflow.
5. **Table and Map Interaction**: You can filter layer rows, manage multi-row feature selections, clear selections, and zoom to selected features. Use these interaction tools for exploratory requests.

### GUIDELINES
- **Plan First**: Think step-by-step about the GIS workflow needed to solve the user's request.
- **Node IDs**: When adding nodes, use descriptive IDs like "roads_buffer" or "intersect_result".
- **Schema Awareness**: Pay attention to column names. Use the "Attribute Inspector" and "Output Schema" info provided in user messages if available.
- **Persistent vs Exploratory Work**: Use table/map interaction tools for temporary exploration. For reproducible transformations, create workflow filter and attribute nodes instead.
- **Tone**: Professional, technical, and helpful.

### NODE TYPES
- "input": Load data. Requires "tableName" and "fileName".
- "analysis": Spatial operations (ST_Buffer, ST_Intersection, ST_Transform, etc.).
- "aggregate": Spatial aggregations (ST_Union_Agg, ST_Envelope_Agg). Supports "groupBy".
- "filter": Filter rows using SQL. Requires "condition" (e.g., "need > 10").
- "join": Join two inputs. A (input-0) keeps its rows and geometry; B's (input-1) attributes are appended with an "r_" prefix. Config: mode ("spatial" with predicate ST_Intersects/ST_Within/ST_Contains/ST_DWithin + distance, or "attribute" with leftKey/rightKey), joinType ("left"|"inner").
- "attribute": Column calculations. Requires "expression" and "resultField".
- "output": Mark the final result. Use config.outputMode="visualize" to add it to the map, or config.outputMode="export" with exportFormat ("geojson", "csv", "json", "parquet") to download it.

Use structured tool calls. Only return a tool call when a UI action is required.
`;

  const response = await axios.post(
    OPENROUTER_API_URL,
    {
      model: openRouterModelId || 'openai/gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ],
      tools: llmToolDefinitions.map((fn) => ({
        type: 'function',
        function: fn,
      })),
      tool_choice: 'auto',
    },
    {
      headers: {
        'Authorization': `Bearer ${openRouterApiKey}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return response.data.choices[0].message;
};
