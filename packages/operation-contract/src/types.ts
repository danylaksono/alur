/**
 * The calculation contract, and the single place it is defined.
 *
 * This package exists because the contract crosses a repository boundary. ALUR
 * compiles against it, and so does every plugin — which means an author gets the
 * same checking ALUR gets, instead of copying shapes out of a document by eye.
 * Two bugs in the first plugin written against the prose version motivated it:
 * `options` given as `{value, label}` objects where the renderer wanted strings,
 * and a `semanticType` of `"quantitative"`, which is not one of the seven.
 * Both passed validation. Both are now type errors.
 *
 * Nothing here imports from ALUR, and nothing here may. The interface is
 * structural on purpose: a plugin depends on this package for types alone, and
 * a plugin that skips it and hand-writes the shapes is still a valid plugin.
 */

/** The geometry kinds ALUR can hold and draw. */
export type GeometryKind = 'point' | 'line' | 'polygon';

/** What a column means, independent of its storage type. */
export type FieldSemanticType =
  | 'numeric'
  | 'categorical'
  | 'boolean'
  | 'temporal'
  | 'identifier'
  | 'geometry'
  | 'unknown';

/**
 * One option of a `choice` parameter.
 *
 * Plain strings are accepted so the shorter form stays available, and the object
 * form exists because a value the machine wants (`higher`) is rarely the words a
 * reader wants ("Higher values first"). Before this, an author had to choose
 * between a readable form and a sensible value.
 */
export type OperationParameterOption = string | { value: string; label: string };

/**
 * A value the analyst supplies. Reused for provider settings and for the values
 * carried alongside a change.
 *
 * Free text is deliberately absent — these values reach both SQL and a provider
 * boundary, and an unconstrained string would be a way to smuggle anything into
 * either.
 */
export type OperationParameter = {
  id: string;
  label: string;
  type: 'number' | 'field' | 'choice';
  defaultValue?: string | number;
  /** Required when `type` is `'choice'`. */
  options?: OperationParameterOption[];
  description?: string;
};

/** The value an option carries, whichever form it was written in. */
export const optionValue = (option: OperationParameterOption): string =>
  typeof option === 'string' ? option : option.value;

/** The words shown for an option, falling back to its value. */
export const optionLabel = (option: OperationParameterOption): string =>
  typeof option === 'string' ? option : option.label || option.value;

/** Every value a choice parameter permits. */
export const parameterOptionValues = (parameter: OperationParameter): string[] =>
  (parameter.options ?? []).map(optionValue);

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
  /**
   * Whether several datasets may be bound to this one input, concatenated.
   *
   * The reason this is worth having is that role binding already solved the hard
   * part. Each bound dataset maps its own column names onto the same roles, so a
   * three-column layer the analyst drew and a sixty-column table they loaded
   * unify without any schema surgery — which is what makes "draw some more
   * candidates and re-run" a binding change rather than a pipeline change.
   *
   * Every feature gains an `__alur_source` property naming the dataset it came
   * from, so a provider that wants to tell them apart can.
   */
  multiple?: boolean;
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
   * Which field role the row ids of a `rows` target hold values of.
   *
   * The mirror of `joinFieldRole` on an output, and it exists for the same
   * reason: without it a provider has to guess which bound column the shell's
   * selection is expressed in, and a wrong guess silently matches nothing.
   * Defaults to the input's first required identifier role.
   */
  targetFieldRole?: string;
  /** Values the analyst supplies alongside the change. */
  parameters: OperationParameter[];
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
 * Everything ALUR knows about a calculation before running it.
 *
 * Strictly serialisable — no functions, no class instances. The manifest crosses
 * a worker boundary, is cached, and is fetched from a URL, so anything that
 * cannot survive `structuredClone` does not belong in it.
 */
export type OperationManifest = {
  id: string;
  label: string;
  description: string;
  version: string;
  /**
   * Where this sits in the toolbox, under its plugin.
   *
   * Free text, and the author's to choose — a toolbox with one flat list of
   * every calculation is unreadable once more than one plugin is installed, and
   * grouping is the only thing that makes a growing set browsable. Calculations
   * with no group are shown directly under their plugin.
   */
  group?: string;
  /**
   * Extra words the toolbox search should match, beyond the label and
   * description. For the names people reach for that an author would not put in
   * a label — an algorithm's common name, or what it is called elsewhere.
   */
  keywords?: string[];
  inputs: OperationInputSpec[];
  /**
   * Assumptions with no spatial referent — travel speeds, a decay rate, a
   * capacity ceiling. Kept apart from `accepts` deliberately: a change with a
   * location is something the analyst asserted about a place, a value without
   * one is a setting, and conflating them makes the record unreadable.
   */
  parameters: OperationParameter[];
  accepts: OperationChangeSpec[];
  outputs: OperationOutputSpec[];
  measure?: OperationMeasureSpec;
};

/** One dataset bound to one input, with its own columns mapped to the roles. */
export type OperationInputSource = {
  datasetId: string;
  /** Role id to column name, in this dataset. */
  fields: Record<string, string>;
};

/**
 * Where the analyst's data meets a declared input role.
 *
 * A list rather than a single dataset because an input may declare `multiple`.
 * A binding with one source is the ordinary case and reads no worse for it.
 */
export type OperationInputBinding = {
  inputId: string;
  sources: OperationInputSource[];
};

/** The referent of one recorded change, resolved. */
export type OperationTarget =
  | { kind: 'rows'; datasetId: string; rowIds: string[] }
  | { kind: 'geometry'; datasetId?: string; geometry: GeoJSON.Geometry };

/**
 * One change as handed to a provider. The record persisted in the project is
 * ALUR's own, and this is its resolved form, carrying the ordering the provider
 * is expected to honour.
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
  /**
   * Role id to the property name carrying it.
   *
   * Since inputs may concatenate several datasets whose columns are named
   * differently, the shell projects every bound role onto a canonical property
   * name and this map points at those. Reading a value as
   * `feature.properties[fields.cost]` is correct either way, which is why
   * providers written before `multiple` existed keep working.
   */
  fields: Record<string, string>;
  /** GeoJSON text for spatial inputs; the provider parses it itself. */
  geojson?: string;
  /** Plain rows for inputs declared `geometry: 'none'`. */
  rows?: Array<Record<string, unknown>>;
  /** The datasets that were concatenated, in binding order. */
  sources?: Array<{ datasetId: string; label: string; count: number }>;
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
 * A loaded calculation, holding whatever state it needs between runs.
 *
 * The lifecycle is split because real engines are expensive to load and cheap to
 * re-run. Building a routable graph from a national road extract costs seconds;
 * recomputing after one segment changes costs milliseconds. A stateless
 * `run(rows) -> rows` contract would pay the load cost on every edit, which is
 * why this one does not have that shape.
 */
export interface OperationInstance {
  /**
   * Make the provider's state equal exactly this ordered list of changes — not
   * "additionally apply these".
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
