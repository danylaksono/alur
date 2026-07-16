import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '../../utils/cn';

export type TypeaheadOption = {
  value: string;
  label: string;
  description?: string;
  group?: string;
};

interface TypeaheadSelectProps {
  value: string;
  options: TypeaheadOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  emptyLabel?: string;
}

const normalize = (value: string) => value.toLowerCase().replace(/[_-]/g, ' ');

export const TypeaheadSelect = ({
  value,
  options,
  onChange,
  placeholder = 'Search...',
  emptyLabel = 'No matches',
}: TypeaheadSelectProps) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = options.find((option) => option.value === value) || options[0];

  const filteredOptions = useMemo(() => {
    const search = normalize(query.trim());
    if (!search) return options;
    return options.filter((option) => {
      const haystack = normalize(`${option.label} ${option.description || ''} ${option.group || ''}`);
      return search.split(/\s+/).every((part) => haystack.includes(part));
    });
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  const commit = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
    setQuery('');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, filteredOptions.length - 1));
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    }
    if (event.key === 'Enter' && filteredOptions[activeIndex]) {
      event.preventDefault();
      commit(filteredOptions[activeIndex].value);
    }
    if (event.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  };

  let previousGroup = '';

  return (
    <div ref={rootRef} className="relative nodrag nopan">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm text-slate-700 outline-none transition-colors hover:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
      >
        <span className="min-w-0">
          <span className="block truncate font-medium">{selected?.label || value}</span>
          {selected?.description && (
            <span className="mt-0.5 block truncate text-[11px] text-slate-400">
              {selected.description}
            </span>
          )}
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl shadow-slate-900/15">
          <div className="flex items-center gap-1.5 border-b border-slate-100 px-2 py-1.5">
            <Search className="h-3 w-3 shrink-0 text-slate-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className="h-7 min-w-0 flex-1 bg-transparent text-[11px] text-slate-700 outline-none placeholder:text-slate-400"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-3 text-center text-[11px] text-slate-400">{emptyLabel}</div>
            ) : (
              filteredOptions.map((option, index) => {
                const showGroup = option.group && option.group !== previousGroup;
                previousGroup = option.group || previousGroup;
                const isSelected = option.value === value;
                const isActive = index === activeIndex;

                return (
                  <div key={option.value}>
                    {showGroup && (
                      <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        {option.group}
                      </div>
                    )}
                    <button
                      type="button"
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => commit(option.value)}
                      className={cn(
                        'flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors',
                        isActive ? 'bg-slate-100' : 'hover:bg-slate-50'
                      )}
                    >
                      <Check className={cn('mt-0.5 h-3 w-3 shrink-0 text-slate-700', !isSelected && 'opacity-0')} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] font-semibold text-slate-700">{option.label}</span>
                        {option.description && (
                          <span className="mt-0.5 block truncate text-[11px] text-slate-400">{option.description}</span>
                        )}
                      </span>
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
