import { useState, type ReactNode } from 'react';
import { Database, Zap, Eye, Plus, Info, Loader2, Layers, Filter, Calculator, Search, Workflow } from 'lucide-react';
import { useStore } from '../store/useStore';
import { buildWorkflowSQL } from '../utils/workflowEngine';
import { duckdbService } from '../services/duckdb';
import { cn } from '../utils/cn';

const colorStyles: Record<string, { hoverBg: string; hoverBorder: string; iconBg: string; iconHoverBg: string; dot: string }> = {
  blue: { hoverBg: 'hover:bg-blue-50', hoverBorder: 'hover:border-blue-200', iconBg: 'bg-blue-50', iconHoverBg: 'group-hover:bg-blue-100', dot: 'bg-blue-500' },
  purple: { hoverBg: 'hover:bg-purple-50', hoverBorder: 'hover:border-purple-200', iconBg: 'bg-purple-50', iconHoverBg: 'group-hover:bg-purple-100', dot: 'bg-purple-500' },
  slate: { hoverBg: 'hover:bg-slate-50', hoverBorder: 'hover:border-slate-200', iconBg: 'bg-slate-50', iconHoverBg: 'group-hover:bg-slate-100', dot: 'bg-slate-500' },
  orange: { hoverBg: 'hover:bg-orange-50', hoverBorder: 'hover:border-orange-200', iconBg: 'bg-orange-50', iconHoverBg: 'group-hover:bg-orange-100', dot: 'bg-orange-500' },
  amber: { hoverBg: 'hover:bg-amber-50', hoverBorder: 'hover:border-amber-200', iconBg: 'bg-amber-50', iconHoverBg: 'group-hover:bg-amber-100', dot: 'bg-amber-500' },
  emerald: { hoverBg: 'hover:bg-emerald-50', hoverBorder: 'hover:border-emerald-200', iconBg: 'bg-emerald-50', iconHoverBg: 'group-hover:bg-emerald-100', dot: 'bg-emerald-500' },
};

const nodeTypes = [
  { type: 'input' as const, icon: Database, title: 'Data Input', desc: 'Load Parquet, CSV, or sample data', color: 'blue' },
  { type: 'analysis' as const, icon: Zap, title: 'Spatial Analysis', desc: 'Buffer, intersect, transform, and more', color: 'purple' },
  { type: 'attribute' as const, icon: Calculator, title: 'Attribute Calc', desc: 'Add computed columns', color: 'slate' },
  { type: 'filter' as const, icon: Filter, title: 'Filter', desc: 'SQL WHERE conditions', color: 'amber' },
  { type: 'aggregate' as const, icon: Layers, title: 'Aggregate', desc: 'ST_Union_Agg, GROUP BY, dissolve', color: 'orange' },
  { type: 'output' as const, icon: Eye, title: 'Map Preview', desc: 'Visualize the final result', color: 'emerald' },
];

const spatialSearchTerms = [
  { name: 'ST_Buffer', desc: 'Buffer around geometries' },
  { name: 'ST_Intersection', desc: 'Intersect two layers' },
  { name: 'ST_Union', desc: 'Union two geometries' },
  { name: 'ST_Difference', desc: 'Difference of two layers' },
  { name: 'ST_Centroid', desc: 'Point at center of geometry' },
  { name: 'ST_Transform', desc: 'Reproject to another CRS' },
  { name: 'ST_Union_Agg', desc: 'Dissolve / merge features' },
  { name: 'ST_Envelope_Agg', desc: 'Bounding box of features' },
  { name: 'ST_Simplify', desc: 'Reduce geometry complexity' },
  { name: 'ST_ConvexHull', desc: 'Outer boundary of points' },
  { name: 'ST_Area', desc: 'Compute area' },
  { name: 'ST_Length', desc: 'Compute length' },
  { name: 'ST_Distance', desc: 'Distance between geometries' },
  { name: 'ST_Within', desc: 'Features within another layer' },
  { name: 'ST_Contains', desc: 'Layer contains features' },
  { name: 'ST_Intersects', desc: 'Check if geometries intersect' },
];

