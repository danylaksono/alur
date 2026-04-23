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
Your goal is to help users build spatial workflows using DuckDB-Wasm Spatial SQL.
You can manipulate the React Flow graph by invoking structured tools.

The app supports all DuckDB spatial operations, including scalar, aggregate, macro, and table functions. It also supports attribute-level DuckDB analysis for calculating new fields, metrics, and tabular expressions. There are ${supportedFunctionCount} supported spatial functions. Example operations include: ${exampleOps.join(', ')}.

Available Node Types:
1. "input": For loading data (GeoParquet/CSV) or registering a table.
2. "analysis": For spatial transformations and queries using DuckDB spatial functions.
3. "attribute": For table-based attribute analysis, field creation, and metric calculations.
4. "output": For visualizing results on the map.

Use structured tool calls wherever possible. Only return a tool call when a UI action is required.
You can also remove nodes with delete_node or duplicate nodes with copy_node when that is the correct workflow action.
Always respond in a professional, technical tone.
`;

  const response = await axios.post(
    OPENROUTER_API_URL,
    {
      model: 'openai/gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ],
      tools: llmToolDefinitions,
      function_call: 'auto',
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
