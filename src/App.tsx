import { useEffect, useRef, useState } from 'react';
import { ReactFlow, Controls, Background } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useStore } from './store/useStore';
import { duckdbService } from './services/duckdb';
import { 
  Workflow, 
  Map as MapIcon, 
  MessageSquare, 
  Database, 
  Zap, 
  Eye, 
  Play, 
  Settings, 
  Terminal,
  ChevronDown
} from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { Chat } from './components/Chat';
import { MapView } from './components/Map/MapView';
import { InputNode } from './components/Flow/InputNode';
import { AnalysisNode } from './components/Flow/AnalysisNode';
import { OutputNode } from './components/Flow/OutputNode';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

const nodeTypes = {
  input: InputNode,
  analysis: AnalysisNode,
  attribute: AnalysisNode,
  output: OutputNode,
};

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const { 
    nodes, 
    edges, 
    onNodesChange, 
    onEdgesChange, 
    onConnect, 
    duckdbReady, 
    setDuckDBReady,
    mapLayers,
  } = useStore();

  const buildSqlPreview = () => {
    if (!nodes || nodes.length === 0) {
      return '-- SQL preview will appear here once you add input and analysis nodes.';
    }

    const lines: string[] = ['-- SQL Workflow Preview'];

    nodes.forEach((node, index) => {
      const { type, config, label } = node.data;
      lines.push(`-- Node ${index + 1}: ${label}`);

      if (type === 'input') {
        lines.push(config.tableName ? `-- Source table: ${config.tableName}` : '-- Source table: <unknown>');
      } else if (type === 'analysis') {
        const operation = config.operation || 'ST_Buffer';
        const sourceTable = config.sourceTable || '<source_table>';
        if (operation === 'ST_Buffer') {
          lines.push(`SELECT ST_Buffer(geom, ${config.distance ?? 100}) AS buffered_geom FROM ${sourceTable};`);
        } else if (operation === 'ST_Transform') {
          lines.push(`SELECT ST_Transform(geom, '${config.sourceCrs ?? 'EPSG:4326'}', '${config.targetCrs ?? 'EPSG:3857'}') AS geom_transformed FROM ${sourceTable};`);
        } else {
          lines.push(`SELECT ${operation}(geom) FROM ${sourceTable};`);
        }
      } else if (type === 'attribute') {
        lines.push(`SELECT *, ${config.expression ?? '<expression>'} AS ${config.resultField ?? 'new_field'} FROM ${config.sourceTable ?? '<source_table>'};`);
      } else if (type === 'output') {
        lines.push('-- Output node (visualization)');
      }

      lines.push('');
    });

    return lines.join('\n');
  };

  const sqlPreview = buildSqlPreview();
  const [rightPanelTab, setRightPanelTab] = useState<'sql' | 'help'>('sql');

  const [topRatio, setTopRatio] = useState(0.6);
  const [isResizing, setIsResizing] = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const init = async () => {
      try {
        await duckdbService.init();
        setDuckDBReady(true);
      } catch (e) {
        console.error('DuckDB Init failed', e);
      }
    };
    init();
  }, [setDuckDBReady]);

  useEffect(() => {
    if (!isResizing) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (!workspaceRef.current) return;
      const rect = workspaceRef.current.getBoundingClientRect();
      const ratio = (event.clientY - rect.top) / rect.height;
      setTopRatio(Math.min(0.85, Math.max(0.15, ratio)));
    };

    const stopResize = () => setIsResizing(false);

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    };
  }, [isResizing]);

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b bg-white px-6 z-50">
        <div className="flex items-center gap-3">
          <div className="bg-primary p-1.5 rounded-lg text-white">
            <Workflow className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-bold text-sm tracking-tight leading-none uppercase">GeoModeler Pro</h1>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Top-bottom modeler + map split view</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
            <span className="flex items-center gap-1">
              <Terminal className="w-3 h-3" /> 
              duckdb_wasm: {duckdbReady ? 'ready' : 'initializing...'}
            </span>
          </div>
          <button className="p-2 text-muted-foreground hover:bg-muted rounded-full transition-colors">
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar */}
        <Sidebar className="w-96">
          <Chat />
        </Sidebar>

        {/* Main Workspace */}
        <main ref={workspaceRef} className="flex-1 flex min-h-0 flex-col bg-white">
          <div className="min-h-0 overflow-hidden" style={{ flexBasis: `${topRatio * 100}%` }}>
            <MapView />
          </div>

          <div
            className="flex h-2 cursor-row-resize bg-slate-200/80 hover:bg-slate-300 transition-colors"
            onPointerDown={() => setIsResizing(true)}
          />

          <div className="min-h-0 overflow-hidden" style={{ flexBasis: `${(1 - topRatio) * 100}%` }}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              nodeTypes={nodeTypes}
              fitView
              className="h-full bg-background"
            >
              <Background gap={24} size={1} />
              <Controls />
            </ReactFlow>
          </div>
        </main>

        {/* Loaded Tables */}
        <div className="w-80 border-l bg-white flex flex-col shadow-sm z-40 shrink-0">
          <div className="p-4 border-b bg-muted/20">
            <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3 flex items-center justify-between">
              Loaded Tables
            </h3>
            {mapLayers.length ? (
              <div className="space-y-2">
                {mapLayers.map((layer) => (
                  <div key={layer.id} className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-800">
                    <div className="font-semibold truncate">{layer.name}</div>
                    <div className="text-[10px] text-muted-foreground">{layer.id}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[11px] text-muted-foreground italic p-2 bg-muted/30 rounded border border-dashed">
                No tables loaded. Drag a "Data Input" node to start.
              </div>
            )}
          </div>

          <div className="flex-1 overflow-hidden p-4">
            <div className="flex items-center justify-between gap-2 pb-3">
              <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                Right Panel
              </h3>
              <div className="flex gap-2">
                <button
                  onClick={() => setRightPanelTab('sql')}
                  className={`rounded-full px-3 py-1 text-[10px] font-semibold transition ${rightPanelTab === 'sql' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  SQL View
                </button>
                <button
                  onClick={() => setRightPanelTab('help')}
                  className={`rounded-full px-3 py-1 text-[10px] font-semibold transition ${rightPanelTab === 'help' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  Quick Tips
                </button>
              </div>
            </div>

            {rightPanelTab === 'sql' ? (
              <div className="space-y-3">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                  SQL preview for the current workflow
                </div>
                <textarea
                  readOnly
                  value={sqlPreview}
                  className="h-52 w-full resize-none rounded-2xl border border-slate-200 bg-slate-950 text-[11px] text-slate-100 p-3 font-mono leading-relaxed focus:outline-none"
                />
              </div>
            ) : (
              <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-[11px] text-slate-700">
                <div className="font-semibold text-slate-900">Quick SQL panel tips</div>
                <div className="space-y-2">
                  <div>• SQL preview is generated from the current node sequence.</div>
                  <div>• Use <span className="font-semibold">Attribute Analysis</span> to add calculated fields to tables.</div>
                  <div>• Use <span className="font-semibold">Spatial Analysis</span> for geometry operations like buffers and transforms.</div>
                  <div>• Keep your source table names consistent for cleaner generated SQL.</div>
                </div>
                <div className="rounded-2xl bg-slate-100 p-3 text-slate-600">
                  Tip: Add an input node, then connect an analysis node to see the SQL preview update.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer / Status Bar */}
      <footer className="h-10 bg-slate-900 flex items-center px-4 justify-between border-t border-slate-700 shrink-0 text-white z-50">
        <div className="flex items-center gap-4 text-[10px] font-mono text-slate-400">
          <span className={cn(
            "flex items-center gap-1",
            duckdbReady ? "text-emerald-400" : "text-amber-400"
          )}>
            <span className={cn("w-1.5 h-1.5 rounded-full", duckdbReady ? "bg-emerald-400 animate-pulse" : "bg-amber-400")}></span>
            {duckdbReady ? "SYSTEM ONLINE" : "ENGINE WARMING"}
          </span>
          <span className="hover:text-white cursor-pointer transition-colors max-w-lg truncate">
            {duckdbReady ? "spatial extension loaded. ready for queries." : "loading spatial extension..."}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono text-slate-500">CLIENT-SIDE SQL • DUCKDB WASM</span>
          <button className="text-[10px] text-slate-300 hover:text-white flex items-center gap-1 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
            Export Model (JSON)
          </button>
        </div>
      </footer>
    </div>
  );
}
