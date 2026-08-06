import { describe, expect, it } from 'vitest';
import { PROVENANCE_SCHEMA_VERSION, type ProvenanceEvent } from '../types/provenance';
import {
  PROVENANCE_EVENT_LIMIT,
  appendProvenanceEvent,
  createProvenanceEvent,
  createProvenanceId,
  eventsForVariant,
  summariseProvenance,
} from './provenance';

describe('Provenance events', () => {
  it('stamps schema version, agent and a generated summary', () => {
    const event = createProvenanceEvent({
      activity: 'variant.created',
      variantId: 'v1',
      payload: { name: 'High ambition' },
    });
    expect(event.schemaVersion).toBe(PROVENANCE_SCHEMA_VERSION);
    expect(event.agent.type).toBe('user');
    expect(event.entityType).toBe('variant');
    expect(event.entityId).toBe('v1');
    expect(event.summary).toBe('Created variant “High ambition”');
  });

  it('mints unique ids for events emitted within the same millisecond', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createProvenanceId('prov-event')));
    expect(ids.size).toBe(50);
  });

  it('keeps the caller-supplied summary when one is given', () => {
    const event = createProvenanceEvent({ activity: 'workflow.ran', summary: 'Custom sentence' });
    expect(event.summary).toBe('Custom sentence');
  });

  it('copies used and generated rather than aliasing the caller arrays', () => {
    const used = ['d1'];
    const event = createProvenanceEvent({ activity: 'workflow.ran', used });
    used.push('d2');
    expect(event.used).toEqual(['d1']);
  });
});

describe('Provenance summaries', () => {
  it('describes derivation with both ends named', () => {
    expect(summariseProvenance('variant.branched', { name: 'Variant B', parentName: 'Variant A' })).toBe(
      'Branched “Variant B” from “Variant A”',
    );
  });

  it('reports what a filter excluded, which is the Filter diagnostic', () => {
    expect(summariseProvenance('filter.applied', { description: 'EPC below D', removedCount: 1240 })).toBe(
      'Filtered on EPC below D, excluding 1,240 rows',
    );
  });

  it('ranks weights and elides the tail', () => {
    expect(
      summariseProvenance('weights.changed', { weights: { carbon: 0.5, poverty: 0.3, grid: 0.15, other: 0.05 } }),
    ).toBe('Changed weights to carbon 50%, poverty 30%, grid 15% and 1 more');
  });

  it('drops zero and non-numeric weights instead of reporting them as criteria', () => {
    expect(summariseProvenance('weights.changed', { weights: { carbon: 1, unused: 0, broken: 'x' } })).toBe(
      'Changed weights to carbon 100%',
    );
  });

  it('falls back cleanly when a payload is missing its detail', () => {
    expect(summariseProvenance('workflow.ran', {})).toBe('Ran the workflow');
    expect(summariseProvenance('filter.cleared', {})).toBe('Cleared all filters');
    expect(summariseProvenance('variant.created', {})).toBe('Created variant “untitled”');
  });

  it('uses singular forms for a count of one', () => {
    expect(summariseProvenance('sweep.ran', { variantCount: 1 })).toBe('Ran the workflow across 1 variant');
  });
});

describe('Provenance log', () => {
  const event = (id: string, overrides: Partial<ProvenanceEvent> = {}) =>
    ({ ...createProvenanceEvent({ activity: 'workflow.ran' }), id, ...overrides }) as ProvenanceEvent;

  it('appends without mutating the existing log', () => {
    const log = [event('a')];
    const next = appendProvenanceEvent(log, event('b'));
    expect(log).toHaveLength(1);
    expect(next.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('trims the oldest events once the log is full, keeping the recent account', () => {
    const full = Array.from({ length: PROVENANCE_EVENT_LIMIT }, (_, index) => event(`e${index}`));
    const next = appendProvenanceEvent(full, event('newest'));
    expect(next).toHaveLength(PROVENANCE_EVENT_LIMIT);
    expect(next[0].id).toBe('e1');
    expect(next[next.length - 1].id).toBe('newest');
  });

  it('collapses a continuous gesture into where it landed', () => {
    const drag = (weight: number, at: string) =>
      createProvenanceEvent({
        activity: 'weights.changed',
        coalesceKey: 'node:n1:weights',
        timestamp: at,
        payload: { weights: { carbon: weight } },
      });
    const log = [drag(0.2, '2026-08-05T10:00:00.000Z'), drag(0.5, '2026-08-05T10:00:00.300Z')].reduce(
      appendProvenanceEvent,
      [] as ProvenanceEvent[],
    );
    expect(log).toHaveLength(1);
    // The surviving event is where the drag ended, not where it began.
    expect(log[0].summary).toBe('Changed weights to carbon 50%');
  });

  it('keeps a later gesture separate once the window has passed', () => {
    const drag = (at: string) =>
      createProvenanceEvent({ activity: 'weights.changed', coalesceKey: 'node:n1:weights', timestamp: at });
    const log = [drag('2026-08-05T10:00:00.000Z'), drag('2026-08-05T10:00:05.000Z')].reduce(
      appendProvenanceEvent,
      [] as ProvenanceEvent[],
    );
    expect(log).toHaveLength(2);
  });

  it('never collapses events that carry no gesture key', () => {
    const log = [
      createProvenanceEvent({ activity: 'workflow.ran', timestamp: '2026-08-05T10:00:00.000Z' }),
      createProvenanceEvent({ activity: 'workflow.ran', timestamp: '2026-08-05T10:00:00.010Z' }),
    ].reduce(appendProvenanceEvent, [] as ProvenanceEvent[]);
    expect(log).toHaveLength(2);
  });

  it('finds a variant whether it was the subject, an input or an output', () => {
    const log = [
      event('subject', { variantId: 'v1' }),
      event('input', { used: ['v1'] }),
      event('output', { generated: ['v1'] }),
      event('unrelated', { variantId: 'v2', entityId: 'v2' }),
    ];
    expect(eventsForVariant(log, 'v1').map((item) => item.id)).toEqual(['subject', 'input', 'output']);
  });
});
