import { useEffect, useMemo, useRef, useState } from 'react';
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
  Download
} from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { Chat } from './components/Chat';
import { MapView } from './components/Map/MapView';
import { LayerManager } from './components/LayerManager';
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
    selectedLayerId,
    setSelectedNodeId,
    setSelectedLayerId,
    addNode,
    removeNode,
    duplicateNode,
    addToast,
  } = useStore();

  const [previewData, setPreviewData] = useState<any[]>([]);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<'diagram' | 'attributes'>('diagram');
  const [lastManualSql, setLastManualSql] = useState<string | null>(null);

  useWorkflowSync();
  useSchemaFetcher();

  const selectedLayer = useMemo(
    () => mapLayers.find((layer) => layer.id === selectedLayerId) || null,
    [mapLayers, selectedLayerId]
  );
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) || null,
    [nodes, selectedNodeId]
  );
  const layerAttributeRows = useMemo(
    () => (selectedLayer?.geojson.features || []).map((feature, index) => ({
      _feature: index + 1,
      ...(feature.properties || {}),
    })),
    [selectedLayer]
  );
  const attributeData = selectedLayer ? layerAttributeRows : previewData;
  const attributeSourceLabel = selectedLayer
    ? selectedLayer.name
    : selectedNode?.data.label || 'No node or layer selected';

  const handleRunSQL = async () => {
    if (!manualSQL) return;
    try {
      setIsPreviewLoading(true);
      const geojson = await duckdbService.getGeoJSON(manualSQL);
      addMapLayer({
        id: `manual-query-${Date.now()}`,
        name: 'Query Result',
        geojson,
        sourceKind: 'manual',
      });
      setLastManualSql(manualSQL);
      const result = await duckdbService.query(manualSQL);
      setPreviewData(result.toArray().map((r: any) => typeof r.toJSON === 'function' ? r.toJSON() : r));
      setWorkspaceTab('attributes');
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
            <h1 className="font-bold text-sm tracking-tight leading-none uppercase">YMNNGIS</h1>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">You Might Not Need A Desktop GIS</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
            <span className="flex items-center gap-1">
              <Terminal className="w-3 h-3" />
              Dashboard Status: {duckdbReady ? 'ready' : 'initializing...'}
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

          <div
            className="flex min-h-0 flex-col overflow-hidden border-t bg-white"
            style={{ flexBasis: `${(1 - topRatio) * 100}%` }}
          >
            <div className="flex h-11 shrink-0 items-center justify-between border-b bg-slate-50 px-3">
              <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-white p-1">
                <button
                  type="button"
                  onClick={() => setWorkspaceTab('diagram')}
                  className={cn(
                    "flex items-center gap-1.5 rounded px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors",
                    workspaceTab === 'diagram'
                      ? "bg-slate-900 text-white"
                      : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  )}
                >
                  <Workflow className="w-3 h-3" />
                  Node Diagram
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setWorkspaceTab('attributes');
                  }}
                  className={cn(
                    "flex items-center gap-1.5 rounded px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors",
                    workspaceTab === 'attributes'
                      ? "bg-slate-900 text-white"
                      : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  )}
                >
                  <Database className="w-3 h-3" />
                  Attribute Inspector
                </button>
              </div>

              <div className="flex items-center gap-3">
                <span className="max-w-64 truncate text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  {attributeSourceLabel}
                </span>
                {workspaceTab === 'attributes' && selectedNodeId && (
                  <button
                    onClick={() => handleExport('csv')}
                    className="flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1 text-[9px] font-bold text-slate-600 transition-colors hover:bg-slate-50"
                  >
                    <Download className="w-2.5 h-2.5" /> CSV
                  </button>
                )}
                {workspaceTab === 'attributes' && isPreviewLoading && (
                  <div className="h-3 w-3 animate-spin rounded-full border border-primary border-t-transparent" />
                )}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
              {workspaceTab === 'diagram' ? (
                <ErrorBoundary name="Workflow" fallback={
                  <div className="flex items-center justify-center h-full bg-slate-100 text-slate-400 text-[11px] italic">Workflow editor error</div>
                }>
                  <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    onNodeClick={(_, node) => {
                      setSelectedNodeId(node.id);
                      setSelectedLayerId(null);
                    }}
                    onPaneClick={() => {
                      setSelectedNodeId(null);
                      setSelectedLayerId(null);
                    }}
                    nodeTypes={nodeTypes}
                    fitView
                    className="h-full bg-background"
                  >
                    <Background gap={24} size={1} />
                    <Controls />
                  </ReactFlow>
                </ErrorBoundary>
              ) : (
                <ErrorBoundary name="DataTable">
                  <DataTable data={attributeData} isLoading={!selectedLayer && isPreviewLoading} />
                </ErrorBoundary>
              )}
            </div>
          </div>
        </main>

        <aside className="w-96 shrink-0 border-l bg-white shadow-sm z-40 flex min-h-0 flex-col">
          <div className="min-h-0 border-b" style={{ flexBasis: '42%' }}>
            <ErrorBoundary name="Layer Manager">
              <LayerManager />
            </ErrorBoundary>
          </div>

          <ErrorBoundary name="SQL Panel">
          <div className="flex min-h-0 flex-1 flex-col bg-slate-50">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
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
        </aside>
      </div>

      <ToastContainer />
    </div>
  );
}
