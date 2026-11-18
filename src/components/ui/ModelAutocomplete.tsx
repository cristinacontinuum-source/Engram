import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, RefreshCw, Sparkles } from 'lucide-react';
import { engramApi } from '../../api/client';
import { DiscoveredModelOption, ModelCatalogKind } from '../../types/engram';
import { filterModelOptions, getFallbackCatalogModels } from '../../utils/modelCatalog';

export interface ModelAutocompleteLabels {
  placeholder: string;
  refresh: string;
  fetching: string;
  liveLabel: string;
  catalogLabel: string;
  useCustom: string;
  noMatches: string;
}

interface ModelAutocompleteProps {
  label: string;
  value: string;
  baseUrl: string;
  apiKey?: string;
  kind: ModelCatalogKind;
  onChange: (value: string) => void;
  onSelectOption?: (option: DiscoveredModelOption) => void;
  labels: ModelAutocompleteLabels;
  ariaLabel?: string;
  inputId?: string;
}

export const ModelAutocomplete: React.FC<ModelAutocompleteProps> = ({
  label,
  value,
  baseUrl,
  apiKey,
  kind,
  onChange,
  onSelectOption,
  labels,
  ariaLabel,
  inputId,
}) => {
  const [open, setOpen] = useState(false);
  const [isTypingFilter, setIsTypingFilter] = useState(false);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<'live' | 'catalog'>('catalog');
  const [options, setOptions] = useState<DiscoveredModelOption[]>(() =>
    getFallbackCatalogModels(kind)
  );
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestSeqRef = useRef(0);

  const loadModels = useCallback(async () => {
    const reqId = ++requestSeqRef.current;
    setLoading(true);
    try {
      const res = await engramApi.fetchAvailableModels({
        base_url: baseUrl,
        api_key: apiKey,
        kind,
      });
      if (reqId !== requestSeqRef.current) return;
      if (Array.isArray(res.models) && res.models.length > 0) {
        setOptions(res.models);
        setSource(res.source);
      } else {
        setOptions(getFallbackCatalogModels(kind));
        setSource('catalog');
      }
    } catch {
      if (reqId !== requestSeqRef.current) return;
      setOptions(getFallbackCatalogModels(kind));
      setSource('catalog');
    } finally {
      if (reqId === requestSeqRef.current) {
        setLoading(false);
      }
    }
  }, [baseUrl, apiKey, kind]);

  // Automatically fetch available models whenever baseUrl / apiKey changes (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      void loadModels();
    }, 350);
    return () => clearTimeout(timer);
  }, [loadModels]);

  // Close popover when clicking outside
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
        setIsTypingFilter(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const filteredOptions = useMemo(() => {
    if (!isTypingFilter) {
      return filterModelOptions(options, '', kind);
    }
    return filterModelOptions(options, value, kind);
  }, [options, isTypingFilter, value, kind]);

  const trimmedValue = value.trim();
  const hasExactMatch = useMemo(
    () => options.some((opt) => opt.id.toLowerCase() === trimmedValue.toLowerCase()),
    [options, trimmedValue]
  );

  const showCustomAction = Boolean(trimmedValue && !hasExactMatch);

  useEffect(() => {
    if (!open) return;
    const selectedIdx = filteredOptions.findIndex((opt) => opt.id === value);
    setHighlightedIndex(selectedIdx >= 0 ? selectedIdx : 0);
  }, [open, filteredOptions, value]);

  const commitOption = (option: DiscoveredModelOption) => {
    onChange(option.id);
    if (onSelectOption) {
      onSelectOption(option);
    }
    setOpen(false);
    setIsTypingFilter(false);
  };

  const commitCustomValue = (customId: string) => {
    onChange(customId);
    setOpen(false);
    setIsTypingFilter(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setOpen(true);
      return;
    }

    if (!open) return;

    const totalItems = filteredOptions.length + (showCustomAction ? 1 : 0);

    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setIsTypingFilter(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (totalItems > 0) {
        setHighlightedIndex((prev) => (prev + 1) % totalItems);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (totalItems > 0) {
        setHighlightedIndex((prev) => (prev - 1 + totalItems) % totalItems);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex < filteredOptions.length) {
        const chosen = filteredOptions[highlightedIndex];
        if (chosen) commitOption(chosen);
      } else if (showCustomAction) {
        commitCustomValue(trimmedValue);
      } else {
        setOpen(false);
        setIsTypingFilter(false);
      }
    }
  };

  const listboxId = inputId ? `${inputId}-listbox` : `model-autocomplete-${kind}-listbox`;

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center justify-between gap-2 mb-1.5 h-4">
        <label
          htmlFor={inputId}
          className="block text-[11px] font-medium leading-4 truncate"
          style={{ color: 'var(--text-secondary)' }}
        >
          {label}
        </label>

        <span
          className="font-mono-data text-[10px] leading-none px-1.5 py-0.5 rounded-[3px] shrink-0 inline-flex items-center gap-1"
          style={{
            backgroundColor: source === 'live' ? 'var(--bg-tag-teal)' : 'var(--bg-elevated)',
            color: source === 'live' ? 'var(--text-tag-teal)' : 'var(--text-secondary)',
          }}
          title={`${source === 'live' ? labels.liveLabel : labels.catalogLabel} (${baseUrl})`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              loading
                ? 'bg-amber-400 animate-pulse'
                : source === 'live'
                  ? 'bg-emerald-400'
                  : 'bg-zinc-400'
            }`}
          />
          {loading ? '...' : `${options.length} ${source === 'live' ? 'live' : 'models'}`}
        </span>
      </div>

      <div className="relative flex items-center">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-label={ariaLabel || label}
          value={value}
          placeholder={labels.placeholder}
          onFocus={() => {
            setIsTypingFilter(false);
            setOpen(true);
          }}
          onChange={(e) => {
            onChange(e.target.value);
            setIsTypingFilter(true);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          className="w-full pl-3 pr-16 py-2 rounded-lg hairline-border font-mono-data text-xs focus:outline-none focus:ring-1 focus:ring-[#1E6F5C]/50"
          style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
        />

        <div className="absolute right-1.5 flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => {
              void loadModels();
              setOpen(true);
              setIsTypingFilter(false);
              inputRef.current?.focus();
            }}
            aria-label={`${labels.refresh} (${label})`}
            title={labels.refresh}
            className="p-1.5 rounded hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
            style={{ color: 'var(--text-secondary)' }}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            type="button"
            onClick={() => {
              const nextOpen = !open;
              setOpen(nextOpen);
              setIsTypingFilter(false);
              if (nextOpen) inputRef.current?.focus();
            }}
            aria-label={`Toggle ${label} options`}
            aria-expanded={open}
            className="p-1.5 rounded hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
            style={{ color: 'var(--text-secondary)' }}
          >
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
      </div>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={label}
          className="absolute z-50 left-0 mt-1 w-full min-w-[260px] rounded-[4px] hairline-border py-1 shadow-2xl max-h-64 overflow-y-auto"
          style={{
            backgroundColor: 'var(--bg-surface)',
            boxShadow: '0 16px 36px -4px rgba(0, 0, 0, 0.45)',
          }}
        >
          {filteredOptions.length === 0 && !showCustomAction ? (
            <div
              className="px-3 py-2.5 text-xs font-mono-data"
              style={{ color: 'var(--text-secondary)' }}
            >
              {labels.noMatches}
            </div>
          ) : (
            filteredOptions.map((opt, idx) => {
              const isSelected = opt.id === value;
              const isHighlighted = idx === highlightedIndex;
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  onClick={() => commitOption(opt)}
                  className="w-full px-2.5 py-2 text-left flex items-center justify-between gap-2 transition-colors text-xs cursor-pointer"
                  style={{
                    backgroundColor: isHighlighted ? 'var(--bg-elevated)' : 'transparent',
                    color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div
                      className={`truncate font-mono-data ${isSelected ? 'font-semibold' : 'font-normal'}`}
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {opt.id}
                    </div>
                    {opt.owned_by && (
                      <div
                        className="text-[10px] truncate mt-0.5"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        {opt.owned_by}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {opt.badge && (
                      <span
                        className="font-mono-data text-[10px] px-1.5 py-0.2 rounded"
                        style={{
                          backgroundColor: 'var(--bg-tag-teal)',
                          color: 'var(--text-tag-teal)',
                        }}
                      >
                        {opt.badge}
                      </span>
                    )}
                    {isSelected && (
                      <Check
                        className="w-3.5 h-3.5 shrink-0"
                        style={{ color: 'var(--accent-teal)' }}
                      />
                    )}
                  </div>
                </button>
              );
            })
          )}

          {showCustomAction && (
            <button
              type="button"
              role="option"
              aria-selected={false}
              onMouseEnter={() => setHighlightedIndex(filteredOptions.length)}
              onClick={() => commitCustomValue(trimmedValue)}
              className="w-full px-2.5 py-2 text-left flex items-center gap-2 transition-colors text-xs hairline-border-t cursor-pointer"
              style={{
                backgroundColor:
                  highlightedIndex === filteredOptions.length ? 'var(--bg-elevated)' : 'transparent',
                color: 'var(--accent-teal)',
              }}
            >
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate font-mono-data">
                {labels.useCustom} <strong className="font-semibold">{trimmedValue}</strong>
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
