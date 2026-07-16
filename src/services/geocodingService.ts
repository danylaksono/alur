const DEFAULT_NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search';

export type GeocodingBounds = [[number, number], [number, number]];

export interface GeocodingResult {
  id: string;
  label: string;
  category?: string;
  type?: string;
  center: [number, number];
  bounds?: GeocodingBounds;
}

interface SearchOptions {
  signal?: AbortSignal;
  endpoint?: string;
  fetcher?: typeof fetch;
}

const finiteNumber = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const validLongitude = (value: number) => value >= -180 && value <= 180;
const validLatitude = (value: number) => value >= -90 && value <= 90;

const optionalString = (value: unknown) => (
  typeof value === 'string' && value.trim() ? value.trim() : undefined
);

const optionalIdentifier = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return optionalString(value);
};

export const parseNominatimResults = (payload: unknown): GeocodingResult[] => {
  if (!Array.isArray(payload)) return [];

  return payload.flatMap((entry, index): GeocodingResult[] => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    const label = optionalString(item.display_name);
    const latitude = finiteNumber(item.lat);
    const longitude = finiteNumber(item.lon);
    if (!label || latitude === null || longitude === null || !validLatitude(latitude) || !validLongitude(longitude)) {
      return [];
    }

    let bounds: GeocodingBounds | undefined;
    if (Array.isArray(item.boundingbox) && item.boundingbox.length >= 4) {
      const south = finiteNumber(item.boundingbox[0]);
      const north = finiteNumber(item.boundingbox[1]);
      const west = finiteNumber(item.boundingbox[2]);
      const east = finiteNumber(item.boundingbox[3]);
      if (
        south !== null && north !== null && west !== null && east !== null
        && validLatitude(south) && validLatitude(north)
        && validLongitude(west) && validLongitude(east)
        && south <= north && west <= east
      ) {
        bounds = [[west, south], [east, north]];
      }
    }

    const placeId = optionalIdentifier(item.place_id) || optionalIdentifier(item.osm_id) || String(index);
    return [{
      id: `${optionalString(item.osm_type) || 'place'}-${placeId}`,
      label,
      category: optionalString(item.category) || optionalString(item.class),
      type: optionalString(item.addresstype) || optionalString(item.type),
      center: [longitude, latitude],
      bounds,
    }];
  });
};

export const buildNominatimSearchUrl = (
  query: string,
  endpoint = import.meta.env.VITE_GEOCODER_URL?.trim() || DEFAULT_NOMINATIM_ENDPOINT,
) => {
  const url = new URL(endpoint);
  url.searchParams.set('q', query.trim());
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '5');
  return url.toString();
};

export const searchLocations = async (
  query: string,
  { signal, endpoint, fetcher = fetch }: SearchOptions = {},
): Promise<GeocodingResult[]> => {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length < 2) return [];

  const response = await fetcher(buildNominatimSearchUrl(trimmedQuery, endpoint), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });

  if (!response.ok) {
    if (response.status === 429) throw new Error('Location search is busy. Please wait a moment and try again.');
    throw new Error('Location search is unavailable right now.');
  }

  return parseNominatimResults(await response.json());
};
