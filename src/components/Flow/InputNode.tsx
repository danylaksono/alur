import { type ChangeEvent, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Cloud, Crop, Database, Upload, FileJson, Loader2, MapPinned, Table2 } from 'lucide-react';
import { ingestFile } from '../../services/dataIngestion';
import { FlowNodeShell, nodeHandleClass } from './FlowNodeShell';
import { RemoteSourceDialog } from './RemoteSourceDialog';

export const InputNode = ({ data, id, selected }: any) => {
  const config = data.config || {};
  const [loading, setLoading] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const isRemote = config.sourceMode === 'remote';
  const fileLabel = config.fileName || config.tableName || 'Load data';
  const datasetLabel = fileLabel.replace(/\.[^/.]+$/, '');
  const crsLabel = config.crs || 'CRS pending';
  const crsTitle = [config.crsName, config.crsReason].filter(Boolean).join(' - ');
  const isLoading = loading || config.loadStatus === 'loading';

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      await ingestFile(file, { nodeId: id });
    } finally {
      setLoading(false);
    }
  };

  return (
    <FlowNodeShell
      id={id}
      selected={selected}
      tone="blue"
      icon={isRemote ? Cloud : Database}
      label={isRemote ? 'Remote Source' : 'Data Source'}
      title={config.tableName ? datasetLabel : isRemote ? 'Read remote data' : 'Load data'}
    >
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-4 gap-2">
          <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
          <span className="max-w-[180px] truncate text-[11px] text-muted-foreground" title={config.loadStage}>
            {config.loadStage || 'Loading data…'}
          </span>
        </div>
      ) : config.tableName ? (
        <div className="space-y-2">
          <div className="grid grid-cols-[auto_1fr] gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
            {isRemote ? <Cloud className="mt-0.5 h-2.5 w-2.5" /> : <FileJson className="mt-0.5 h-2.5 w-2.5" />}
            <span className="truncate" title={isRemote ? config.remoteUrl : config.fileName}>
              {config.fileName}
            </span>
            {isRemote && config.remoteBbox && (
              <>
                <Crop className="mt-0.5 h-2.5 w-2.5" />
                <span className="truncate" title={config.remoteBboxPushdown ? 'Row groups outside the area were skipped' : 'Filtered after reading — this file has no bbox column'}>
                  {config.remoteBboxPushdown ? 'Area, pushed down' : 'Area filter'}
                </span>
              </>
            )}
            <MapPinned className="mt-0.5 h-2.5 w-2.5" />
            <span className="truncate" title={crsTitle || crsLabel}>
              {crsLabel}
              {config.crsConfidence ? ` · ${config.crsConfidence}` : ''}
            </span>
            <Table2 className="mt-0.5 h-2.5 w-2.5" />
            <span className="truncate" title={config.tableName}>
              {config.featureCount !== undefined
                ? `${Number(config.featureCount).toLocaleString()} features`
                : config.tableName}
            </span>
          </div>
        </div>
      ) : isRemote ? (
        <button
          type="button"
          onClick={() => setConfiguring(true)}
          className="pressable group flex w-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted py-3 transition-colors hover:border-blue-200 hover:bg-blue-50"
        >
          <Cloud className="mb-1 h-4 w-4 text-muted-foreground group-hover:text-blue-500" />
          <span className="text-[11px] font-medium text-muted-foreground group-hover:text-blue-600">
            {config.loadStatus === 'error' ? 'Try another URL' : 'Choose a remote file'}
          </span>
          {config.loadStatus === 'error' && (
            <span className="mt-1 max-w-[180px] truncate text-[9px] text-rose-500" title={config.loadError}>
              {config.loadError}
            </span>
          )}
        </button>
      ) : (
        <label className="cursor-pointer group flex flex-col items-center justify-center py-3 border-2 border-dashed border-muted rounded-lg hover:bg-blue-50 hover:border-blue-200 transition-colors">
          <Upload className="w-4 h-4 text-muted-foreground group-hover:text-blue-500 mb-1" />
          <span className="text-[11px] font-medium text-muted-foreground group-hover:text-blue-600">
            {config.loadStatus === 'error' ? 'Try another data file' : 'Upload data file'}
          </span>
          {config.loadStatus === 'error' && (
            <span className="mt-1 max-w-[180px] truncate text-[9px] text-rose-500" title={config.loadError}>
              Load failed
            </span>
          )}
          <input
            type="file"
            className="hidden"
            onChange={handleFileUpload}
            accept=".parquet,.csv,.json,.geojson,application/json,application/geo+json"
          />
        </label>
      )}
      <Handle type="source" position={Position.Right} className={nodeHandleClass('blue')} />
      {configuring && <RemoteSourceDialog nodeId={id} onClose={() => setConfiguring(false)} />}
    </FlowNodeShell>
  );
};
