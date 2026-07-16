import { describe, expect, it, vi } from 'vitest';
import {
  buildNominatimSearchUrl,
  parseNominatimResults,
  searchLocations,
} from './geocodingService';

describe('geocoding service', () => {
  it('builds a constrained Nominatim search request', () => {
    const url = new URL(buildNominatimSearchUrl('  York station  ', 'https://example.test/search'));
    expect(url.origin + url.pathname).toBe('https://example.test/search');
    expect(url.searchParams.get('q')).toBe('York station');
    expect(url.searchParams.get('format')).toBe('jsonv2');
    expect(url.searchParams.get('addressdetails')).toBe('1');
    expect(url.searchParams.get('limit')).toBe('5');
  });

  it('parses valid results and converts Nominatim bounding boxes to map bounds', () => {
    const results = parseNominatimResults([
      {
        place_id: 123,
        osm_type: 'relation',
        display_name: 'York, England, United Kingdom',
        category: 'boundary',
        type: 'administrative',
        lat: '53.9591',
        lon: '-1.0815',
        boundingbox: ['53.7784', '54.0560', '-1.3516', '-0.9205'],
      },
      { display_name: 'Invalid', lat: 'not-a-number', lon: 0 },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: 'relation-123',
      center: [-1.0815, 53.9591],
      bounds: [[-1.3516, 53.7784], [-0.9205, 54.056]],
      category: 'boundary',
      type: 'administrative',
    });
  });

  it('uses the injected fetcher and reports rate limiting clearly', async () => {
    const successFetcher = vi.fn(async () => new Response(JSON.stringify([
      { place_id: 1, display_name: 'Leeds', lat: '53.8', lon: '-1.55' },
    ]), { status: 200 }));

    await expect(searchLocations('Leeds', {
      endpoint: 'https://example.test/search',
      fetcher: successFetcher as typeof fetch,
    })).resolves.toHaveLength(1);
    expect(successFetcher).toHaveBeenCalledOnce();

    const limitedFetcher = vi.fn(async () => new Response('', { status: 429 }));
    await expect(searchLocations('Leeds', {
      endpoint: 'https://example.test/search',
      fetcher: limitedFetcher as typeof fetch,
    })).rejects.toThrow('busy');
  });
});

