import { useState, useRef, useEffect } from 'react';
import { MessageSquare, ArrowRight, Loader2, Sparkles } from 'lucide-react';
import { useStore } from '../store/useStore';
import { callOpenRouter } from '../utils/openrouter';
import { duckdbService } from '../services/duckdb';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const Chat = () => {
  const { chatMessages, addChatMessage, addNode, onConnect, updateNode, removeNode, duplicateNode } = useStore();
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
      const response = await callOpenRouter(chatMessages);

      if (response.function_call) {
        addChatMessage('assistant', `Invoking tool: ${response.function_call.name}`);
        const args = typeof response.function_call.arguments === 'string'
          ? JSON.parse(response.function_call.arguments)
          : response.function_call.arguments;

        switch (response.function_call.name) {
          case 'add_node': {
            const nodeId = args.id || `node-${Date.now()}`;
            addNode({
              id: nodeId,
              type: args.type,
              position: args.position || { x: 300, y: 150 },
              data: {
                label: args.label || (args.type === 'analysis' ? 'Spatial Op' : args.type === 'attribute' ? 'Attribute Op' : args.type === 'input' ? 'Data Source' : 'Map Output'),
                type: args.type,
                config: args.config || {},
              },
            });
            addChatMessage('assistant', `Tool executed: add_node (${nodeId})`);
            break;
          }
          case 'connect_nodes': {
            onConnect({ source: args.source_id, target: args.target_id, type: 'smoothstep' } as any);
            addChatMessage('assistant', `Tool executed: connect_nodes (${args.source_id} -> ${args.target_id})`);
            break;
          }
          case 'update_node': {
            updateNode(args.id, args.config);
            addChatMessage('assistant', `Tool executed: update_node (${args.id})`);
            break;
          }
          case 'delete_node': {
            removeNode(args.id);
            addChatMessage('assistant', `Tool executed: delete_node (${args.id})`);
            break;
          }
          case 'copy_node': {
            const newNodeId = args.new_id || `node-${Date.now()}`;
            duplicateNode(args.id, newNodeId, args.position);
            addChatMessage('assistant', `Tool executed: copy_node (${args.id} -> ${newNodeId})`);
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
              addChatMessage('assistant', `SQL executed successfully.\n\n${summary}`);
            } catch (err: any) {
              addChatMessage('assistant', `SQL execution error: ${err.message || 'Unknown error'}`);
            }
            break;
          }
          case 'add_geojson_layer':
          case 'add_h3_layer': {
            addChatMessage('assistant', `Tool received: ${response.function_call.name}. Map layer rendering is not implemented yet.`);
            break;
          }
          default: {
            addChatMessage('assistant', `Received unsupported tool call: ${response.function_call.name}`);
          }
        }
      } else {
        addChatMessage('assistant', response.content || 'No assistant content returned.');
      }
    } catch (err: any) {
      addChatMessage('system', `Error: ${err.message || 'Failed to reach AI agent'}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full border-l bg-white flex flex-col shadow-sm z-40 shrink-0">
      <div className="p-4 border-b bg-muted/20 flex items-center justify-between">
        <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-primary" /> GIS Copilot Agent
        </h3>
        <span className="text-[9px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-bold">GPT-4O-MINI</span>
      </div>
      
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth"
      >
        {chatMessages.map((msg, i) => (
          <div 
            key={i}
            className={cn(
              "p-3 rounded-xl text-[11px] leading-relaxed border",
              msg.role === 'user' ? "bg-muted/50 ml-6 border-transparent" : 
              msg.role === 'system' ? "bg-emerald-50 text-emerald-800 border-emerald-100 font-mono" :
              "bg-primary/5 mr-6 border-primary/10 text-foreground"
            )}
          >
            {msg.role === 'assistant' && <div className="font-bold text-[9px] text-primary uppercase mb-1">Copilot</div>}
            {msg.role === 'user' && <div className="font-bold text-[9px] text-muted-foreground uppercase mb-1">You</div>}
            {msg.content}
          </div>
        ))}
        {isLoading && (
          <div className="bg-primary/5 mr-6 p-3 rounded-xl border border-primary/10 flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin text-primary" />
            <span className="text-[10px] text-primary font-medium italic">Reasoning...</span>
          </div>
        )}
      </div>

      <div className="p-4 border-t bg-muted/10">
        <div className="relative">
          <input 
            type="text" 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder="Ask to build a workflow..." 
            className="w-full text-xs p-3 pr-10 border rounded-xl focus:ring-2 focus:ring-primary outline-none shadow-sm transition-all"
          />
          <button 
            onClick={handleSendMessage}
            disabled={!input.trim() || isLoading}
            className="absolute right-2 top-2 p-1.5 text-primary hover:bg-primary/10 rounded-lg transition-colors disabled:opacity-30"
          >
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[9px] text-center mt-3 text-muted-foreground">
          Powered by OpenRouter • Context aware GIS agent
        </p>
      </div>
    </div>
  );
};
