/**
 * SearchInput — input with leading search icon and optional clear button
 *
 * Wraps a controlled input. Mobile: grows to fill parent.
 */

import * as React from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SearchInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  value: string;
  onValueChange: (v: string) => void;
  placeholder?: string;
  /** Auto-focus on mount (use sparingly — mobile keyboard pop is jarring) */
  autoFocus?: boolean;
  className?: string;
}

export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  ({ value, onValueChange, placeholder = 'Search…', className, ...props }, ref) => {
    return (
      <div
        className={cn(
          'relative flex items-center h-9 w-full rounded-md',
          'bg-surface-1 border border-border',
          'focus-within:border-accent focus-within:ring-2 focus-within:ring-ring',
          'transition-colors',
          className
        )}
      >
        <Search className="h-4 w-4 ml-2.5 shrink-0 text-muted-foreground" aria-hidden />
        <input
          ref={ref}
          type="text"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder={placeholder}
          className={cn(
            'flex-1 h-full bg-transparent px-2 text-sm text-foreground',
            'placeholder:text-muted-foreground/70',
            'outline-none border-none'
          )}
          {...props}
        />
        {value && (
          <button
            type="button"
            onClick={() => onValueChange('')}
            aria-label="Clear search"
            className="flex h-7 w-7 mr-1 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>
    );
  }
);
SearchInput.displayName = 'SearchInput';
