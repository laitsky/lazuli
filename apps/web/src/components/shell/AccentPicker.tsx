/**
 * Accent picker — topbar dropdown
 *
 * Lets the user switch between the 4 accent variants defined in tokens.css.
 * Choice is persisted via usePreferences.
 */

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, Palette } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePreferences, type AccentVariant } from '@/lib/preferences';

const ACCENTS: { id: AccentVariant; label: string; swatch: string }[] = [
  { id: 'lapis', label: 'Lapis', swatch: 'hsl(220 70% 55%)' },
  { id: 'amber', label: 'Amber', swatch: 'hsl(38 92% 55%)' },
  { id: 'emerald', label: 'Emerald', swatch: 'hsl(152 60% 45%)' },
  { id: 'magenta', label: 'Magenta', swatch: 'hsl(320 75% 60%)' },
];

export function AccentPicker() {
  const { accent, setAccent } = usePreferences();
  const current = ACCENTS.find((a) => a.id === accent) ?? ACCENTS[0];

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-md',
            'bg-surface-1 border border-border',
            'hover:bg-surface-3 hover:border-border-strong transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          )}
          aria-label={`Accent: ${current.label}. Click to change.`}
        >
          <span
            className="h-4 w-4 rounded-full border border-foreground/20"
            style={{ backgroundColor: current.swatch }}
          />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className={cn(
            'z-50 min-w-[180px] p-1 rounded-md',
            'bg-surface-2 border border-border shadow-lg',
            'animate-scale-in origin-top-right'
          )}
        >
          <DropdownMenu.Label className="px-2 py-1.5 text-xs font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Palette className="h-3 w-3" aria-hidden /> Accent
          </DropdownMenu.Label>
          <DropdownMenu.Separator className="h-px bg-border my-1" />
          {ACCENTS.map((a) => (
            <DropdownMenu.Item
              key={a.id}
              onSelect={() => setAccent(a.id)}
              className={cn(
                'flex items-center gap-2.5 px-2 py-2 rounded-sm cursor-pointer',
                'text-sm text-foreground outline-none',
                'data-[highlighted]:bg-surface-3 transition-colors'
              )}
            >
              <span
                className="h-4 w-4 rounded-full border border-foreground/20"
                style={{ backgroundColor: a.swatch }}
              />
              <span className="flex-1">{a.label}</span>
              {a.id === accent && <Check className="h-3.5 w-3.5 text-accent" aria-hidden />}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
