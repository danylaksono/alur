export const llmToolDefinitions = [
  {
    name: 'add_node',
    description: 'Add a new node to the spatial workflow graph.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the node (optional).' },
        type: { 
          type: 'string', 
          enum: ['input', 'analysis', 'attribute', 'aggregate', 'filter', 'output'],
          description: 'The type of node to create.' 
        },
        label: { type: 'string', description: 'Human-readable label for the node.' },
        position: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' }
          },
          description: 'The canvas position for the node.'
        },
        config: {
          type: 'object',
          description: 'Configuration for the node (e.g., operation name, distance, expression, groupBy, condition).',
          properties: {
            tableName: { type: 'string', description: 'For input nodes: the name of the table to load.' },
            operation: { type: 'string', description: 'For analysis/aggregate nodes: the function name (e.g., ST_Buffer, ST_Union_Agg).' },
            distance: { type: 'number', description: 'For ST_Buffer: the buffer distance.' },
            expression: { type: 'string', description: 'For attribute nodes: the SQL expression.' },
            resultField: { type: 'string', description: 'For attribute nodes: the name of the new field.' },
            groupBy: { type: 'string', description: 'For aggregate nodes: the column name to group by.' },
            condition: { type: 'string', description: 'For filter nodes: the SQL WHERE condition (e.g. need > 10).' }
          }
        }
      },
      required: ['type']
    }
  },
  {
    name: 'connect_nodes',
    description: 'Create a connection (edge) between two nodes. For multi-input nodes, specify target_handle as "input-0" (Source A) or "input-1" (Source B).',
    parameters: {
      type: 'object',
      properties: {
        source_id: { type: 'string', description: 'The ID of the source node.' },
        target_id: { type: 'string', description: 'The ID of the target node.' },
        target_handle: { type: 'string', description: 'The specific input handle ID (e.g., "input-0", "input-1").' }
      },
      required: ['source_id', 'target_id']
    }
  },
  {
    name: 'update_node',
    description: 'Update the configuration of an existing node.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The ID of the node to update.' },
        config: { type: 'object', description: 'The new configuration object.' }
      },
      required: ['id', 'config']
    }
  },
  {
    name: 'delete_node',
    description: 'Remove a node from the workflow graph.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The ID of the node to delete.' }
      },
      required: ['id']
    }
  },
  {
    name: 'copy_node',
    description: 'Duplicate an existing node.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The ID of the node to duplicate.' },
        new_id: { type: 'string', description: 'The ID for the new node (optional).' },
        position: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' }
          },
          description: 'Position for the new node (optional).'
        }
      },
      required: ['id']
    }
  },
  {
    name: 'run_spatial_query',
    description: 'Execute a raw spatial SQL query against DuckDB.',
    parameters: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'The DuckDB Spatial SQL query to run.' },
        resultFormat: { 
          type: 'string', 
          enum: ['table', 'geojson', 'text'], 
          description: 'Preferred format for the output.' 
        }
      },
      required: ['sql']
    }
  }
];
