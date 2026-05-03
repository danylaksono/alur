import { useEffect, useRef, useState } from 'react';
import { ReactFlow, Controls, Background } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useStore } from './store/useStore';
import { duckdbService } from './services/duckdb';
import { buildWorkflowSQL, cteAlias } from './utils/workflowEngine';
import {
  Workflow,
  Database,
  Play,
  Settings,
  Terminal,
  ChevronDown,
  Download
} from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { Chat } from './components/Chat';
import { MapView } from './components/Map/MapView';
import { InputNode } from './components/Flow/InputNode';
import { AnalysisNode } from './components/Flow/AnalysisNode';
import { AttributeNode } from './components/Flow/AttributeNode';
import { AggregateNode } from './components/Flow/AggregateNode';
import { FilterNode } from './components/Flow/FilterNode';
import { OutputNode } from './components/Flow/OutputNode';
import { DataTable } from './components/DataTable';
import { ToastContainer } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useWorkflowSync } from './hooks/useWorkflowSync';
import { useSchemaFetcher } from './hooks/useSchemaFetcher';
import { cn } from './utils/cn';

const nodeTypes = {
  input: InputNode,
  analysis: AnalysisNode,
  attribute: AttributeNode,
  aggregate: AggregateNode,
  filter: FilterNode,
  output: OutputNode,
};

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
    addMapLayer,
    manualSQL,
    setManualSQL,
    isManualSQL,
    setIsManualSQL,
    selectedNodeId,
    setSelectedNodeId,
    addNode,
    removeNode,
    duplicateNode,
    addToast,
  } = useStore();

  const [previewData, setPreviewData] = useState<any[]>([]);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const [lastManualSql, setLastManualSql] = useState<string | null>(null);

  useWorkflowSync();
  useSchemaFetcher();

  const handleRunSQL = async () => {
    if (!manualSQL) return;
    try {
      setIsPreviewLoading(true);
      const geojson = await duckdbService.getGeoJSON(manualSQL);
      addMapLayer({
        id: 'manual_query_result',
        name: 'Query Result',
        geojson,
      });
      setLastManualSql(manualSQL);
      const result = await duckdbService.query(manualSQL);
      setPreviewData(result.toArray().map((r: any) => typeof r.toJSON === 'function' ? r.toJSON() : r));
      setShowTable(true);
    } catch (err: any) {
      addToast({ type: 'error', message: `SQL Error: ${err.message}` });
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handlePromoteToNode = () => {
    if (!lastManualSql) return;
    const sqlSnippet = lastManualSql.length > 120 ? lastManualSql.slice(0, 120) + '...' : lastManualSql;
    const nodeId = `sql-node-${Date.now()}`;
    addNode({
      id: nodeId,
      type: 'analysis',
      position: { x: 350, y: 250 },
      data: {
        label: 'Custom SQL',
        type: 'analysis',
        config: { operation: 'ST_Buffer', customSql: lastManualSql },
      },
    });
    addToast({ type: 'success', message: `Created node from SQL` });
    setLastManualSql(null);
  };

  const handleExport = async (format: 'parquet' | 'csv' | 'json' = 'parquet') => {
    try {
      if (nodes.length === 0) return;
      const { sql } = buildWorkflowSQL(nodes, edges);
      // We want to export the last node's CTE
      const lastNode = nodes[nodes.length - 1];
      const targetAlias = cteAlias(lastNode.id);
      const exportSql = `${sql.split('SELECT')[0]} SELECT * FROM ${targetAlias}`;
      
      const { buffer, fileName } = await duckdbService.exportTable(exportSql, format);
      
      const blob = new Blob([buffer as BlobPart], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      addToast({ type: 'error', message: `Export failed: ${err.message}` });
    }
  };

  useEffect(() => {
    const fetchNodePreview = async () => {
      if (!selectedNodeId) {
        setPreviewData([]);
        return;
      }

      try {
        setIsPreviewLoading(true);
        const { withClause } = buildWorkflowSQL(nodes, edges);
        // We need to modify the SQL to select from the specific CTE alias of the selected node
        const targetAlias = cteAlias(selectedNodeId);
        const previewSql = `${withClause} SELECT * FROM ${targetAlias} LIMIT 100;`;
        
        const result = await duckdbService.query(previewSql);
        setPreviewData(result.toArray().map((r: any) => typeof r.toJSON === 'function' ? r.toJSON() : r));
        setShowTable(true);
      } catch (err) {
        console.error('Failed to fetch node preview:', err);
        setPreviewData([]);
      } finally {
        setIsPreviewLoading(false);
      }
    };

    if (!isManualSQL && selectedNodeId) {
      fetchNodePreview();
    }
  }, [selectedNodeId, nodes, edges, isManualSQL]);

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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      // Delete/Backspace: remove selected node
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNodeId) {
          removeNode(selectedNodeId);
          setSelectedNodeId(null);
          e.preventDefault();
        }
      }

      // Ctrl+D: duplicate selected node
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        if (selectedNodeId) {
          duplicateNode(selectedNodeId, `node-${Date.now()}`);
          e.preventDefault();
        }
      }

      // Ctrl+Shift+M: toggle manual SQL mode
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'm') {
        setIsManualSQL(!isManualSQL);
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNodeId, removeNode, duplicateNode, setSelectedNodeId, isManualSQL, setIsManualSQL]);

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
          <ErrorBoundary name="Chat">
            <Chat />
          </ErrorBoundary>
        </Sidebar>

        {/* Main Workspace */}
        <main ref={workspaceRef} className="flex-1 flex min-h-0 flex-col bg-white">
          <ErrorBoundary name="Map" fallback={
            <div className="flex items-center justify-center h-full bg-slate-100 text-slate-400 text-[11px] italic">Map failed to load</div>
          }>
            <div className="min-h-0 overflow-hidden" style={{ flexBasis: `${topRatio * 100}%` }}>
              <MapView />
            </div>
          </ErrorBoundary>

          <div
            className="flex h-2 cursor-row-resize bg-slate-200/80 hover:bg-slate-300 transition-colors"
            onPointerDown={() => setIsResizing(true)}
          />

          <ErrorBoundary name="Workflow" fallback={
            <div className="flex items-center justify-center h-full bg-slate-100 text-slate-400 text-[11px] italic">Workflow editor error</div>
          }>
            <div className="min-h-0 overflow-hidden" style={{ flexBasis: `${(1 - topRatio) * 100}%` }}>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeClick={(_, node) => setSelectedNodeId(node.id)}
                onPaneClick={() => setSelectedNodeId(null)}
                nodeTypes={nodeTypes}
                fitView
                className="h-full bg-background"
              >
                <Background gap={24} size={1} />
                <Controls />
              </ReactFlow>
            </div>
          </ErrorBoundary>

          {/* Attribute Data Table Panel */}
          <ErrorBoundary name="DataTable">
            <div className={cn(
              "border-t bg-white transition-all duration-300 flex flex-col",
              showTable ? "h-64" : "h-10"
            )}>
              <div 
                className="flex items-center justify-between px-4 py-2 bg-slate-50 cursor-pointer border-b hover:bg-slate-100 transition-colors"
                onClick={() => setShowTable(!showTable)}
              >
                <div className="flex items-center gap-2">
                  <Database className="w-3 h-3 text-slate-500" />
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                    Attribute Inspector {selectedNodeId ? `— ${nodes.find(n => n.id === selectedNodeId)?.data.label}` : ''}
                  </span>
                </div>
                <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                  {selectedNodeId && (
                    <button 
                      onClick={() => handleExport('csv')}
                      className="flex items-center gap-1.5 px-2 py-1 bg-white border border-slate-200 rounded text-[9px] font-bold text-slate-600 hover:bg-slate-50 transition-colors"
                    >
                      <Download className="w-2.5 h-2.5" /> CSV
                    </button>
                  )}
                  {isPreviewLoading && <div className="w-3 h-3 border border-primary border-t-transparent rounded-full animate-spin" />}
                  <ChevronDown 
                    className={cn("w-4 h-4 text-slate-400 transition-transform cursor-pointer", !showTable && "rotate-180")} 
                    onClick={() => setShowTable(!showTable)}
                />
              </div>
            </div>
            {showTable && (
              <div className="flex-1 overflow-hidden">
                <DataTable data={previewData} isLoading={isPreviewLoading} />
              </div>
            )}
          </div>
          </ErrorBoundary>
        </main>

        {/* Loaded Tables */}
        <ErrorBoundary name="SQL Panel">
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

          <div className="flex-1 overflow-hidden p-4 flex flex-col bg-slate-50">
            <div className="flex items-center justify-between gap-2 pb-4">
              <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                SQL Editor & Workflow Preview
              </h3>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <span className="text-[9px] font-bold text-slate-400 uppercase">Manual Mode</span>
                  <div className="relative">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={isManualSQL}
                      onChange={(e) => setIsManualSQL(e.target.checked)}
                    />
                    <div className="w-8 h-4 bg-slate-200 rounded-full peer peer-checked:bg-primary transition-colors"></div>
                    <div className="absolute left-1 top-1 w-2 h-2 bg-white rounded-full transition-transform peer-checked:translate-x-4"></div>
                  </div>
                </label>
              </div>
            </div>

            <div className="flex-1 flex flex-col min-h-0 relative">
              <textarea
                value={manualSQL}
                onChange={(e) => isManualSQL && setManualSQL(e.target.value)}
                readOnly={!isManualSQL}
                className={cn(
                  "flex-1 w-full resize-none rounded-2xl border bg-white p-4 font-mono text-[11px] leading-relaxed shadow-inner outline-none transition-all",
                  isManualSQL ? "border-primary ring-2 ring-primary/5 text-slate-800" : "border-slate-200 text-slate-500 bg-slate-100/50"
                )}
                placeholder="Write your spatial SQL here..."
              />

              <div className="absolute bottom-4 right-4 flex flex-col gap-1.5 items-end">
                {isManualSQL && (
                  <>
                    <button
                      onClick={handleRunSQL}
                      className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-[10px] font-bold hover:bg-slate-800 shadow-lg transition-all"
                    >
                      <Play className="w-3 h-3 fill-current" /> RUN QUERY
                    </button>
                    {lastManualSql && (
                      <button
                        onClick={handlePromoteToNode}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-xl text-[9px] font-bold hover:bg-indigo-100 border border-indigo-200 transition-all"
                      >
                        <Workflow className="w-3 h-3" /> Promote to Node
                      </button>
                    )}
                  </>
                )}
                {!isManualSQL && (
                  <div className="px-3 py-1.5 bg-slate-200/50 text-slate-500 rounded-lg text-[9px] font-bold uppercase tracking-wider backdrop-blur-sm">
                    Synced to Workflow
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        </ErrorBoundary>
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
          <button 
            onClick={() => handleExport('parquet')}
            className="text-[10px] text-slate-300 hover:text-white flex items-center gap-1 bg-slate-800 px-2 py-0.5 rounded border border-slate-700 transition-colors"
          >
            <Download className="w-3 h-3" /> Export GeoParquet
          </button>
        </div>
      </footer>

      <ToastContainer />
    </div>
  );
}
