import type { OperationProvider, PluginManifest } from '../types/operations';
import { thinBySpacing } from './bundled/thinBySpacing';
import { nearestWithCapacity } from './bundled/nearestWithCapacity';
import { clusterByDistance } from './bundled/clusterByDistance';
import { phasedAllocation } from './bundled/phasedAllocation';

/**
 * The plugin ALUR ships with, and the standing of what is in it.
 *
 * This file used to be empty, and its emptiness was the artifact a reviewer read
 * to check that ALUR contained no analytical calculation. That claim now needs
 * stating more carefully rather than abandoning, and the structure is what
 * states it: these are *providers*, registered through the same registry, loaded
 * through the same host and declared by the same manifest as anything fetched
 * from a URL. ALUR's core still contains no calculation — `services/`,
 * `components/` and `store/` name none of these and would work identically with
 * this list empty. What ships is a default plugin set, which is the same
 * separation QGIS draws between its core and the processing providers it
 * happens to bundle.
 *
 * The bar for adding one is therefore high and worth writing down:
 *
 * 1. **It cannot be a workflow node.** If a `SELECT` expresses it, it is a node
 *    or a fragment. Every calculation here is sequential or transitive — the
 *    answer for one row depends on the answers already given for others, which
 *    is precisely what set-based SQL cannot do.
 * 2. **It names no domain.** Not the label, not a field role, not a parameter,
 *    not a warning string. "Demand" and "supply" are shapes; "patients" and
 *    "surgeries" would be a domain.
 * 3. **It uses only what an external plugin could.** No store, no map, no
 *    services. The moment a bundled provider reaches into ALUR, "bundled" stops
 *    meaning "shipped alongside" and starts meaning "privileged".
 *
 * The reference provider under `reference/` is deliberately *not* here. It means
 * nothing, and a meaningless entry in the toolbox would be worse than a short
 * one.
 *
 * `phasedAllocation` has a lineage worth stating: its behaviour was specified by
 * the `interactive-scenario-modeller` adapter, which had already been validated
 * against real stock data, and the two are checked to agree scenario by scenario.
 * The code here is nonetheless written against this contract alone. Depending on
 * that library instead was the obvious alternative and was rejected — it is not
 * on npm, it exports its whole domain plugin surface from one barrel, and
 * bundling it would have made ALUR contain the library whose independence is the
 * thing the plugin system exists to demonstrate.
 */

export const BUNDLED_PROVIDERS: OperationProvider[] = [
  thinBySpacing,
  nearestWithCapacity,
  clusterByDistance,
  phasedAllocation,
];

export const BUNDLED_PLUGIN: PluginManifest = {
  contract: 1,
  name: 'alur',
  label: 'ALUR',
  version: '1.0.0',
  description: 'Calculations that ship with ALUR, for work a query cannot express.',
  // Never fetched: the bundled set is imported, not loaded by URL. The field is
  // required by the manifest shape and this is the honest value for it.
  entry: './index.ts',
  license: 'MIT',
  calculations: BUNDLED_PROVIDERS.map((provider) => ({
    id: provider.manifest.id,
    label: provider.manifest.label,
    summary: provider.manifest.description,
    group: provider.manifest.group,
  })),
};
