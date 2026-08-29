/**
 * The package a calculation arrives in.
 *
 * Before this, ALUR was pointed at a JavaScript module directly. That worked and
 * had three costs worth removing:
 *
 * - **One module, one calculation.** A library that can do a dozen useful things
 *   had to publish a dozen URLs, and the analyst had to know all of them.
 * - **Nothing was known before the code ran.** Name, version and contents could
 *   only be discovered by importing and executing.
 * - **Relative imports resolved against wherever the URL was pasted**, so an
 *   entry importing `../dist/index.js` needed the analyst to serve from exactly
 *   the right directory — a footgun that reads as a missing file.
 *
 * A plugin manifest fixes all three. It is fetched and validated as data first,
 * lists what is inside, and anchors `entry` to its own location rather than to
 * whatever the analyst typed.
 */

/**
 * The contract revision a plugin was written against.
 *
 * Bumped only when a change would break a plugin that did not change. ALUR
 * refuses a plugin declaring a revision it does not know, which is a clearer
 * failure than the shape mismatch that would otherwise surface deep inside a
 * worker.
 */
export const OPERATION_CONTRACT_REVISION = 1 as const;

/** One calculation the package contains, as advertised before anything runs. */
export type PluginCalculationSummary = {
  /** Must equal the `id` of the manifest the entry actually exports. */
  id: string;
  label: string;
  summary?: string;
  /** Mirrors the manifest's `group`, so a package can be browsed before it runs. */
  group?: string;
};

export type PluginManifest = {
  contract: number;
  /** Stable, lower-case, dot- or dash-separated. Namespacing is the author's job. */
  name: string;
  label: string;
  version: string;
  description?: string;
  /**
   * The ESM module exporting `providers`, resolved **relative to this file**.
   * That anchoring is the whole reason this manifest is a separate fetch.
   */
  entry: string;
  homepage?: string;
  license?: string;
  /**
   * What the entry exports, declared so the analyst can see it before any code
   * runs. Checked against the real manifests on load: a package that advertises
   * a calculation it does not export is rejected, because the alternative is a
   * catalogue that lies.
   */
  calculations: PluginCalculationSummary[];
};

/** What a plugin's entry module must expose. */
export type PluginModule = {
  providers?: unknown;
  /** The single-provider form, still accepted. */
  provider?: unknown;
  default?: unknown;
};

/**
 * A directory of plugins ALUR offers in its loader.
 *
 * Ships empty, and that is deliberate rather than unfinished. ALUR contains no
 * analytical calculation and names no analytical domain; a catalogue populated
 * in this repository would put both back. It is a file the deployer fills in —
 * the same standing the empty `src/providers/index.ts` has, and checkable the
 * same way.
 */
export type PluginCatalogue = {
  contract: number;
  plugins: Array<{
    name: string;
    label: string;
    description?: string;
    /** Absolute or app-relative URL of the plugin manifest. */
    url: string;
  }>;
};
