import { useMemo } from "react";
import { Handle, Position } from "@xyflow/react";
import { Hexagon } from "lucide-react";
import { useStore } from "../../store/useStore";
import { cn } from "../../utils/cn";
import {
  h3NodeErrors,
  h3OperationById,
  h3Operations,
  h3PolyfillAggregates,
  h3PolyfillErrors,
} from "../../utils/h3Functions";
import {
  FlowNodeShell,
  fieldLabelClass,
  inputClass,
  nodeHandleClass,
  selectClass,
} from "./FlowNodeShell";
import { TypeaheadSelect } from "./TypeaheadSelect";

const EXCLUDED_COLUMNS = new Set(["geometry", "geom", "geojson", "geom_agg"]);

/**
 * H3 grid node, with two modes:
 *
 * - Encode — add a derived H3 column to every row (cell from lat/lng, parent
 *   cell, resolution, centroid, boundary WKT). Row count is unchanged.
 * - Polyfill — cover upstream polygons (or buffered lines) with H3 cells at a
 *   resolution, then dissolve back to one row per cell with attributes encoded
 *   onto it and a real GEOMETRY boundary column, so the result maps directly.
 *
 * Both run inside DuckDB's community h3 extension (loaded lazily on first
 * execution), so no external H3 library is involved.
 */
