import { useState, useRef, useEffect } from 'react';
import { ArrowRight, KeyRound, Loader2, Sparkles, Zap } from 'lucide-react';
import { useStore } from '../store/useStore';
import { callOpenRouter, OpenRouterConfigError } from '../utils/openrouter';
import { duckdbService } from '../services/duckdb';
import { cn } from '../utils/cn';
import {
  buildCategoricalVisualisation,
  buildChoroplethVisualisation,
  buildGraduatedSymbolVisualisation,
  buildHeatmapVisualisation,
  buildLabelVisualisation,
  buildDotDensityVisualisation,
  buildLegend,
  profileGeoJsonField,
} from '../utils/classification';
import { getPalette } from '../utils/palettes';
import { queryLayerFieldProfile, queryLayerSelectionBounds } from '../services/visualAnalyticsService';
import type { VisualFilter } from '../types/visualAnalytics';

export const Chat = () => {
  const {
    chatMessages,
    addChatMessage,
    addNode,
    onConnect,
    updateNode,
    removeNode,
    duplicateNode,
    addMapLayer,
    updateLayerVisualisation,
    setLayerFilters,
    clearLayerFilters,
    setFeatureSelection,
    clearFeatureSelection,
    focusLayerBounds,
    mapLayers,
    selectedLayerId,
    nodeSchemas,
    visualAnalytics,
  } = useStore();
  const settings = useStore((s) => s.settings);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const hasApiKey = Boolean(settings.openRouterApiKey);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const handleSendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg = input;
    setInput('');
    addChatMessage('user', userMsg);

    setIsLoading(true);

    try {
      // Inject schema information into the context for the AI
      const contextMessages = [
        ...chatMessages,
        {
          role: 'system' as const,
          content: `Current workspace metadata: ${JSON.stringify({
            nodeSchemas,
            selectedLayerId,
            layers: mapLayers.map((layer) => ({
              id: layer.id,
              name: layer.name,
              fields: layer.source.fields.map((field) => field.name),
              selectedFeatureIds: visualAnalytics.layers[layer.id]?.selectedFeatureIds || [],
              filters: visualAnalytics.layers[layer.id]?.filters || [],
            })),
          })}`
        }
      ];

      const response = await callOpenRouter(contextMessages);

      // Handle both deprecated `function_call` and current `tool_calls` format
      const toolCall = response.tool_calls?.[0] || response.function_call;
      if (toolCall) {
        const toolName = toolCall.function?.name || toolCall.name;
        const rawArgs = toolCall.function?.arguments || toolCall.arguments;
        const args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;

        const argsSummary = JSON.stringify(args).slice(0, 300);
        addChatMessage('assistant', `Invoking tool: ${toolName}`, {
          kind: 'tool_call',
          toolName,
          summary: argsSummary,
        });

        switch (toolName) {
          case 'add_visualisation_node': {
            const nodeId = args.id || `visualisation-${Date.now()}`;
            const config = {
              kind: args.kind || 'choropleth',
              field: args.field || '',
              method: args.method || 'quantile',
              classCount: args.classCount || args.class_count || 5,
              paletteId: args.paletteId || args.palette || 'teal',
            };
            addNode({
              id: nodeId,
              type: 'visualisation',
              position: args.position || { x: 420, y: 180 },
              data: {
                label: args.label || 'Visualisation',
                type: 'visualisation',
                config,
              },
            });
            if (args.source_id) {
              onConnect({
                source: args.source_id,
                target: nodeId,
                targetHandle: 'input-0',
                type: 'smoothstep',
              } as any);
            }
            if (args.target_id) {
              onConnect({
                source: nodeId,
                target: args.target_id,
                targetHandle: 'input-0',
                type: 'smoothstep',
              } as any);
            }
            addChatMessage('assistant', `Added visualisation node (${nodeId})`, {
              kind: 'tool_result',
              summary: `${config.kind}${config.field ? ` · ${config.field}` : ''}`,
            });
            break;
          }
          case 'add_node': {
            const nodeId = args.id || `node-${Date.now()}`;
            addNode({
              id: nodeId,
              type: args.type,
              position: args.position || { x: 300, y: 150 },
              data: {
                label: args.label || (args.type === 'analysis' ? 'Spatial Op' : args.type === 'attribute' ? 'Attribute Op' : args.type === 'input' ? 'Data Source' : args.type === 'visualisation' ? 'Visualisation' : args.type === 'join' ? 'Join' : 'Map Output'),
                type: args.type,
                config: args.config || {},
              },
            });
            addChatMessage('assistant', `Tool executed: add_node (${nodeId})`, { kind: 'tool_result', summary: `Added ${args.type} node` });
            break;
          }
          case 'connect_nodes': {
            onConnect({
              source: args.source_id,
              target: args.target_id,
              targetHandle: args.target_handle || 'input-0',
              type: 'smoothstep'
            } as any);
            addChatMessage('assistant', `Connected ${args.source_id} → ${args.target_id}`, { kind: 'tool_result', summary: `Connected nodes` });
            break;
          }
          case 'update_node': {
            updateNode(args.id, args.config);
            addChatMessage('assistant', `Tool executed: update_node (${args.id})`, { kind: 'tool_result', summary: `Updated node config` });
            break;
          }
          case 'delete_node': {
            removeNode(args.id);
            addChatMessage('assistant', `Tool executed: delete_node (${args.id})`, { kind: 'tool_result', summary: `Deleted node` });
            break;
          }
          case 'copy_node': {
            const newNodeId = args.new_id || `node-${Date.now()}`;
            duplicateNode(args.id, newNodeId, args.position);
            addChatMessage('assistant', `Copied ${args.id} → ${newNodeId}`, { kind: 'tool_result', summary: `Duplicated node` });
            break;
          }
          case 'run_sql_query':
          case 'run_spatial_query': {
            const sql = args.sql;
            const resultFormat = args.resultFormat || 'text';
            try {
              const rows = resultFormat === 'geojson'
                ? await duckdbService.getGeoJSON(sql)
                : (await duckdbService.query(sql)).toArray?.().map((row: any) => (typeof row?.toJSON === 'function' ? row.toJSON() : row));
              const rowArray = Array.isArray(rows) ? rows : [];
              const summary = resultFormat === 'table'
                ? JSON.stringify(rowArray.slice(0, 20), null, 2)
                : rowArray.length > 0
                  ? rowArray.slice(0, 6).map((row: any) => JSON.stringify(row)).join('\n')
                  : 'No rows returned.';
              const rowCount = Array.isArray(rows) ? rows.length : 0;
              addChatMessage('assistant', `SQL returned ${rowCount} rows`, { kind: 'tool_result', summary });
            } catch (err: any) {
              addChatMessage('assistant', `SQL error: ${err.message || 'Unknown error'}`, { kind: 'tool_result', summary: 'Query failed' });
            }
            break;
          }
          case 'add_geojson_layer': {
            const layerName = args.name || 'LLM Layer';
            const geojson = args.geojson || args.data;
            if (!geojson) {
              addChatMessage('assistant', 'No GeoJSON data provided. Include a "geojson" or "data" field.');
              break;
            }
            const fc: GeoJSON.FeatureCollection = typeof geojson === 'string' ? JSON.parse(geojson) : geojson;
            addMapLayer({
              id: `llm-layer-${Date.now()}`,
              name: layerName,
              geojson: fc,
              sourceKind: 'llm',
            });
            addChatMessage('assistant', `Added "${layerName}" to the map`, { kind: 'tool_result', summary: `${fc.features.length} features added to map` });
            break;
          }
          case 'add_h3_layer': {
            const h3SourceTable = args.tableName;
            const h3Resolution = args.resolution ?? 8;
            const h3LayerName = args.name || 'H3 Hex Grid';
            if (!h3SourceTable) {
              addChatMessage('assistant', 'Please specify a "tableName" with latitude/longitude columns.');
              break;
            }
            try {
              if (!duckdbService.isH3Loaded) {
                addChatMessage('assistant', 'H3 extension unavailable. Try add_geojson_layer instead.');
                break;
              }
              const h3Sql = `
                WITH h3_cells AS (
                  SELECT h3_latlng_to_cell(latitude, longitude, ${h3Resolution}) AS cell,
                         COUNT(*) AS point_count
                  FROM "${h3SourceTable}"
                  WHERE latitude IS NOT NULL AND longitude IS NOT NULL
                  GROUP BY cell
                )
                SELECT cell, point_count,
                       ST_AsGeoJSON(ST_GeomFromText(h3_cell_to_boundary_wkt(cell))) AS geojson
                FROM h3_cells
              `;
              const fc = await duckdbService.getGeoJSON(h3Sql);
              if (!fc || fc.features.length === 0) {
                addChatMessage('assistant', 'H3 grid produced no results.');
                break;
              }
              addMapLayer({
                id: `h3-layer-${Date.now()}`,
                name: h3LayerName,
                geojson: fc,
                sourceKind: 'h3',
              });
              addChatMessage('assistant', `Added H3 grid "${h3LayerName}"`, { kind: 'tool_result', summary: `${fc.features.length} hex cells at res ${h3Resolution}` });
            } catch (err: any) {
              addChatMessage('assistant', `H3 error: ${err.message}`, { kind: 'tool_result', summary: 'H3 failed' });
            }
            break;
          }
          case 'style_layer': {
            const layerId = args.layerId || args.layer_id || selectedLayerId;
            const layer = mapLayers.find((item) => item.id === layerId);
            if (!layer) {
              addChatMessage('assistant', 'No target layer found for styling.', { kind: 'tool_result', summary: 'Style failed' });
              break;
            }

            const field = args.field;
            if (!field) {
              addChatMessage('assistant', 'No field provided for layer styling.', { kind: 'tool_result', summary: 'Style failed' });
              break;
            }

            const profile = layer.geojson
              ? profileGeoJsonField(layer.geojson.features, field)
              : await queryLayerFieldProfile({ layer, column: field });
            const kind = args.kind || args.type || (profile.kind === 'numeric' ? 'choropleth' : 'categorical');

            if (kind === 'choropleth' && profile.kind === 'numeric') {
              const visualisation = buildChoroplethVisualisation({
                field,
                profile,
                method: args.method || 'quantile',
                classCount: args.classCount || args.class_count || 5,
                palette: getPalette(args.palette || 'teal').colors,
              });
              updateLayerVisualisation(layer.id, visualisation, buildLegend(visualisation));
              addChatMessage('assistant', `Styled "${layer.name}" as a choropleth`, { kind: 'tool_result', summary: `${field} · ${visualisation.method}` });
              break;
            }

            if (kind === 'categorical' && profile.kind === 'categorical') {
              const visualisation = buildCategoricalVisualisation({
                field,
                profile,
                topN: args.topN || args.top_n || 8,
              });
              updateLayerVisualisation(layer.id, visualisation, buildLegend(visualisation));
              addChatMessage('assistant', `Styled "${layer.name}" by category`, { kind: 'tool_result', summary: `${field} · categories` });
              break;
            }

            if (kind === 'graduated_symbol' && profile.kind === 'numeric') {
              const visualisation = buildGraduatedSymbolVisualisation({ field, profile });
              updateLayerVisualisation(layer.id, visualisation, buildLegend(visualisation));
              addChatMessage('assistant', `Styled "${layer.name}" with graduated symbols`, { kind: 'tool_result', summary: `${field} · symbols` });
              break;
            }

            if (kind === 'heatmap') {
              const visualisation = buildHeatmapVisualisation({
                field: profile?.kind === 'numeric' ? field : undefined,
                palette: getPalette(args.palette || 'teal').colors,
              });
              updateLayerVisualisation(layer.id, visualisation, buildLegend(visualisation));
              addChatMessage('assistant', `Styled "${layer.name}" as a heatmap`, { kind: 'tool_result', summary: `heatmap` });
              break;
            }

            if (kind === 'label') {
              const visualisation = buildLabelVisualisation({ field });
              updateLayerVisualisation(layer.id, visualisation, buildLegend(visualisation));
              addChatMessage('assistant', `Added labels to "${layer.name}"`, { kind: 'tool_result', summary: `${field} · labels` });
              break;
            }

            if (kind === 'dot_density' && profile.kind === 'numeric') {
              const visualisation = buildDotDensityVisualisation({ field });
              updateLayerVisualisation(layer.id, visualisation, buildLegend(visualisation));
              addChatMessage('assistant', `Applied dot density to "${layer.name}"`, { kind: 'tool_result', summary: `${field} · dots` });
              break;
            }

            addChatMessage('assistant', `Field "${field}" is not compatible with ${kind}.`, { kind: 'tool_result', summary: 'Style failed' });
            break;
          }
          case 'filter_layer_rows': {
            const layerId = args.layerId || args.layer_id || selectedLayerId;
            const layer = mapLayers.find((item) => item.id === layerId);
            if (!layer) {
              addChatMessage('assistant', 'No target layer found for filtering.', { kind: 'tool_result', summary: 'Filter failed' });
              break;
            }
            if (args.kind === 'category' && !(args.values || []).length) {
              addChatMessage('assistant', 'A category filter needs at least one value.', { kind: 'tool_result', summary: 'Filter skipped' });
              break;
            }
            if (args.kind === 'range' && args.min === undefined && args.max === undefined) {
              addChatMessage('assistant', 'A range filter needs a minimum or maximum.', { kind: 'tool_result', summary: 'Filter skipped' });
              break;
            }
            const filter: VisualFilter = args.kind === 'range'
              ? { kind: 'range', field: args.field, min: args.min, max: args.max }
              : { kind: 'category', field: args.field, values: (args.values || []).map(String) };
            const current = visualAnalytics.layers[layer.id]?.filters || [];
            setLayerFilters(layer.id, args.mode === 'replace' ? [filter] : [...current, filter]);
            addChatMessage('assistant', `Filtered "${layer.name}" by ${args.field}.`, { kind: 'tool_result', summary: `${args.kind} filter applied` });
            break;
          }
          case 'select_layer_features': {
            const layerId = args.layerId || args.layer_id || selectedLayerId;
            const layer = mapLayers.find((item) => item.id === layerId);
            if (!layer) {
              addChatMessage('assistant', 'No target layer found for selection.', { kind: 'tool_result', summary: 'Selection failed' });
              break;
            }
            const requested = (args.featureIds || args.feature_ids || []).map(String);
            const current = visualAnalytics.layers[layer.id]?.selectedFeatureIds || [];
            const next = args.mode === 'add'
              ? [...new Set([...current, ...requested])]
              : args.mode === 'remove'
                ? current.filter((id) => !requested.includes(id))
                : requested;
            setFeatureSelection(layer.id, next);
            addChatMessage('assistant', `Selected ${next.length} feature${next.length === 1 ? '' : 's'} in "${layer.name}".`, { kind: 'tool_result', summary: `${next.length} selected` });
            break;
          }
          case 'clear_layer_filters': {
            const layerId = args.layerId || args.layer_id || selectedLayerId;
            if (!layerId || !mapLayers.some((item) => item.id === layerId)) {
              addChatMessage('assistant', 'No target layer found for filtering.', { kind: 'tool_result', summary: 'Clear failed' });
              break;
            }
            clearLayerFilters(layerId);
            addChatMessage('assistant', 'Cleared the layer filters.', { kind: 'tool_result', summary: 'Filters cleared' });
            break;
          }
          case 'clear_layer_selection': {
            const layerId = args.layerId || args.layer_id || selectedLayerId;
            if (!layerId || !mapLayers.some((item) => item.id === layerId)) {
              addChatMessage('assistant', 'No target layer found for selection.', { kind: 'tool_result', summary: 'Clear failed' });
              break;
            }
            clearFeatureSelection(layerId);
            addChatMessage('assistant', 'Cleared the layer selection.', { kind: 'tool_result', summary: 'Selection cleared' });
            break;
          }
          case 'zoom_to_selection': {
            const layerId = args.layerId || args.layer_id || selectedLayerId;
            const layer = mapLayers.find((item) => item.id === layerId);
            const featureIds = layer ? visualAnalytics.layers[layer.id]?.selectedFeatureIds || [] : [];
            if (!layer || !featureIds.length) {
              addChatMessage('assistant', 'Select at least one feature before zooming.', { kind: 'tool_result', summary: 'Zoom skipped' });
              break;
            }
            const bounds = await queryLayerSelectionBounds(layer, featureIds);
            if (!bounds) {
              addChatMessage('assistant', 'The selected features do not have zoomable geometry.', { kind: 'tool_result', summary: 'Zoom failed' });
              break;
            }
            focusLayerBounds(layer.id, bounds);
            addChatMessage('assistant', `Zoomed to ${featureIds.length} selected feature${featureIds.length === 1 ? '' : 's'}.`, { kind: 'tool_result', summary: 'Map focused on selection' });
            break;
          }
          default: {
            addChatMessage('assistant', `Unsupported tool: ${toolName}`);
          }
        }
      } else {
        addChatMessage('assistant', response.content || 'No assistant content returned.');
      }
    } catch (err: any) {
      if (err instanceof OpenRouterConfigError) {
        addChatMessage('system', err.message);
        setSettingsOpen(true);
      } else {
        addChatMessage('system', `Error: ${err.message || 'Failed to reach AI agent'}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="p-3 border-b bg-muted/20 flex items-center justify-between shrink-0">
        <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-primary" /> ALUR Copilot
        </h3>
        {hasApiKey && (
          <span className="max-w-40 truncate text-[11px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-semibold" title={settings.openRouterModelId}>
            {settings.openRouterModelId}
          </span>
        )}
      </div>

      {!hasApiKey ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <div className="rounded-full bg-primary/10 p-3">
            <KeyRound className="h-5 w-5 text-primary" />
          </div>
          <p className="text-xs font-semibold text-slate-700">Bring your own key</p>
          <p className="max-w-64 text-[11px] leading-relaxed text-slate-500">
            The copilot needs an OpenRouter API key. It is stored only in this browser and calls
            OpenRouter directly — no middleman server.
          </p>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-700"
          >
            Configure OpenRouter key
          </button>
        </div>
      ) : (
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth"
      >
        {chatMessages.map((msg, i) => {
          if (msg.kind === 'tool_call') {
            return (
              <div key={i} className="mr-6 rounded-xl border border-teal-100 bg-teal-50 p-3">
                <div className="flex items-center gap-2 mb-1">
                  <div className="flex h-5 w-5 items-center justify-center rounded bg-teal-200">
                    <Zap className="h-3 w-3 text-teal-700" />
                  </div>
                  <span className="text-[11px] font-bold uppercase tracking-wide text-teal-700">
                    {msg.data?.toolName || 'Tool Call'}
                  </span>
                </div>
                <div className="mt-1 max-h-20 overflow-y-auto break-all rounded bg-teal-100/60 p-2 font-mono text-[11px] text-teal-950">
                  {msg.data?.summary || msg.content}
                </div>
              </div>
            );
          }

          if (msg.kind === 'tool_result') {
            return (
              <div key={i} className="bg-emerald-50 mr-6 p-2 rounded-xl border border-emerald-100">
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span className="text-[11px] text-emerald-700 font-semibold uppercase tracking-wide">
                    {msg.data?.summary || msg.content}
                  </span>
                </div>
              </div>
            );
          }

          return (
            <div
              key={i}
              className={cn(
                "p-3 rounded-xl text-[11px] leading-relaxed border",
                msg.role === 'user' ? "bg-muted/50 ml-6 border-transparent" :
                  msg.role === 'system' ? "bg-amber-50 text-amber-800 border-amber-100 font-mono" :
                    "bg-primary/5 mr-6 border-primary/10 text-foreground"
              )}
            >
              {msg.role === 'assistant' && <div className="font-bold text-[11px] text-primary uppercase mb-1">Copilot</div>}
              {msg.role === 'user' && <div className="font-bold text-[11px] text-muted-foreground uppercase mb-1">You</div>}
              {msg.role === 'system' && <div className="font-bold text-[11px] text-amber-700 uppercase mb-1">System</div>}
              {msg.content}
            </div>
          );
        })}
        {isLoading && (
          <div className="bg-primary/5 mr-6 p-3 rounded-xl border border-primary/10 flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin text-primary" />
            <span className="text-[11px] text-primary font-medium italic">Reasoning...</span>
          </div>
        )}
      </div>
      )}

      <div className="p-3 border-t bg-muted/10 shrink-0">
        <div className="relative">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
            disabled={!hasApiKey}
            placeholder={hasApiKey ? 'Ask about your data or build a workflow...' : 'Add an API key in Settings to chat'}
            className="w-full text-xs p-3 pr-10 border rounded-xl focus:ring-2 focus:ring-primary outline-none shadow-sm transition-all disabled:cursor-not-allowed disabled:bg-slate-50"
          />
          <button
            onClick={handleSendMessage}
            disabled={!input.trim() || isLoading || !hasApiKey}
            className="absolute right-2 top-2 p-1.5 text-primary hover:bg-primary/10 rounded-lg transition-colors disabled:opacity-30"
          >
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
