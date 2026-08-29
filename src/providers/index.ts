import { registerOperationProvider } from '../services/operationRegistry';
import type { OperationProvider } from '../types/operations';

/**
 * Where calculation providers are installed.
 *
 * Empty on purpose. ALUR ships no analytical provider, and the day it ships one
 * is the day the domain-neutrality claim stops being checkable — a reviewer can
 * read this file and see for themselves that no calculation is bundled. The
 * reference provider under `reference/` is not registered here either: it means
 * nothing, and putting a meaningless entry in the palette would be worse than an
 * empty list.
 *
 * A provider is registered, not imported for its side effects, so that failing
 * to load one is reportable rather than silent. `installProviders` is called once
 * at start-up and returns what could not be installed instead of throwing, since
 * one bad provider must not take the app down with it.
 */

const BUNDLED: OperationProvider[] = [];

export type ProviderInstallReport = {
  installed: string[];
  failed: Array<{ id: string; reason: string }>;
};

export const installProviders = (providers: OperationProvider[] = BUNDLED): ProviderInstallReport => {
  const report: ProviderInstallReport = { installed: [], failed: [] };

  for (const provider of providers) {
    try {
      registerOperationProvider(provider);
      report.installed.push(provider.manifest.id);
    } catch (error) {
      report.failed.push({
        id: provider?.manifest?.id ?? 'unknown',
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return report;
};
