import { describe, expect, it } from 'vitest';
import { buildH3GridLayerProps, type H3GridDatum } from './h3DeckService';
import type { H3GridVisualisation } from '../types/visualisation';

const layer = { id: 'l1' } as any;

const vis = (overrides: Partial<H3GridVisualisation> = {}): H3GridVisualisation => ({
  kind: 'h3grid',
  cellColumn: 'cell',
  valueField: 'value',
  palette: ['#ff0000', '#00ff00', '#0000ff'],
  opacity: 0.8,
  extruded: false,
  elevationScale: 1,
  ...overrides,
});

const data: H3GridDatum[] = [
  { cell: '878d8cb16ffffff', value: 0 },
  { cell: '878d8c046ffffff', value: 50 },
  { cell: '878d8c311ffffff', value: 100 },
];

describe('buildH3GridLayerProps', () => {
  it('carries the cell accessor and data through to the deck layer', () => {
    const props = buildH3GridLayerProps(layer, vis(), data);
    expect(props.id).toBe('deck-h3-l1');
    expect(props.data).toBe(data);
    const getHexagon = props.getHexagon as (d: H3GridDatum) => string;
    expect(getHexagon(data[0])).toBe('878d8cb16ffffff');
    const getElevation = props.getElevation as (d: H3GridDatum) => number;
    expect(getElevation(data[1])).toBe(50);
  });

  it('maps low values to the start of the palette and high values to the end', () => {
    const props = buildH3GridLayerProps(layer, vis(), data);
    const getFillColor = props.getFillColor as (d: H3GridDatum) => number[];
    const low = getFillColor(data[0]);
    const high = getFillColor(data[2]);
    // Red start, blue end (0x0000ff) → high should be bluish, low reddish.
    expect(low[0]).toBeGreaterThan(high[0]);
    expect(high[2]).toBeGreaterThan(low[2]);
  });

  it('uses a uniform fill when there is no value field', () => {
    const props = buildH3GridLayerProps(layer, vis({ valueField: undefined }), data);
    const getFillColor = props.getFillColor as (d: H3GridDatum) => number[];
    expect(getFillColor(data[0])).toEqual(getFillColor(data[2]));
  });

  it('turns extrusion on through the props', () => {
    const props = buildH3GridLayerProps(layer, vis({ extruded: true, elevationScale: 4 }), data);
    expect(props.extruded).toBe(true);
    expect(props.elevationScale).toBe(4);
  });
});
