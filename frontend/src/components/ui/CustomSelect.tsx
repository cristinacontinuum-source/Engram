import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  sublabel?: string;
  badge?: string;
  icon?: React.ReactNode;
}

interface CustomSelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  icon?: React.ReactNode;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  mono?: boolean;
  ariaLabel?: string;
  dropUp?: boolean;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
  value,
  options,
  onChange,
  label,
  placeholder = 'Select...',
  icon,
  size = 'md',
  className = '',
  mono = false,
  ariaLabel,
  dropUp = false,
}) => {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value) || options[0];

  useEffect(() => {
    const idx = options.findIndex((opt) => opt.value === value);
    if (idx !== -1) setHighlightedIndex(idx);
  }, [value, options, open]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (options.length > 0 ? (prev + 1) % options.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        options.length > 0 ? (prev - 1 + options.length) % options.length : 0
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = options[highlightedIndex];
      if (chosen) {
        onChange(chosen.value);
        setOpen(false);
      }
    }
  };

  const sizeClasses =
    size === 'xs'
      ? 'px-2 py-1 text-xs'
      : size === 'sm'
        ? 'px-2.5 py-1.5 text-xs'
        : 'px-3 py-2 text-xs';

  return (
    <div ref={containerRef} className={`relative select-none ${className}`}>
      {label && (
        <label
          className="block text-[11px] font-medium mb-1.5 tracking-tight"
          style={{ color: 'var(--text-secondary)' }}
        >
          {label}
        </label>
      )}

      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-label={ariaLabel || label || placeholder}
        onKeyDown={handleKeyDown}
        onClick={() => setOpen((prev) => !prev)}
        className={`w-full flex items-center justify-between gap-2 rounded-[4px] hairline-border transition-colors text-left focus:outline-none cursor-pointer ${sizeClasses} ${
          open ? 'ring-1 ring-zinc-400/40' : 'hover:bg-[var(--bg-elevated)]'
        }`}
        style={{
          backgroundColor: 'var(--bg-surface)',
          color: 'var(--text-primary)',
        }}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {icon && (
            <span className="shrink-0" style={{ color: 'var(--text-secondary)' }}>
              {icon}
            </span>
          )}
          {selectedOption?.icon && <span className="shrink-0">{selectedOption.icon}</span>}
          <span
            className={`truncate font-medium ${mono ? 'font-mono-data' : ''}`}
            style={{ color: 'var(--text-primary)' }}
          >
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          {selectedOption?.badge && (
            <span
              className="font-mono-data text-[10px] px-1.5 py-0.2 rounded-[3px] shrink-0"
              style={{
                backgroundColor: 'var(--bg-elevated)',
                color: 'var(--text-secondary)',
              }}
            >
              {selectedOption.badge}
            </span>
          )}
        </div>

        <ChevronDown
          className={`w-3.5 h-3.5 shrink-0 transition-transform duration-150 ${
            open ? 'rotate-180' : ''
          }`}
          style={{ color: 'var(--text-secondary)' }}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className={`absolute z-50 ${
            dropUp ? 'bottom-full mb-1' : 'mt-1'
          } w-full min-w-[160px] rounded-[4px] hairline-border py-1 shadow-2xl max-h-64 overflow-y-auto`}
          style={{
            backgroundColor: 'var(--bg-surface)',
            boxShadow: '0 16px 36px -4px rgba(0, 0, 0, 0.45)',
          }}
        >
          {options.map((option, idx) => {
            const isSelected = option.value === value;
            const isHighlighted = idx === highlightedIndex;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setHighlightedIndex(idx)}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className="w-full px-2.5 py-2 text-left flex items-center justify-between gap-2 transition-colors text-xs cursor-pointer"
                style={{
                  backgroundColor: isHighlighted ? 'var(--bg-elevated)' : 'transparent',
                  color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {option.icon && <span className="shrink-0">{option.icon}</span>}
                  <div className="min-w-0">
                    <div
                      className={`truncate ${isSelected ? 'font-semibold' : 'font-normal'} ${
                        mono ? 'font-mono-data' : ''
                      }`}
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {option.label}
                    </div>
                    {option.sublabel && (
                      <div
                        className="text-[10px] truncate mt-0.5"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        {option.sublabel}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {option.badge && (
                    <span
                      className="font-mono-data text-[10px] px-1.5 py-0.2 rounded"
                      style={{
                        backgroundColor: 'var(--bg-tag-teal)',
                        color: 'var(--text-tag-teal)',
                      }}
                    >
                      {option.badge}
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
          })}
        </div>
      )}
    </div>
  );
};
