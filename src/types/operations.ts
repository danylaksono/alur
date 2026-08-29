import type { GeometryKind } from './visualisation';
import type { FieldSemanticType } from './datasets';
import type { FragmentParameter } from '../utils/workflowFragments';

/**
 * The extension point for calculations ALUR does not itself contain.
 *
 * ALUR already registers two kinds of capability. `spatialFunctions` is a flat
 * registry of DuckDB functions an Analysis node can select; `WorkflowFragment`
 * lets the analyst name and reuse a run of nodes. Both are open, and neither can
 * introduce arithmetic the engine does not already have — a fragment composes
 * what exists, and a spatial function is whatever DuckDB shipped. A provider is
 * the third member of that family: code, supplied from outside, that the
 * workflow can call.
 *
 * Everything here is deliberately free of analytical vocabulary. A provider
 * declares *shapes* — how many inputs it reads, which field roles it needs
 * bound, what changes it accepts, what relations it emits — and ALUR generates
 * the interface from that declaration. Nothing outside a provider's own package
 * may name what the calculation does.
 */

/**
 * A column a provider needs, described by the role it plays rather than by the
 * name it happens to carry. The analyst binds each role to a real column, which
 * is why a provider written against one dataset works against another whose
 * columns are named differently.
 */
export type OperationFieldRole = {
  id: string;
  label: string;
  semanticType: FieldSemanticType;
  required: boolean;
  description?: string;
};

/**
 * One named relation a provider reads.
 *
 * Plural at the type level on purpose: a real engine rarely takes a single
 * table. A reachability calculation wants a network, a set of origins and a set
 * of destinations, and it has to tell them apart — so inputs are addressed by
 * role id, never by handle order.
 */
export type OperationInputSpec = {
  id: string;
  label: string;
  description?: string;
  /**
   * `'none'` for an attribute-only table; `'any'` when the provider accepts
   * whatever geometry the analyst binds.
   */
  geometry: GeometryKind | 'any' | 'none';
  fields: OperationFieldRole[];
};

/**
 * How the analyst points at the thing a change applies to.
 *
 * `rows` changes units that already exist — a selection resolved to row ids.
 * `point` and `geometry` are changes whose referent is a location: placing
 * something that was not there, or asserting a change somewhere the data has no
 * row for yet. What a location means is the provider's business; ALUR only has
 * to carry it.
 */
export type OperationReferent = 'rows' | 'point' | 'geometry';

/**
 * A kind of change a provider accepts.
 *
 * This is what the change editor is generated from. A provider that declares one
 * of these gets a working interface — a selection, a form built from
 * `parameters`, and a record written on confirm — without contributing any UI.
 */
export type OperationChangeSpec = {
  id: string;
  label: string;
  description?: string;
  /** Which declared input this change acts on. */
  inputId: string;
  referent: OperationReferent;
  /**
   * Values the analyst supplies alongside the change. Reuses the fragment
   * parameter vocabulary — `number | field | choice`, free text excluded on
   * purpose, because these values reach both SQL and a provider boundary.
   */
  parameters: FragmentParameter[];
};

/**
 * A relation a provider emits.
 *
 * `join` merges back onto one of the inputs by row key — a value per unit.
 * `dataset` is a relation that did not exist before and becomes an ordinary ALUR
 * dataset, geometry included. Both are needed: a calculation can return a number
 * per settlement *and* a set of derived segments to draw.
 */
export type OperationOutputSpec = {
  id: string;
  label: string;
  kind: 'join' | 'dataset';
  /** Required when `kind` is `'join'`: the input whose rows this keys to. */
  joinInputId?: string;
  /**
   * Which field role on that input the emitted `key` column holds values of.
   *
   * Stated rather than inferred: without it the shell has to guess which bound
   * column a provider keyed its results by, and a wrong guess produces a join
   * that silently matches nothing. Defaults to the input's first required
   * identifier role, which is right for every provider that has one.
   */
  joinFieldRole?: string;
  fields: Array<{ name: string; type: string }>;
  /** Only meaningful for `'dataset'` outputs. */
  geometry?: GeometryKind;
};