export const H3Node = ({ data, id, selected }: any) => {
  const updateNode = useStore((s) => s.updateNode);
  const edges = useStore((s) => s.edges);
  const nodeSchemas = useStore((s) => s.nodeSchemas);
  const config = data.config || {};
  const mode = config.mode || "encode";

  const updateConfig = (payload: any) =>
    updateNode(id, { ...config, ...payload });

  const incomingEdge = edges.find((edge) => edge.target === id);
  const upstreamSchema = incomingEdge?.source
    ? nodeSchemas[incomingEdge.source]
    : null;
  const columns = useMemo(
    () =>
      (upstreamSchema || [])
        .map((col: any) => ({
          name: col.name || col.column_name,
          type: String(col.type || ""),
        }))
        .filter(
          (col: { name: string; type: string }) =>
            !EXCLUDED_COLUMNS.has(col.name.toLowerCase()) &&
            !col.name.toLowerCase().startsWith("__alur_"),
        ),
    [upstreamSchema],
  );
  const columnNames = useMemo(() => columns.map((col) => col.name), [columns]);
  const geometryColumns = useMemo(
    () =>
      columns
        .filter(
          (col) =>
            col.type.toLowerCase().includes("geometry") ||
            col.type.toLowerCase().includes("wkb"),
        )
        .map((col) => col.name),
    [columns],
  );

  const operation = config.operation || "h3_latlng_to_cell";
  const op = h3OperationById(operation) ?? h3Operations[0];

  const encodeErrors = useMemo(() => h3NodeErrors(op, config), [op, config]);
  const polyfillErrors = useMemo(() => h3PolyfillErrors(config), [config]);
  const errors = mode === "polyfill" ? polyfillErrors : encodeErrors;
  const operationOptions = h3Operations.map((item) => ({
    value: item.id,
    label: item.label,
    description: item.summary,
  }));

  const fieldSelect = (
    label: string,
    value: string,
    onChange: (next: string) => void,
    pool: string[] = columnNames,
  ) => (
    <div>
      <label className={cn(fieldLabelClass, "mb-1")}>{label}</label>
      <select
        className={selectClass}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Choose column…</option>
        {pool.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );

  const modeControl = (
    <div className="grid grid-cols-2 gap-1 rounded-md bg-slate-100 p-0.5">
      {(
        [
          { value: "encode", label: "Encode" },
          { value: "polyfill", label: "Polyfill" },
        ] as const
      ).map((item) => (
        <button
          key={item.value}
          type="button"
          onClick={() => updateConfig({ mode: item.value })}
          className={cn(
            "rounded px-2 py-1 text-[11px] font-medium transition-colors",
            mode === item.value
              ? "bg-white text-cyan-700 shadow-sm ring-1 ring-cyan-200"
              : "text-slate-500 hover:text-slate-700",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );

  return (
    <FlowNodeShell
      id={id}
      selected={selected}
      tone="cyan"
      icon={Hexagon}
      label="H3 Op"
      title={mode === "polyfill" ? "H3 Polyfill" : op.label}
      helperContent={
        mode === "polyfill" ? (
          <>
            <div className="font-semibold text-slate-800">H3 Polyfill</div>
            <div>
              Cover each polygon with H3 cells, then dissolve back to one row
              per cell with its attributes encoded on (count, sum or average).
              Lines can be buffered first.
            </div>
            <div className="text-[11px] text-slate-500">
              Adds:{" "}
              <span className="font-mono">
                {config.resultField || "cell_value"}
              </span>{" "}
              + <span className="font-mono">feature_count</span> +{" "}
              <span className="font-mono">geometry</span>
            </div>
          </>
        ) : (
          <>
            <div className="font-semibold text-slate-800">{op.label}</div>
            <div>{op.summary}</div>
            <div className="text-[11px] text-slate-500">
              Adds:{" "}
              <span className="font-mono">
                {config.resultField || op.resultField}
              </span>{" "}
              ({op.resultHint})
            </div>
          </>
        )
      }
    >
      {modeControl}

      {mode === "polyfill" ? (
        <>
          {fieldSelect(
            "Geometry column",
            config.geometryField || "",
            (v) => updateConfig({ geometryField: v }),
            geometryColumns.length ? geometryColumns : columnNames,
          )}
          <div>
            <label className={cn(fieldLabelClass, "mb-1")}>Resolution</label>
            <input
              type="number"
              min={0}
              max={15}
              value={config.resolution ?? 9}
              onChange={(event) =>
                updateConfig({ resolution: Number(event.target.value) })
              }
              className={inputClass}
            />
          </div>
          <div>
            <label className={cn(fieldLabelClass, "mb-1")}>
              Encode attributes
            </label>
            <select
              className={selectClass}
              value={config.aggregate || "count"}
              onChange={(event) =>
                updateConfig({ aggregate: event.target.value })
              }
            >
              {h3PolyfillAggregates.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          {(config.aggregate === "sum" || config.aggregate === "avg") &&
            fieldSelect("Value column", config.valueField || "", (v) =>
              updateConfig({ valueField: v }),
            )}
          <div>
            <label className={cn(fieldLabelClass, "mb-1")}>Result column</label>
            <input
              type="text"
              value={config.resultField || "cell_value"}
              placeholder="cell_value"
              onChange={(event) =>
                updateConfig({ resultField: event.target.value })
              }
              className={inputClass}
            />
          </div>
          <div>
            <label className={cn(fieldLabelClass, "mb-1")}>
              Buffer distance{" "}
              <span className="font-normal text-slate-400">
                (geometry units, 0 = off)
              </span>
            </label>
            <input
              type="number"
              min={0}
              step="any"
              value={config.buffer ?? 0}
              onChange={(event) =>
                updateConfig({ buffer: Number(event.target.value) })
              }
              className={inputClass}
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-slate-50/60 px-2 py-1.5">
            <input
              type="checkbox"
              checked={config.includeGeometry !== false}
              onChange={(event) =>
                updateConfig({ includeGeometry: event.target.checked })
              }
              className="h-3.5 w-3.5 rounded border-slate-300 text-cyan-600 accent-cyan-600"
            />
            <span className="text-[11px] text-slate-600">
              Include cell geometry{" "}
              <span className="font-normal text-slate-400">
                (off = pure table for Parquet/CSV export)
              </span>
            </span>
          </label>
        </>
      ) : (
        <>
          <div>
            <label className={cn(fieldLabelClass, "mb-1")}>Operation</label>
            <TypeaheadSelect
              value={operation}
              options={operationOptions}
              onChange={(nextOperation) =>
                updateConfig({ operation: nextOperation })
              }
              placeholder="Search H3 operations…"
            />
          </div>

          {op.inputs.includes("cell") &&
            fieldSelect("Cell column", config.cellField || "", (v) =>
              updateConfig({ cellField: v }),
            )}
          {op.inputs.includes("lat") &&
            fieldSelect("Latitude column", config.latField || "", (v) =>
              updateConfig({ latField: v }),
            )}
          {op.inputs.includes("lng") &&
            fieldSelect("Longitude column", config.lngField || "", (v) =>
              updateConfig({ lngField: v }),
            )}

          {op.needsResolution && (
            <div>
              <label className={cn(fieldLabelClass, "mb-1")}>Resolution</label>
              <input
                type="number"
                min={0}
                max={15}
                value={config.resolution ?? 9}
                onChange={(event) =>
                  updateConfig({ resolution: Number(event.target.value) })
                }
                className={inputClass}
              />
            </div>
          )}

          <div>
            <label className={cn(fieldLabelClass, "mb-1")}>Result column</label>
            <input
              type="text"
              value={config.resultField || op.resultField}
              placeholder={op.resultField}
              onChange={(event) =>
                updateConfig({ resultField: event.target.value })
              }
              className={inputClass}
            />
          </div>
        </>
      )}

      {errors.map((error) => (
        <p key={error} className="text-[10px] text-rose-600">
          {error}
        </p>
      ))}

      <Handle
        type="target"
        position={Position.Left}
        className={nodeHandleClass("cyan")}
      />
      <Handle
        type="source"
        position={Position.Right}
        className={nodeHandleClass("cyan")}
      />
    </FlowNodeShell>
  );
};
