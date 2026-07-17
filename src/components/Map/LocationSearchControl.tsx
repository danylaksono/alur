import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import { LoaderCircle, MapPin, Search, X } from 'lucide-react';
import { searchLocations, type GeocodingResult } from '../../services/geocodingService';
import { cn } from '../../utils/cn';

const resultKind = (result: GeocodingResult) => {
  const value = result.type || result.category;
  return value ? value.replaceAll('_', ' ') : 'place';
};

export const LocationSearchControl = ({
  onSelect,
  onClear,
}: {
  onSelect: (result: GeocodingResult) => void;
  onClear: () => void;
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const lastRequestAtRef = useRef(0);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodingResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      requestRef.current?.abort();
    };
  }, []);

  const chooseResult = (result: GeocodingResult) => {
    onSelect(result);
    setQuery(result.label);
    setIsOpen(false);
    setActiveIndex(-1);
  };

  const runSearch = async () => {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 2) {
      setError('Enter at least two characters.');
      setResults([]);
      setIsOpen(true);
      return;
    }

    const now = Date.now();
    if (now - lastRequestAtRef.current < 1_100) {
      setError('Please wait a moment before searching again.');
      setIsOpen(true);
      return;
    }
    lastRequestAtRef.current = now;

    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setIsLoading(true);
    setError(null);
    setHasSearched(true);
    setActiveIndex(-1);
    setIsOpen(true);

    try {
      const nextResults = await searchLocations(trimmedQuery, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setResults(nextResults);
    } catch (searchError) {
      if (controller.signal.aborted) return;
      setResults([]);
      setError(searchError instanceof Error ? searchError.message : 'Location search failed.');
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (activeIndex >= 0 && results[activeIndex]) {
      chooseResult(results[activeIndex]);
      return;
    }
    void runSearch();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || !results.length) {
      if (event.key === 'Escape') setIsOpen(false);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? results.length - 1 : index - 1));
    } else if (event.key === 'Escape') {
      setIsOpen(false);
      setActiveIndex(-1);
    }
  };

  const clear = () => {
    requestRef.current?.abort();
    setQuery('');
    setResults([]);
    setError(null);
    setHasSearched(false);
    setIsLoading(false);
    setIsOpen(false);
    setActiveIndex(-1);
    onClear();
  };

  return (
    <div ref={rootRef} className="pointer-events-auto absolute left-3 top-3 z-20 w-[min(22rem,calc(100%-1.5rem))]">
      <form
        role="search"
        aria-label="Search map locations"
        onSubmit={handleSubmit}
        className="flex h-10 items-center rounded-lg border border-slate-200 bg-white/95 shadow-lg backdrop-blur"
      >
        <Search className="ml-3 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        <label htmlFor="map-location-search" className="sr-only">Search for a location</label>
        <input
          id="map-location-search"
          type="search"
          value={query}
          onChange={(event) => {
            requestRef.current?.abort();
            setQuery(event.target.value);
            setResults([]);
            setError(null);
            setHasSearched(false);
            setIsLoading(false);
            setActiveIndex(-1);
          }}
          onFocus={() => {
            if (hasSearched || results.length) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search place or address"
          autoComplete="off"
          aria-autocomplete="none"
          aria-controls="map-location-results"
          aria-expanded={isOpen}
          aria-activedescendant={activeIndex >= 0 ? `map-location-result-${activeIndex}` : undefined}
          className="min-w-0 flex-1 bg-transparent px-2 text-sm text-slate-700 outline-none placeholder:text-slate-400"
        />
        {query && (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear location search"
            title="Clear location search and marker"
            className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="submit"
          disabled={isLoading}
          aria-label="Search"
          title="Search"
          className="mr-1.5 rounded-md bg-slate-900 p-2 text-white transition-colors hover:bg-slate-700 disabled:cursor-wait disabled:bg-slate-400"
        >
          {isLoading
            ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            : <MapPin className="h-3.5 w-3.5" />}
        </button>
      </form>

      {isOpen && (
        <div className="mt-1.5 overflow-hidden rounded-lg border border-slate-200 bg-white/95 shadow-lg backdrop-blur">
          <div id="map-location-results" role="listbox" aria-label="Location search results" className="max-h-72 overflow-y-auto p-1">
            {isLoading && (
              <div className="flex items-center gap-2 px-3 py-3 text-xs text-slate-500">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Searching…
              </div>
            )}
            {!isLoading && error && <div className="px-3 py-3 text-xs text-red-600">{error}</div>}
            {!isLoading && !error && hasSearched && results.length === 0 && (
              <div className="px-3 py-3 text-xs text-slate-500">No locations found. Try a broader place name or address.</div>
            )}
            {!isLoading && results.map((result, index) => (
              <button
                key={result.id}
                id={`map-location-result-${index}`}
                type="button"
                role="option"
                aria-selected={activeIndex === index}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => chooseResult(result)}
                className={cn(
                  'flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors',
                  activeIndex === index ? 'bg-teal-50' : 'hover:bg-slate-50',
                )}
              >
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-600" />
                <span className="min-w-0">
                  <span className="line-clamp-2 block text-xs font-medium leading-4 text-slate-700">{result.label}</span>
                  <span className="mt-0.5 block text-[10px] capitalize text-slate-400">{resultKind(result)}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="border-t border-slate-100 px-3 py-1.5 text-[9px] text-slate-400">
            Search data ©{' '}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-slate-700"
            >
              OpenStreetMap contributors
            </a>
          </div>
        </div>
      )}
    </div>
  );
};