export const Sidebar = ({ children, className }: { children?: ReactNode; className?: string }) => {
  const addNode = useStore((s) => s.addNode);
  const duckdbReady = useStore((s) => s.duckdbReady);
  const addMapLayer = useStore((s) => s.addMapLayer);
  const addChatMessage = useStore((s) => s.addChatMessage);
  const [executing, setExecuting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredSpatialOps = spatialSearchTerms.filter(
    (op) => op.name.toLowerCase().includes(searchQuery.toLowerCase()) || op.desc.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleAddNode = (type: 'input' | 'analysis' | 'attribute' | 'filter' | 'aggregate' | 'output') => {
    const id = `${type}-${Date.now()}`;
    const labels: Record<string, string> = {
      input: 'Data Source',
      analysis: 'Spatial Op',
      attribute: 'Attribute Op',
      filter: 'Filter',
      aggregate: 'Aggregate',
      output: 'Map Output',
    };
    const newNode = {
      id,
      type,
      position: { x: 100, y: 100 },
      data: {
        label: labels[type] || type,
        type,
        config: {},
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
      addChatMessage('system', `✅ Workflow complete — ${geojson.features.length.toLocaleString()} features added to the map as "${outputLayerName}".`);
    } catch (err: any) {
      console.error('Workflow execution error:', err);
      addChatMessage('system', `❌ Workflow error: ${err.message}`);
    } finally {
      setExecuting(false);
    }
  };

  return (
    <aside className={cn(className ?? 'w-72', 'border-r bg-white flex flex-col shadow-sm z-40 shrink-0')}>
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Node Library */}
        <div>
          <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-1">
            <Workflow className="w-3 h-3" /> Nodes
          </h3>
          <div className="grid grid-cols-1 gap-1.5">
            {nodeTypes.map((item) => {
              const Icon = item.icon;
              const cs = colorStyles[item.color] || colorStyles.blue;
              return (
                <div
                  key={item.type}
                  onClick={() => handleAddNode(item.type)}
                  className={cn('group cursor-pointer flex items-center justify-between p-2.5 text-xs border rounded-xl transition-all', cs.hoverBg, cs.hoverBorder)}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={cn('p-1.5 rounded-lg transition-colors shrink-0', cs.iconBg, cs.iconHoverBg)}>
                      <Icon className="w-3.5 h-3.5" style={{ color: `var(--${item.color})` }} />
                    </div>
                    <div className="min-w-0">
                      <span className="font-bold block text-foreground text-[11px]">{item.title}</span>
                      <span className="text-[9px] text-muted-foreground truncate block">{item.desc}</span>
                    </div>
                  </div>
                  <Plus className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </div>
              );
            })}
          </div>
        </div>

        {/* Spatial Function Search */}
        <div>
          <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2 flex items-center gap-1">
            <Search className="w-3 h-3" /> Spatial Functions
          </h3>
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search functions..."
              className="w-full text-[10px] pl-7 pr-2 py-1.5 border rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-slate-50"
            />
          </div>
          {searchQuery && (
            <div className="space-y-1 max-h-[200px] overflow-y-auto">
              {filteredSpatialOps.length === 0 ? (
                <div className="text-[10px] text-muted-foreground italic p-2">No functions matched</div>
              ) : (
                filteredSpatialOps.map((op) => (
                  <div
                    key={op.name}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-purple-50 cursor-pointer text-[10px] transition-colors"
                    title="Add an analysis node and select this function"
                    onClick={() => {
                      handleAddNode('analysis');
                    }}
                  >
                    <Zap className="w-2.5 h-2.5 text-purple-500 shrink-0" />
                    <span className="font-mono font-semibold text-purple-700">{op.name}</span>
                    <span className="text-muted-foreground truncate">{op.desc}</span>
                  </div>
                ))
              )}
            </div>
          )}
          {!searchQuery && (
            <div className="text-[9px] text-muted-foreground italic px-1">
              Type to search over 120 spatial functions...
            </div>
          )}
        </div>

        {children ? (
          <div className="pt-4 border-t">{children}</div>
        ) : (
          <div className="pt-4 border-t">
            <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">
              Loaded Tables
            </h3>
            <div className="text-[11px] text-muted-foreground italic p-2 bg-muted/30 rounded border border-dashed">
              No tables loaded. Use a "Data Input" node.
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
            <><Loader2 className="w-4 h-4 animate-spin" /> Executing...</>
          ) : (
            <><Zap className="w-4 h-4 fill-white" /> Execute Workflow</>
          )}
        </button>
      </div>
    </aside>
  );
};
