/**
 * Symbol search — topbar center
 *
 * Phase 1: simple input that navigates to /markets?search= on submit.
 * Phase 3 will upgrade to fuzzy autocomplete with symbol index.
 *
 * Keyboard: `/` focuses, `Escape` blurs, `Enter` navigates.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, CornerDownLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SymbolSearchProps {
  /** Compact mode — icon-only button, expands to input on focus */
  compact?: boolean;
  className?: string;
}

export function SymbolSearch({ compact = false, className }: SymbolSearchProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');

  // Global `/` shortcut to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const submit = () => {
    const q = value.trim();
    if (!q) return;
    navigate(`/markets?search=${encodeURIComponent(q)}`);
    inputRef.current?.blur();
  };

  return (
    <label
      className={cn(
        'group relative flex items-center gap-2',
        'h-9 w-full rounded-md',
        'bg-surface-1 border border-border',
        'focus-within:border-accent transition-colors',
        compact && 'w-9 justify-center',
        className
      )}
    >
      <Search
        className={cn(
          'h-4 w-4 shrink-0 text-muted-foreground',
          'group-focus-within:text-accent transition-colors',
          compact && 'mx-auto'
        )}
        aria-hidden
      />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') {
            setValue('');
            inputRef.current?.blur();
          }
        }}
        placeholder="Search symbol or type /"
        aria-label="Search symbols"
        className={cn(
          'flex-1 bg-transparent text-sm text-foreground',
          'placeholder:text-muted-foreground',
          'outline-none border-none',
          compact && 'hidden'
        )}
      />
      {!compact && value && (
        <CornerDownLeft
          className="h-3 w-3 mr-2 text-muted-foreground animate-fade-in"
          aria-hidden
        />
      )}
      {!compact && !value && (
        <kbd
          className="mr-1.5 hidden sm:inline-flex items-center justify-center h-5 min-w-5 px-1 text-[10px] font-mono text-muted-foreground bg-surface-2 border border-border rounded"
          aria-hidden
        >
          /
        </kbd>
      )}
    </label>
  );
}
