import { spatialFunctions } from './spatialFunctions';

export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

const operationNames = spatialFunctions.map((fn) => fn.name);

export const llmToolDefinitions: LLMToolDefinition[] = [
  {
    name: 'add_node',
    description: 'Add a new workflow node to the React Flow graph. Use this for input, analysis, or output nodes.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Optional unique node id. If omitted, the client will generate one.',
        },
        type: {
          type: 'string',
          enum: ['input', 'analysis', 'attribute', 'output'],
          description: 'The node type to add.',
        },
        label: {
          type: 'string',
          description: 'The visible label for the new node.',
        },
        config: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: operationNames,
              description: 'The spatial operation to perform in a spatial analysis node.',
            },
            distance: {
              type: 'number',
              description: 'Numeric distance or tolerance used by buffer, simplify, or other operations.',
            },
            sourceCrs: {
              type: 'string',
              description: 'Source CRS for ST_Transform.',
            },
            targetCrs: {
              type: 'string',
              description: 'Target CRS for ST_Transform.',
            },
            expression: {
              type: 'string',
              description: 'A DuckDB expression used to calculate a new attribute value for each row.',
            },
            resultField: {
              type: 'string',
              description: 'The name of the computed field created by attribute analysis.',
            },
            sourceTable: {
              type: 'string',
              description: 'Optional source table or CTE name used by attribute analysis.',
            },
            query: {
              type: 'string',
              description: 'Optional DuckDB SQL query or expression that generates the node source.',
            },
          },
          additionalProperties: true,
        },
        position: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
          },
          description: 'Optional screen coordinates for placing the node.',
        },
      },
      required: ['type', 'label'],
    },
  },
  {
    name: 'connect_nodes',
    description: 'Connect two workflow nodes by their node ids.',
    parameters: {
      type: 'object',
      properties: {
        source_id: {
          type: 'string',
          description: 'The id of the source node.',
        },
        target_id: {
          type: 'string',
          description: 'The id of the target node.',
        },
      },
      required: ['source_id', 'target_id'],
    },
  },
  {
    name: 'update_node',
    description: 'Update an existing node configuration, such as buffer distance, operation, or CRS parameters.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The node id to update.',
        },
        config: {
          type: 'object',
          description: 'The partial node config object to merge into the existing node.',
          additionalProperties: true,
        },
      },
      required: ['id', 'config'],
    },
  },
  {
    name: 'delete_node',
    description: 'Remove a node and its connected edges from the workflow graph.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The node id to delete.',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'copy_node',
    description: 'Duplicate an existing workflow node. The new node will retain the source node type and config.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The id of the node to copy.',
        },
        new_id: {
          type: 'string',
          description: 'Optional id for the duplicated node.',
        },
        position: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
          },
          description: 'Optional absolute position for the duplicated node.',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'run_sql_query',
    description: 'Run a DuckDB SQL query and return a result summary, table payload, or GeoJSON output. Use this for spatial or attribute queries.',
    parameters: {
      type: 'object',
      properties: {
        sql: {
          type: 'string',
          description: 'A DuckDB SQL statement to execute.',
        },
        resultFormat: {
          type: 'string',
          enum: ['geojson', 'table', 'text'],
          description: 'The desired response format for the query results.',
        },
      },
      required: ['sql'],
    },
  },
  {
    name: 'run_spatial_query',
    description: 'Run a DuckDB spatial SQL query and return a result summary or GeoJSON payload.',
    parameters: {
      type: 'object',
      properties: {
        sql: {
          type: 'string',
          description: 'A DuckDB spatial SQL statement to execute.',
        },
        resultFormat: {
          type: 'string',
          enum: ['geojson', 'table', 'text'],
          description: 'The desired response format for the query results.',
        },
      },
      required: ['sql'],
    },
  },
  {
    name: 'add_geojson_layer',
    description: 'Add or update a GeoJSON map layer on the visualization pane.',
    parameters: {
      type: 'object',
      properties: {
        layerId: {
          type: 'string',
          description: 'Unique layer ID, e.g. "energy-demand-layer".',
        },
        geojson: {
          type: 'string',
          description: 'Stringified GeoJSON FeatureCollection.',
        },
        colorBy: {
          type: 'string',
          description: 'Metric column to color by, e.g. "avg_energy_demand_kwh".',
        },
        opacity: {
          type: 'number',
          description: 'Layer opacity between 0.3 and 0.9.',
        },
      },
      required: ['layerId', 'geojson', 'colorBy'],
    },
  },
  {
    name: 'add_h3_layer',
    description: 'Add a styled H3 hexagonal choropleth layer to the map. Use this after run_spatial_query and color by a chosen metric.',
    parameters: {
      type: 'object',
      properties: {
        layerId: {
          type: 'string',
          description: 'Unique layer ID, e.g. "energy-demand-hex".',
        },
        geojson: {
          type: 'string',
          description: 'Stringified GeoJSON FeatureCollection containing H3 hex geometries.',
        },
        colorBy: {
          type: 'string',
          description: 'Metric column used for the choropleth color ramp.',
        },
        opacity: {
          type: 'number',
          description: 'Layer opacity between 0.3 and 0.9.',
        },
      },
      required: ['layerId', 'geojson', 'colorBy'],
    },
  },
];
