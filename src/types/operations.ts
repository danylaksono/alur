/**
 * The extension point for calculations ALUR does not itself contain.
 *
 * ALUR registers three kinds of capability. `spatialFunctions` is a flat
 * registry of DuckDB functions an Analysis node can select; `WorkflowFragment`
 * lets the analyst name and reuse a run of nodes. Both are open, and neither can
 * introduce arithmetic the engine does not already have — a fragment composes
 * what exists, and a spatial function is whatever DuckDB shipped. A plugin is
 * the third member of that family: code, supplied from outside, that the
 * workspace can call.
 *
 * **The contract itself now lives in `@alur/operation-contract`**, a package a
 * plugin author installs. It moved out of this file because a contract only one
 * side can compile against is a contract only one side can get right: the first
 * externally written plugin declared `options` as objects where the renderer
 * wanted strings, and a `semanticType` of `"quantitative"`, which is not one of
 * the seven. Both passed validation. Both are type errors now.
 *
 * This file stays as the import site the rest of ALUR uses, so nothing inside
 * the app has to know where the types come from.
 */

export type {
  GeometryKind,
  FieldSemanticType,
  OperationParameter,
  OperationParameterOption,
  OperationFieldRole,
  OperationInputSpec,
  OperationReferent,
  OperationChangeSpec,
  OperationOutputSpec,
  OperationMeasureSpec,
  OperationManifest,
  OperationInputSource,
  OperationInputBinding,
  OperationTarget,
  OperationChange,
  OperationInputData,
  OperationOutputData,
  OperationRunResult,
  OperationInstance,
  OperationCreateContext,
  OperationProvider,
  PluginManifest,
  PluginModule,
  PluginCalculationSummary,
  PluginCatalogue,
} from '../../packages/operation-contract/src/index';

export {
  OPERATION_CONTRACT_REVISION,
  operationManifestErrors,
  optionLabel,
  optionValue,
  parameterOptionValues,
  pluginContentErrors,
  pluginManifestErrors,
} from '../../packages/operation-contract/src/index';
