import { Handle, Position } from '@xyflow/react';
import { Palette } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { SEQUENTIAL_PALETTES } from '../../utils/palettes';
import { FlowNodeShell, fieldLabelClass, inputClass, nodeHandleClass, selectClass } from './FlowNodeShell';
import { cn } from '../../utils/cn';

type VisualisationKind = 'choropleth' | 'categorical' | 'graduated_symbol' | 'heatmap' | 'label' | 'dot_density';

export const VisualisationNode = ({ data, id }: any) => {
  const updateNode = useStore((s) => s.updateNode);
  const kind: VisualisationKind = data.config?.kind ?? 'choropleth';
  const field = data.config?.field ?? '';
  const method = data.config?.method ?? 'quantile';
  const classCount = data.config?.classCount ?? 5;
  const paletteId = data.config?.paletteId ?? SEQUENTIAL_PALETTES[0].id;

  const updateConfig = (payload: Record<string, unknown>) => updateNode(id, { ...data.config, ...payload });

  return (
    <FlowNodeShell
      id={id}
      tone="purple"
      icon={Palette}
      label="Visualisation"
      title={field || kind}
      helperContent={
        <div>
          <div className="font-semibold text-slate-800">Visualisation Recipe</div>
          <div>Passes data through and stores a reusable style recipe for downstream output nodes.</div>
        </div>
      }
    >
      <div>
        <label className={cn(fieldLabelClass, 'mb-1')}>Type</label>
        <select
          className={selectClass}
          value={kind}
          onChange={(event) => updateConfig({ kind: event.target.value })}
        >
          <option value="choropleth">Choropleth</option>
          <option value="categorical">Categories</option>
          <option value="graduated_symbol">Symbols</option>
          <option value="heatmap">Heatmap</option>
          <option value="dot_density">Dot density</option>
          <option value="label">Labels</option>
        </select>
      </div>

      <div>
        <label className={cn(fieldLabelClass, 'mb-1')}>Field</label>
        <input
          type="text"
          className={inputClass}
          value={field}
          onChange={(event) => updateConfig({ field: event.target.value })}
          placeholder="need_score"
        />
      </div>

      {kind === 'choropleth' && (
        <div className="grid grid-cols-2 gap-2">
          <label>
            <span className={cn(fieldLabelClass, 'mb-1')}>Method</span>
            <select
              className={selectClass}
              value={method}
              onChange={(event) => updateConfig({ method: event.target.value })}
            >
              <option value="quantile">Quantile</option>
              <option value="equal_interval">Equal interval</option>
            </select>
          </label>
          <label>
            <span className={cn(fieldLabelClass, 'mb-1')}>Classes</span>
            <input
              type="number"
              min={2}
              max={9}
              className={inputClass}
              value={classCount}
              onChange={(event) => updateConfig({ classCount: Number(event.target.value) })}
            />
          </label>
        </div>
      )}

      {(kind === 'choropleth' || kind === 'heatmap') && (
        <div>
          <label className={cn(fieldLabelClass, 'mb-1')}>Palette</label>
          <select
            className={selectClass}
            value={paletteId}
            onChange={(event) => updateConfig({ paletteId: event.target.value })}
          >
            {SEQUENTIAL_PALETTES.map((palette) => (
              <option key={palette.id} value={palette.id}>{palette.name}</option>
            ))}
          </select>
        </div>
      )}

      <Handle type="target" position={Position.Left} className={nodeHandleClass('purple')} />
      <Handle type="source" position={Position.Right} className={nodeHandleClass('purple')} />
    </FlowNodeShell>
  );
};

