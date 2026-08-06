import { describe, expect, it } from 'vitest';
import type { WorkflowNode } from '../store/useStore';
import { MissingParameterError, indicativeParameters, parametersUsed, resolveNodeParameters } from './workflowParameters';

const node = (id: string, config: unknown): WorkflowNode =>
  ({ id, type: 'filter', position: { x: 0, y: 0 }, data: { label: id, type: 'filter', config } }) as WorkflowNode;

describe('workflow parameters', () => {
  it('substitutes a reference with the variant value', () => {
    const [resolved] = resolveNodeParameters([node('n1', { field: 'epc', max: { $param: 'cutoff' } })], { cutoff: 40 });
    expect(resolved.data.config).toEqual({ field: 'epc', max: 40 });
  });

  it('reaches references nested in objects and arrays', () => {
    const config = { scoreModel: { criteria: [{ field: 'a', weight: { $param: 'w' } }, { field: 'b', weight: 1 }] } };
    const [resolved] = resolveNodeParameters([node('n1', config)], { w: 0.25 });
    expect(resolved.data.config.scoreModel.criteria[0].weight).toBe(0.25);
    expect(resolved.data.config.scoreModel.criteria[1].weight).toBe(1);
  });

  it('falls back to the declared default, so the graph still runs outside a sweep', () => {
    const [resolved] = resolveNodeParameters([node('n1', { max: { $param: 'cutoff', default: 20 } })], {});
    expect(resolved.data.config.max).toBe(20);
  });

  it('prefers a supplied value over the default', () => {
    const [resolved] = resolveNodeParameters([node('n1', { max: { $param: 'cutoff', default: 20 } })], { cutoff: 5 });
    expect(resolved.data.config.max).toBe(5);
  });

  it('substitutes a supplied undefined rather than treating it as absent', () => {
    const [resolved] = resolveNodeParameters([node('n1', { max: { $param: 'cutoff', default: 20 } })], { cutoff: undefined });
    expect(resolved.data.config.max).toBeUndefined();
  });

  it('names the node and the parameter when nothing supplies a value', () => {
    expect(() => resolveNodeParameters([node('score-1', { max: { $param: 'cutoff' } })], {}))
      .toThrow(MissingParameterError);
    expect(() => resolveNodeParameters([node('score-1', { max: { $param: 'cutoff' } })], {}))
      .toThrow(/"score-1".*"cutoff"/);
  });

  it('returns the original nodes untouched when the graph names no parameters', () => {
    const nodes = [node('n1', { field: 'epc', max: 40 })];
    expect(resolveNodeParameters(nodes, { cutoff: 1 })).toBe(nodes);
  });

  it('does not mistake an ordinary config for a reference', () => {
    const config = { $param: 42, nested: { $param: ['not a name'] } };
    const [resolved] = resolveNodeParameters([node('n1', config)], {});
    expect(resolved.data.config).toEqual(config);
  });

  it('lists the parameters a graph names, deduplicated and sorted', () => {
    const nodes = [
      node('n1', { max: { $param: 'cutoff' } }),
      node('n2', { min: { $param: 'cutoff' }, weight: { $param: 'alpha' } }),
    ];
    expect(parametersUsed(nodes)).toEqual(['alpha', 'cutoff']);
  });
});

describe('indicative parameters for previews', () => {
  it('takes the first variant that defines each value', () => {
    const values = indicativeParameters([
      { parameters: { topN: 50 } },
      { parameters: { topN: 500, cutoff: 3 } },
    ]);
    expect(values).toEqual({ topN: 50, cutoff: 3 });
  });

  it('tolerates variants carrying no parameters at all', () => {
    expect(indicativeParameters([{}, { parameters: undefined }])).toEqual({});
  });
});
