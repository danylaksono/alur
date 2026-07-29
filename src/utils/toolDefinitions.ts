export const llmToolDefinitions = [
  {
    name: 'add_node',
    description: 'Add a new node to the visual analysis workflow graph.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the node (optional).' },
        type: {
          type: 'string',
          enum: ['input', 'analysis', 'attribute', 'aggregate', 'allocate', 'score', 'filter', 'join', 'visualisation', 'output'],
          description: 'The type of node to create. "join" joins two inputs (A=left keeps geometry, B=right attributes get an r_ prefix); connect A to input-0 and B to input-1. "aggregate" summarises numbers by group (mode="summary") or dissolves geometry (mode="spatial"). "allocate" works down rows in priority order spending a budget or capacity until a limit is reached. "score" combines several columns into one weighted score and ranks by it.'
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
            groupBy: { type: 'string', description: 'For aggregate nodes: the column to group by. Omit to collapse the whole table to one row.' },
            measures: {
              type: 'array',
              description: 'For aggregate nodes with mode="summary": what to compute per group.',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  fn: { type: 'string', enum: ['count', 'count_distinct', 'sum', 'avg', 'median', 'min', 'max'] },
                  field: { type: 'string', description: 'The column to aggregate. Not needed for "count", which counts rows.' },
                  alias: { type: 'string', description: 'Output column name. Derived from the function and column when omitted.' },
                },
                required: ['fn'],
              },
            },
            includeGeometry: { type: 'boolean', description: 'For aggregate nodes with mode="summary" and a group column: merge each group\'s geometry so the summary can still be mapped.' },
            scoreModel: {
              type: 'object',
              description: 'For score nodes: the weighted criteria. Each column is normalised across the whole result before weighting, so columns on different scales combine safely.',
              properties: {
                criteria: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      field: { type: 'string', description: 'The numeric column.' },
                      weight: { type: 'number', description: 'Relative importance. Weights are shares of their total, so they need not sum to 1.' },
                      direction: { type: 'string', enum: ['higher', 'lower'], description: 'Whether a higher or lower value is better.' },
                      normalisation: { type: 'string', enum: ['min-max', 'z-score', 'rank'], description: 'How the column is put on a common scale.' },
                    },
                    required: ['field', 'weight', 'direction', 'normalisation'],
                  },
                },
                missingValueTreatment: { type: 'string', enum: ['zero', 'mean', 'exclude'], description: 'What a missing value contributes. "exclude" leaves the whole row unscored.' },
              },
              required: ['criteria', 'missingValueTreatment'],
            },
            includeContributions: { type: 'boolean', description: 'For score nodes: keep a column per criterion showing what it contributed. Defaults to true.' },
            orderBy: { type: 'string', description: 'For allocate nodes: the column deciding who is served first (usually a score).' },
            amountField: { type: 'string', description: 'For allocate nodes: the column being consumed, such as cost or capacity.' },
            limit: { type: 'number', description: 'For allocate nodes: how much there is to go round.' },
            partitionBy: { type: 'string', description: 'For allocate nodes: give each value of this column its own limit instead of sharing one.' },
            count: { type: 'number', description: 'For filter nodes with mode="top-n": how many rows to keep. Ties are kept together.' },
            direction: { type: 'string', enum: ['desc', 'asc'], description: 'For allocate and top-n filter nodes: desc serves the highest values first.' },
            condition: { type: 'string', description: 'For filter nodes with mode="condition": the SQL WHERE condition (e.g. need > 10).' },
            mode: {
              type: 'string',
              enum: ['spatial', 'attribute', 'summary', 'condition', 'top-n', 'flag', 'cut', 'scale'],
              description: 'Join: "spatial" or "attribute". Aggregate: "summary" (numbers) or "spatial" (dissolve geometry). Filter: "condition" or "top-n". Allocate: "flag" keeps every row and marks where the limit hit, "cut" drops rows past it, "scale" gives the straddling row a partial share.',
            },
            joinType: { type: 'string', enum: ['left', 'inner'], description: 'For join nodes: left join keeps unmatched A rows.' },
            predicate: { type: 'string', enum: ['ST_Intersects', 'ST_Within', 'ST_Contains', 'ST_DWithin'], description: 'For spatial join nodes: the predicate.' },
            leftKey: { type: 'string', description: 'For attribute join nodes: key column on input A.' },
            rightKey: { type: 'string', description: 'For attribute join nodes: key column on input B.' },
            kind: { type: 'string', enum: ['choropleth', 'categorical', 'graduated_symbol', 'heatmap', 'label', 'dot_density'], description: 'For visualisation nodes: style type.' },
            field: { type: 'string', description: 'For visualisation nodes: field to style by.' },
            method: { type: 'string', enum: ['quantile', 'equal_interval'], description: 'For choropleth visualisation nodes: classification method.' },
            classCount: { type: 'number', description: 'For choropleth visualisation nodes: number of classes.' },
            paletteId: { type: 'string', enum: ['teal', 'magma', 'forest', 'civic'], description: 'For visualisation nodes: palette id.' },
            outputMode: { type: 'string', enum: ['visualize', 'export'], description: 'For output nodes: visualize to map or export to a file.' },
            exportFormat: { type: 'string', enum: ['geojson', 'csv', 'json', 'parquet'], description: 'For export output nodes: file format.' },
            maxFeatures: { type: 'number', description: 'For output nodes: maximum features to preview or export.' }
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
    description: 'Execute a DuckDB SQL query, including spatial SQL when required.',
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
  },
  {
    name: 'add_visualisation_node',
    description: 'Add a workflow visualisation node that passes data through and attaches a reusable map style recipe for downstream output nodes.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the node (optional).' },
        label: { type: 'string', description: 'Human-readable node label.' },
        source_id: { type: 'string', description: 'Optional source node ID to connect from.' },
        target_id: { type: 'string', description: 'Optional target output node ID to connect to.' },
        position: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' }
          }
        },
        kind: {
          type: 'string',
          enum: ['choropleth', 'categorical', 'graduated_symbol', 'heatmap', 'label', 'dot_density'],
          description: 'Visualisation type.'
        },
        field: { type: 'string', description: 'Attribute field used for styling.' },
        method: {
          type: 'string',
          enum: ['quantile', 'equal_interval'],
          description: 'Classification method for choropleths.'
        },
        classCount: { type: 'number', description: 'Class count for choropleths.' },
        paletteId: {
          type: 'string',
          enum: ['teal', 'magma', 'forest', 'civic'],
          description: 'Palette id.'
        }
      },
      required: ['kind']
    }
  },
  {
    name: 'style_layer',
    description: 'Apply a MapLibre-backed visual style to an existing map layer, such as a choropleth or category map.',
    parameters: {
      type: 'object',
      properties: {
        layerId: { type: 'string', description: 'The layer ID to style. If omitted, the selected layer is used.' },
        kind: {
          type: 'string',
          enum: ['choropleth', 'categorical', 'graduated_symbol', 'heatmap', 'label', 'dot_density'],
          description: 'The visualisation type to apply.'
        },
        field: { type: 'string', description: 'The attribute field used for classification or categories.' },
        method: {
          type: 'string',
          enum: ['quantile', 'equal_interval'],
          description: 'Classification method for numeric choropleths.'
        },
        classCount: { type: 'number', description: 'Number of classes for numeric choropleths.' },
        palette: {
          type: 'string',
          enum: ['teal', 'magma', 'forest', 'civic'],
          description: 'Sequential palette for numeric choropleths.'
        },
        topN: { type: 'number', description: 'Number of top categories to colour before using Other.' }
      },
      required: ['field']
    }
  },
  {
    name: 'filter_layer_rows',
    description: 'Filter the selected layer and its attribute table by a categorical value or numeric range. Filters remain synchronized between table, charts, and map.',
    parameters: {
      type: 'object',
      properties: {
        layerId: { type: 'string', description: 'Target layer ID. If omitted, use the selected layer.' },
        field: { type: 'string', description: 'Field to filter.' },
        kind: { type: 'string', enum: ['category', 'range'], description: 'Filter kind.' },
        values: { type: 'array', items: { type: 'string' }, description: 'Accepted values for a category filter.' },
        min: { type: 'number', description: 'Inclusive numeric minimum.' },
        max: { type: 'number', description: 'Inclusive numeric maximum.' },
        mode: { type: 'string', enum: ['add', 'replace'], description: 'Add to current filters or replace them. Defaults to add.' }
      },
      required: ['field', 'kind']
    }
  },
  {
    name: 'select_layer_features',
    description: 'Select one or more map/table rows by their feature IDs. Supports replacing, adding, or removing from the current multi-selection.',
    parameters: {
      type: 'object',
      properties: {
        layerId: { type: 'string', description: 'Target layer ID. If omitted, use the selected layer.' },
        featureIds: { type: 'array', items: { type: 'string' }, description: 'Feature IDs to select.' },
        mode: { type: 'string', enum: ['replace', 'add', 'remove'], description: 'Selection update mode. Defaults to replace.' }
      },
      required: ['featureIds']
    }
  },
  {
    name: 'clear_layer_filters',
    description: 'Clear all active filters from a map layer and its attribute table.',
    parameters: {
      type: 'object',
      properties: {
        layerId: { type: 'string', description: 'Target layer ID. If omitted, use the selected layer.' }
      }
    }
  },
  {
    name: 'clear_layer_selection',
    description: 'Clear selected rows/features from a map layer and its attribute table.',
    parameters: {
      type: 'object',
      properties: {
        layerId: { type: 'string', description: 'Target layer ID. If omitted, use the selected layer.' }
      }
    }
  },
  {
    name: 'zoom_to_selection',
    description: 'Zoom the map to the currently selected table rows/features for a layer.',
    parameters: {
      type: 'object',
      properties: {
        layerId: { type: 'string', description: 'Target layer ID. If omitted, use the selected layer.' }
      }
    }
  }
];
