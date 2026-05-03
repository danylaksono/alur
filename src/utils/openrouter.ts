import axios from 'axios';
import { spatialFunctions } from './spatialFunctions';
import { llmToolDefinitions } from './toolDefinitions';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

export const callOpenRouter = async (messages: any[]) => {
  const apiKey = (import.meta as any).env?.VITE_OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('VITE_OPENROUTER_API_KEY is not set');
  }

  const exampleOps = ['ST_Buffer', 'ST_Intersection', 'ST_Centroid', 'ST_Difference', 'ST_Transform', 'ST_Union'];
  const supportedFunctionCount = spatialFunctions.length;

  const systemPrompt = `
You are an expert GIS AI Assistant for "GeoModeler Pro".
Your goal is to help users build complex spatial workflows using DuckDB-Wasm Spatial SQL.

### CAPABILITIES
1. **DAG Workflow Construction**: You can build multi-node workflows. Use "input" for data, "analysis" for spatial ops, "aggregate" for summaries, "attribute" for field calcs, and "output" for maps.
2. **Spatial Logic**: You understand spatial relationships (joins, intersections, buffers, transforms).
3. **Multi-Input Operations**: For operations requiring two inputs (e.g., ST_Intersection), you MUST connect two source nodes to the target analysis node using "connect_nodes" with "target_handle" set to "input-0" (Source A) and "input-1" (Source B).
4. **Self-Correction**: If a previous SQL execution failed (look for "SQL execution error" in history), analyze the error and propose a corrected node configuration or workflow.

### GUIDELINES
- **Plan First**: Think step-by-step about the GIS workflow needed to solve the user's request.
- **Node IDs**: When adding nodes, use descriptive IDs like "london_buffer" or "intersect_result".
- **Schema Awareness**: Pay attention to column names. Use the "Attribute Inspector" and "Output Schema" info provided in user messages if available.
- **Tone**: Professional, technical, and helpful.

### NODE TYPES
- "input": Load data. Requires "tableName" and "fileName".
- "analysis": Spatial operations (ST_Buffer, ST_Intersection, ST_Transform, etc.).
- "aggregate": Spatial aggregations (ST_Union_Agg, ST_Envelope_Agg). Supports "groupBy".
- "filter": Filter rows using SQL. Requires "condition" (e.g., "need > 10").
- "attribute": Column calculations. Requires "expression" and "resultField".
- "output": Mark the final result for map visualization.

Use structured tool calls. Only return a tool call when a UI action is required.
`;

  const response = await axios.post(
    OPENROUTER_API_URL,
    {
      model: 'openai/gpt-4o-mini',
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
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/danylaksono/ymnngis',
        'X-Title': 'GeoModeler Pro',
        'Content-Type': 'application/json',
      },
    }
  );

  return response.data.choices[0].message;
};
