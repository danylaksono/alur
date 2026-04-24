import React, { useState, type ReactNode } from 'react';
import { Database, Zap, Eye, Plus, Info, Loader2 } from 'lucide-react';
import { useStore } from '../store/useStore';
import { buildWorkflowSQL } from '../utils/workflowEngine';
import { duckdbService } from '../services/duckdb';

export const Sidebar = ({ children, className }: { children?: ReactNode; className?: string }) => {
  const { addNode, duckdbReady, addMapLayer, addChatMessage } = useStore();
  const [executing, setExecuting] = useState(false);

  const handleAddNode = (type: 'input' | 'analysis' | 'attribute' | 'output') => {
    const id = `${type}-${Date.now()}`;
    const newNode = {
      id,
      type: type, // Matches keys in nodeTypes
      position: { x: 100, y: 100 },
      data: { 
        label: type === 'input' ? 'Data Source' : type === 'analysis' ? 'Spatial Op' : type === 'attribute' ? 'Attribute Op' : 'Map Output',
        type,
        config: {}
      },
    };
    addNode(newNode);
  };

  const handleExecute = async () => {
    const { nodes, edges } = useStore.getState();

    try {
      setExecuting(true);
      addChatMessage('system', '⚙️ Building workflow SQL...');

      const { sql, outputLayerName } = buildWorkflowSQL(nodes, edges);
      addChatMessage('system', `📝 Generated SQL:\n\`\`\`sql\n${sql}\n\`\`\``);

      addChatMessage('system', '🚀 Executing workflow against DuckDB...');
      const geojson = await duckdbService.getGeoJSON(sql);

      if (!geojson || geojson.features.length === 0) {
        addChatMessage('system', '⚠️ Workflow executed but produced no features.');
        return;
      }

      addMapLayer({
        id: outputLayerName,
        name: `Workflow Result (${geojson.features.length} features)`,
        geojson,
      });

      addChatMessage(
        'system',
        `✅ Workflow complete — ${geojson.features.length.toLocaleString()} features added to the map as "${outputLayerName}".`
      );
    } catch (err: any) {
      console.error('Workflow execution error:', err);
      addChatMessage('system', `❌ Workflow error: ${err.message}`);
    } finally {
      setExecuting(false);
    }
  };

  return (
    <aside className={`${className ?? 'w-72'} border-r bg-white flex flex-col shadow-sm z-40 shrink-0`}>
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <div>
          <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3 flex items-center justify-between">
            Nodes Library
            <Info className="w-3 h-3 cursor-help" />
          </h3>
          <div className="grid grid-cols-1 gap-2">
            <NodeLibraryItem 
              icon={<Database className="w-4 h-4 text-blue-500" />}
              title="Data Input"
              description="Register Parquet/CSV"
              onClick={() => handleAddNode('input')}
              color="blue"
            />
            <NodeLibraryItem 
              icon={<Zap className="w-4 h-4 text-purple-500" />}
              title="Spatial Analysis"
              description="Run DuckDB spatial operations across one or more layers"
              onClick={() => handleAddNode('analysis')}
              color="purple"
            />
            <NodeLibraryItem 
              icon={<Database className="w-4 h-4 text-slate-600" />}
              title="Attribute Analysis"
              description="Add calculated fields, metrics, or table expressions"
              onClick={() => handleAddNode('attribute')}
              color="slate"
            />
            <NodeLibraryItem 
              icon={<Eye className="w-4 h-4 text-emerald-500" />}
              title="Map Preview"
              description="Visualise Output"
              onClick={() => handleAddNode('output')}
              color="emerald"
            />
          </div>
        </div>

        {children ? (
          <div className="pt-4 border-t">{children}</div>
        ) : (
          <div className="pt-4 border-t">
            <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">
              Loaded Tables
            </h3>
            <div className="text-[11px] text-muted-foreground italic p-2 bg-muted/30 rounded border border-dashed">
              No tables loaded. Drag a "Data Input" node to start.
            </div>
          </div>
        )}
      </div>

      <div className="p-4 border-t bg-muted/20">
        <button 
          onClick={handleExecute}
          disabled={!duckdbReady || executing}
          className="w-full bg-slate-900 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-black transition-all active:scale-[0.98] shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {executing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Executing...
            </>
          ) : (
            <>
              <Zap className="w-4 h-4 fill-white" />
              Execute Workflow
            </>
          )}
        </button>
      </div>
    </aside>
  );
};

const NodeLibraryItem = ({ icon, title, description, onClick, color }: any) => (
  <div 
    onClick={onClick}
    className={`group cursor-pointer flex items-center justify-between p-3 text-xs border rounded-xl hover:bg-${color}-50 hover:border-${color}-200 transition-all`}
  >
    <div className="flex items-center gap-3">
      <div className={`p-2 bg-${color}-50 rounded-lg group-hover:bg-${color}-100 transition-colors`}>
        {icon}
      </div>
      <div>
        <span className="font-bold block text-foreground">{title}</span>
        <span className="text-[10px] text-muted-foreground">{description}</span>
      </div>
    </div>
    <Plus className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
  </div>
);

