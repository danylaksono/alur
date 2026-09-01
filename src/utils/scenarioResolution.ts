import type { AnalysisVariant } from '../types/visualAnalytics';

/**
 * What "standing in a scenario" resolves to.
 *
 * Until now `activeVariantId` only decided which chip looked selected. A
 * scenario bar that changes nothing on screen is worse than no bar: it claims
 * the workspace has a state it does not have, and the analyst has to remember
 * that the map is still showing the baseline no matter which chip is lit.
 *
 * The rule is deliberately narrow. A scenario owns exactly one thing — the
 * dataset its run produced — so standing in it means that result is what the
 * workspace shows, and every *other* scenario's result gets out of the way.
 * Nothing else is reinterpreted: baseline data, reference layers and basemaps
 * are not scenario-owned and are left alone.
 */

/** Result datasets, by the scenario that produced them. */
export const scenarioOutputs = (variants: AnalysisVariant[]): Map<string, string> => {
  const byDataset = new Map<string, string>();
  for (const variant of variants) {
    if (variant.workflowOutputDatasetId) byDataset.set(variant.workflowOutputDatasetId, variant.id);
  }
  return byDataset;
};

/**
 * Whether a layer belongs to a scenario, and if so which.
 *
 * Derived from the variants rather than stored on the layer. A sweep already
 * names each run's output after its variant, so recording ownership twice would
 * only create somewhere for the two copies to disagree.
 */
export const scenarioOwning = (variants: AnalysisVariant[], layerId: string): string | undefined =>
  scenarioOutputs(variants).get(layerId);

export type LayerVisibility = { id: string; visible: boolean };

/**
 * Layer visibility for the scenario being stood in.
 *
 * Returns only the layers whose visibility must *change*, so a caller can skip
 * the update entirely when nothing moved — this runs on every scenario switch,
 * and switching is meant to be free.
 *
 * With no scenario selected the baseline is being viewed, and every scenario
 * result is hidden: showing all of them at once stacks results that are
 * alternatives to each other, which reads as one map rather than several.
 */
export const scenarioLayerVisibility = (
  layers: LayerVisibility[],
  variants: AnalysisVariant[],
  activeVariantId: string | undefined,
): LayerVisibility[] => {
  const owners = scenarioOutputs(variants);
  const changes: LayerVisibility[] = [];

  for (const layer of layers) {
    const owner = owners.get(layer.id);
    // Not a scenario result — the analyst's own visibility choice stands.
    if (!owner) continue;
    const shouldShow = owner === activeVariantId;
    if (layer.visible !== shouldShow) changes.push({ id: layer.id, visible: shouldShow });
  }

  return changes;
};

/**
 * The dataset a surface should read while standing in a scenario.
 *
 * Substitutes only for the scenario's own baseline: asking for an unrelated
 * dataset while a scenario is open still returns that dataset, because a
 * scenario is a claim about one line of analysis and not a lens over the whole
 * project. Falls through to the requested id when the scenario has not run,
 * which is the honest answer — there is no result to show yet.
 */
export const resolveScenarioDataset = (
  datasetId: string,
  variant: AnalysisVariant | undefined,
  registry: Record<string, unknown>,
): string => {
  if (!variant?.workflowOutputDatasetId) return datasetId;
  if (datasetId !== variant.baselineDatasetId) return datasetId;
  return registry[variant.workflowOutputDatasetId] ? variant.workflowOutputDatasetId : datasetId;
};