/**
 * The headline a provider nominates, so the comparison view can wire itself up
 * without being told about the provider. Optional: a provider that only produces
 * columns is legitimate, and the analyst can build a measure by hand.
 */
export type OperationMeasureSpec = {
  outputId: string;
  field: string;
  label: string;
  unit?: string;
  aggregation: 'sum' | 'mean' | 'median' | 'min' | 'max' | 'count';
  preferredDirection: 'higher' | 'lower';
};

/**
 * Everything ALUR knows about a provider before running it.
 *
 * Strictly serialisable — no functions, no class instances. The manifest crosses
 * a worker boundary, is cached, and may one day be fetched from a URL, so
 * anything that cannot survive `structuredClone` does not belong in it.
 */
export type OperationManifest = {
  id: string;
  label: string;
  description: string;
  version: string;
  inputs: OperationInputSpec[];
  /**
   * Assumptions with no spatial referent — travel speeds, a decay rate, a
   * capacity ceiling. Kept apart from `accepts` deliberately: a change with a
   * location is something the analyst asserted about a place, a value without
   * one is a setting, and conflating them makes the record unreadable.
   */
  parameters: FragmentParameter[];
  accepts: OperationChangeSpec[];
  outputs: OperationOutputSpec[];
  measure?: OperationMeasureSpec;
};

/** Where the analyst's data meets a declared input role. */
export type OperationInputBinding = {
  inputId: string;
  datasetId: string;
  /** Role id to column name. */
  fields: Record<string, string>;
};

/** The referent of one recorded change, resolved. */
export type OperationTarget =
  | { kind: 'rows'; datasetId: string; rowIds: string[] }
  | { kind: 'geometry'; datasetId?: string; geometry: GeoJSON.Geometry };

/**
 * One change as handed to a provider. The record persisted in the project is
 * `VariantOperation`; this is its resolved form, carrying the ordering the
 * provider is expected to honour.
 */
export type OperationChange = {
  id: string;
  /** The `OperationChangeSpec.id` this instantiates. */
  changeId: string;
  sequence: number;
  target: OperationTarget;
  values: Record<string, unknown>;
};

/** A relation handed to a provider, in whichever form its input declared. */
export type OperationInputData = {
  inputId: string;
  /** Bound column name per declared role, so the provider need not guess. */
  fields: Record<string, string>;
  /** GeoJSON text for spatial inputs; the provider parses it itself. */
  geojson?: string;
  /** Plain rows for inputs declared `geometry: 'none'`. */
  rows?: Array<Record<string, unknown>>;
};

export type OperationOutputData =
  | { kind: 'join'; rows: Array<Record<string, unknown>> }
  | { kind: 'dataset'; geojson: GeoJSON.FeatureCollection };

export type OperationRunResult = {
  /** Keyed by `OperationOutputSpec.id`. */
  outputs: Record<string, OperationOutputData>;
  /** Surfaced verbatim; a provider may report a boundary it hit. */
  warnings?: string[];
};

/**
 * A loaded provider, holding whatever state its calculation needs between runs.
 *
 * The lifecycle is split because real engines are expensive to load and cheap to
 * re-run. Building a routable graph from a national road extract costs seconds;
 * recomputing after one segment changes costs milliseconds. A stateless
 * `run(rows) -> rows` contract would pay the load cost on every edit, which is
 * why this one does not have that shape.
 */
export interface OperationInstance {
  /**
   * Make the provider's state equal to exactly this ordered list of changes —
   * not "additionally apply these".
   *
   * Declarative rather than incremental because it is what makes undo honest:
   * the state at sequence *n* is a pure function of the first *n* records, so
   * undoing and re-applying cannot drift. A provider able to diff against the
   * previous list is free to do so; one that cannot may rebuild.
   */
  setChanges(changes: OperationChange[]): Promise<void>;
  setParameters(values: Record<string, unknown>): Promise<void>;
  evaluate(): Promise<OperationRunResult>;
  dispose(): void;
}

export type OperationCreateContext = {
  inputs: OperationInputData[];
  parameters: Record<string, unknown>;
  signal?: AbortSignal;
};

export interface OperationProvider {
  manifest: OperationManifest;
  create(context: OperationCreateContext): Promise<OperationInstance>;
}
