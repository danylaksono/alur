import { useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Check, Circle, Download, Loader2, Minus, PenLine, Pentagon, Plus, Table2, Trash2, X } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { cn } from '../../utils/cn';
import { FlowNodeShell, nodeHandleClass } from './FlowNodeShell';
import { commitDrawnLayer, downloadDrawnLayerGeoJson, downloadDrawnLayerParquet } from '../../services/drawnLayerService';
import {
  addField,
  describeDrawnLayer,
  emptyDrawnLayer,
  fieldNameError,
  minimumVertices,
  removeFeature,
  removeField,
  updateField,
  type DrawGeometryKind,
  type DrawnFieldType,
  type DrawnLayer,
} from '../../utils/drawnFeatures';

const KINDS: Array<{ kind: DrawGeometryKind; icon: typeof Circle; label: string }> = [
  { kind: 'point', icon: Circle, label: 'Point' },
  { kind: 'line', icon: Minus, label: 'Line' },
  { kind: 'polygon', icon: Pentagon, label: 'Polygon' },
];

const FIELD_TYPES: DrawnFieldType[] = ['text', 'number', 'boolean'];

export const GeometryNode = ({ data, id, selected }: any) => {
  const config = data.config || {};
  const layer: DrawnLayer = config.layer || emptyDrawnLayer(data.label);
  const drawing = useStore((state) => state.ui.drawing);
  const startDrawing = useStore((state) => state.startDrawing);
  const cancelDrawing = useStore((state) => state.cancelDrawing);
  const updateNode = useStore((state) => state.updateNode);
  const addToast = useStore((state) => state.addToast);
  const [newField, setNewField] = useState('');
  const [committing, setCommitting] = useState(false);

  const active = drawing?.nodeId === id ? drawing : undefined;
  const summary = describeDrawnLayer(layer);
  const committed = Boolean(config.tableName);

  const setLayer = (next: DrawnLayer) => updateNode(id, { ...config, layer: next });

  const toggleKind = (kind: DrawGeometryKind) => {
    if (active?.kind === kind) cancelDrawing();
    else startDrawing(id, kind);
  };

  const addColumn = () => {
    const error = fieldNameError(newField, layer.fields);
    if (error) { addToast({ type: 'warning', message: error }); return; }
    setLayer(addField(layer, { name: newField.trim(), type: 'text' }));
    setNewField('');
  };

  const renameColumn = (name: string, next: string) => {
    if (next.trim() === name) return;
    const error = fieldNameError(next, layer.fields, name);
    if (error) { addToast({ type: 'warning', message: error }); return; }
    setLayer(updateField(layer, name, { name: next.trim() }));
  };

  const create = async () => {
    setCommitting(true);
    try {
      // Leaves draw mode first: the shape is about to become a real layer, and
      // staying armed would add vertices to a node that no longer owns them.
      if (active) cancelDrawing();
      await commitDrawnLayer(id, { ...layer, name: layer.name || data.label });
    } finally {
      setCommitting(false);
    }
  };

  return (
    <FlowNodeShell id={id} selected={selected} tone="cyan" icon={PenLine} label="Drawn layer" title={layer.name || 'Draw features'}>
      <div className="space-y-2">
        <div className="flex gap-1">
          {KINDS.map(({ kind, icon: Icon, label }) => (
            <button
              key={kind}
              type="button"
              onClick={() => toggleKind(kind)}
              aria-pressed={active?.kind === kind}
              aria-label={`Draw ${label.toLowerCase()}`}
              className={cn(
                'flex flex-1 items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-[10px] font-bold',
                active?.kind === kind ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50',
              )}
            >
              <Icon className="h-3 w-3" /> {label}
            </button>
          ))}
        </div>

        {active && (
          <p className="rounded-md bg-indigo-50 px-2 py-1.5 text-[9px] leading-4 text-indigo-800">
            {active.kind === 'point'
              ? 'Click the map to place points. Esc to stop.'
              : `Click to add points (${active.positions.length}/${minimumVertices(active.kind)} minimum). Enter or double-click to finish, Backspace to undo, Esc to stop.`}
          </p>
        )}

        <div className="flex items-center justify-between rounded-md bg-slate-50 px-2 py-1.5 text-[9px] font-semibold text-slate-500">
          <span>{summary.total} feature{summary.total === 1 ? '' : 's'}</span>
          <span>{summary.point}p · {summary.line}l · {summary.polygon}a</span>
        </div>

        {layer.features.length > 0 && (
          <div className="max-h-24 space-y-1 overflow-y-auto">
            {layer.features.map((feature, index) => (
              <div key={feature.id} className="flex items-center gap-1.5 rounded px-1.5 py-1 text-[9px] text-slate-600 hover:bg-slate-50">
                <span className="flex-1 truncate">{index + 1}. {feature.kind}</span>
                <button type="button" onClick={() => setLayer(removeFeature(layer, feature.id))} aria-label={`Delete feature ${index + 1}`} className="rounded p-0.5 text-slate-400 hover:text-rose-600">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-slate-100 pt-2">
          <p className="mb-1 text-[9px] font-bold uppercase tracking-wide text-slate-400">Columns</p>
          {layer.fields.map((field) => (
            <div key={field.name} className="mb-1 flex items-center gap-1">
              <input
                defaultValue={field.name}
                onBlur={(event) => renameColumn(field.name, event.target.value)}
                aria-label={`Column name ${field.name}`}
                className="min-w-0 flex-1 rounded border border-slate-200 px-1.5 py-1 text-[9px]"
              />
              <select
                value={field.type}
                onChange={(event) => setLayer(updateField(layer, field.name, { type: event.target.value as DrawnFieldType }))}
                aria-label={`Column type ${field.name}`}
                className="rounded border border-slate-200 px-1 py-1 text-[9px]"
              >
                {FIELD_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
              <button type="button" onClick={() => setLayer(removeField(layer, field.name))} aria-label={`Remove column ${field.name}`} className="rounded p-0.5 text-slate-400 hover:text-rose-600">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          <div className="flex gap-1">
            <input
              value={newField}
              onChange={(event) => setNewField(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addColumn(); } }}
              placeholder="Add a column"
              aria-label="New column name"
              className="min-w-0 flex-1 rounded border border-slate-200 px-1.5 py-1 text-[9px]"
            />
            <button type="button" onClick={addColumn} aria-label="Add column" className="rounded border border-slate-200 px-1.5 text-slate-600 hover:bg-slate-50">
              <Plus className="h-3 w-3" />
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={create}
          disabled={!layer.features.length || committing}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-cyan-600 px-2 py-1.5 text-[10px] font-bold text-white disabled:bg-slate-300"
        >
          {committing ? <Loader2 className="h-3 w-3 animate-spin" /> : committed ? <Check className="h-3 w-3" /> : <Table2 className="h-3 w-3" />}
          {committed ? 'Update dataset' : 'Create dataset'}
        </button>

        <div className="flex gap-1">
          <button type="button" onClick={() => downloadDrawnLayerGeoJson(layer)} disabled={!layer.features.length} className="flex flex-1 items-center justify-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[9px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40">
            <Download className="h-3 w-3" /> GeoJSON
          </button>
          <button type="button" onClick={() => void downloadDrawnLayerParquet(config.tableName, layer.name)} disabled={!committed} title={committed ? undefined : 'Create the dataset first'} className="flex flex-1 items-center justify-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[9px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40">
            <Download className="h-3 w-3" /> Parquet
          </button>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className={nodeHandleClass('cyan')} />
    </FlowNodeShell>
  );
};
