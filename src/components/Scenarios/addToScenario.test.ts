import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../store/useStore';
import type { AnalysisVariant, VariantOperation } from '../../types/visualAnalytics';

/**
 * The contract `AddToScenario` relies on, exercised through the store rather
 * than the component.
 *
 * The component is a select and a button; what matters is that a bench's output
 * lands *on a scenario* — as an operation, with the node attributed to it — and
 * that adding to an existing scenario appends rather than replaces. That is all
 * store behaviour, and testing it here keeps the assertions about the model
 * instead of about markup.
 */

const operation = (id: string, type = 'weighted-score'): VariantOperation => ({
  id,
  type,
  parameters: { resultField: 'alur_score' },
  assumptions: ['Missing numeric values contribute zero.'],
});

const variant = (id: string, overrides: Partial<AnalysisVariant> = {}): AnalysisVariant => ({
  id,
  name: id,
  baselineDatasetId: 'ds',
  parameters: {},
  assumptions: [],
  operations: [],
  createdAt: 1,
  provenance: { workflowNodeIds: [] },
  ...overrides,
});

const variants = () => useStore.getState().visualAnalytics.variants;

describe('adding a bench result to a scenario', () => {
  beforeEach(() => {
    useStore.getState().resetWorkspace();
  });

  it('stamps a new scenario with the open question', () => {
    const store = useStore.getState();
    store.createSession({ id: 'session-1', name: 'Clinics', question: '', baselineDatasetId: 'ds' });
    store.addVariant(variant('v1', { operations: [operation('op-1')] }));

    expect(variants()[0].sessionId).toBe('session-1');
  });

  it('appends to an existing scenario rather than replacing its operations', () => {
    const store = useStore.getState();
    store.addVariant(variant('v1', { operations: [operation('op-1')] }));

    const existing = variants().find((item) => item.id === 'v1')!;
    useStore.getState().updateVariant('v1', {
      operations: [...existing.operations, operation('op-2', 'ranked-selection')],
    });

    const updated = variants().find((item) => item.id === 'v1')!;
    expect(updated.operations.map((item) => item.id)).toEqual(['op-1', 'op-2']);
  });

  it('attributes the emitted node to the scenario it was added to', () => {
    const store = useStore.getState();
    store.addVariant(variant('v1'));

    const current = variants().find((item) => item.id === 'v1')!;
    useStore.getState().updateVariant('v1', {
      provenance: { ...current.provenance, workflowNodeIds: [...current.provenance.workflowNodeIds, 'score-9'] },
    });

    expect(variants().find((item) => item.id === 'v1')!.provenance.workflowNodeIds).toEqual(['score-9']);
  });

  it('does not duplicate an assumption the scenario already carries', () => {
    const store = useStore.getState();
    const shared = 'Missing numeric values contribute zero.';
    store.addVariant(variant('v1', { assumptions: [shared] }));

    const existing = variants().find((item) => item.id === 'v1')!;
    const incoming = operation('op-2').assumptions ?? [];
    useStore.getState().updateVariant('v1', {
      assumptions: [
        ...existing.assumptions,
        ...incoming.filter((text) => !existing.assumptions.includes(text)),
      ],
    });

    expect(variants().find((item) => item.id === 'v1')!.assumptions).toEqual([shared]);
  });

  it('keeps a scenario selected once something has been added to it', () => {
    const store = useStore.getState();
    store.addVariant(variant('v1'));
    store.setActiveVariant('v1');

    expect(useStore.getState().visualAnalytics.activeVariantId).toBe('v1');
  });

  it('clears the selected scenario when the question changes', () => {
    const store = useStore.getState();
    store.createSession({ id: 'session-1', name: 'Clinics', question: '', baselineDatasetId: 'ds' });
    store.addVariant(variant('v1'));
    store.setActiveVariant('v1');

    useStore.getState().setActiveSession(undefined);

    // A scenario belongs to one question; leaving it selected would leave the
    // bar naming something the panel beside it no longer lists.
    expect(useStore.getState().visualAnalytics.activeVariantId).toBeUndefined();
  });
});
