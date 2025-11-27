'use client';

/**
 * Global Command Palette Component
 *
 * A powerful command interface using cmdk for quick navigation and actions.
 * Features:
 * - Keyboard shortcut: Cmd+K (Mac) / Ctrl+K (Windows/Linux)
 * - Navigation to all pages
 * - Quick exchange switching
 * - Symbol search integration
 * - Terminal Luxe aesthetic with glassmorphic design
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  Globe,
  TrendingUp,
  LayoutGrid,
  GitMerge,
  PieChart,
  Activity,
  Zap,
  Search,
  ArrowRight,
  Command as CommandIcon,
  ExternalLink,
  Settings,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Navigation items matching the sidebar navigation
 */
const navigationItems = [
  {
    href: '/',
    label: 'Dashboard',
    description: 'Overview and system status',
    icon: LayoutDashboard,
    keywords: ['home', 'overview', 'main'],
  },
  {
    href: '/exchanges',
    label: 'Exchanges',
    description: 'View all connected exchanges',
    icon: Globe,
    keywords: ['binance', 'bybit', 'okx', 'hyperliquid'],
  },
  {
    href: '/markets',
    label: 'Markets',
    description: 'Real-time ticker data',
    icon: TrendingUp,
    keywords: ['tickers', 'prices', 'spot', 'perpetual'],
  },
  {
    href: '/alt-screener',
    label: 'Alt Screener',
    description: 'Scan altcoins for opportunities',
    icon: Zap,
    keywords: ['altcoins', 'screener', 'scan', 'movers'],
  },
  {
    href: '/multitf',
    label: 'Multi-TF',
    description: 'Multi-timeframe chart analysis',
    icon: LayoutGrid,
    keywords: ['timeframe', 'chart', 'analysis', 'candlestick'],
  },
  {
    href: '/synthetic-pair',
    label: 'Synthetic Pairs',
    description: 'Create custom pair ratios',
    icon: GitMerge,
    keywords: ['synthetic', 'ratio', 'custom', 'pair'],
  },
  {
    href: '/custom-index',
    label: 'Custom Index',
    description: 'Build weighted portfolios',
    icon: PieChart,
    keywords: ['index', 'portfolio', 'weighted', 'basket'],
  },
  {
    href: '/superema',
    label: 'SuperEMA',
    description: '400 EMA trend analysis',
    icon: Activity,
    keywords: ['ema', 'trend', 'moving average', 'technical'],
  },
];

/**
 * Exchange quick switch items
 */
const exchangeItems = [
  { id: 'binance', label: 'Binance', keywords: ['bnb'] },
  { id: 'bybit', label: 'Bybit', keywords: ['bb'] },
  { id: 'okx', label: 'OKX', keywords: ['okex'] },
  { id: 'hyperliquid', label: 'Hyperliquid', keywords: ['hl', 'hyper'] },
];

/**
 * Market type quick switch items
 */
const marketTypeItems = [
  { id: 'spot', label: 'Spot Markets', keywords: ['spot trading'] },
  { id: 'perp', label: 'Perpetual Markets', keywords: ['futures', 'perpetual', 'perps'] },
];

/**
 * Animation variants for the dialog
 */
const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

const dialogVariants = {
  hidden: {
    opacity: 0,
    scale: 0.96,
    y: -20,
  },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      type: 'spring',
      stiffness: 500,
      damping: 35,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.96,
    y: -10,
    transition: {
      duration: 0.15,
    },
  },
};

interface CommandPaletteProps {
  className?: string;
}

export function CommandPalette({ className }: CommandPaletteProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);

  /**
   * Handle keyboard shortcut to open/close command palette
   * Cmd+K on Mac, Ctrl+K on Windows/Linux
   */
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Open command palette with Cmd+K or Ctrl+K
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }

      // Close with Escape
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  /**
   * Focus input when dialog opens
   */
  React.useEffect(() => {
    if (open) {
      // Small delay to ensure the dialog is rendered
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    } else {
      setSearch('');
    }
  }, [open]);

  /**
   * Handle navigation action
   */
  const handleNavigate = React.useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router]
  );

  /**
   * Handle exchange switch
   */
  const handleExchangeSwitch = React.useCallback(
    (exchangeId: string) => {
      setOpen(false);
      // Navigate to markets page with exchange parameter
      router.push(`/markets?exchange=${exchangeId}`);
    },
    [router]
  );

  /**
   * Handle market type switch
   */
  const handleMarketTypeSwitch = React.useCallback(
    (marketType: string) => {
      setOpen(false);
      // Navigate to markets page with type parameter
      router.push(`/markets?type=${marketType}`);
    },
    [router]
  );

  /**
   * Handle symbol search - navigate to markets with search query
   */
  const handleSymbolSearch = React.useCallback(() => {
    if (search.trim()) {
      setOpen(false);
      router.push(`/markets?search=${encodeURIComponent(search.trim())}`);
    }
  }, [router, search]);

  return (
    <>
      {/* Trigger Button - Visible on desktop, shows keyboard shortcut */}
      <button
        onClick={() => setOpen(true)}
        className={cn(
          'hidden lg:flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground',
          'bg-card border border-border rounded-lg',
          'hover:bg-accent hover:text-foreground hover:border-primary/30',
          'transition-all duration-200',
          className
        )}
        aria-label="Open command palette"
      >
        <Search className="h-4 w-4" />
        <span className="text-xs">Search...</span>
        <kbd className="ml-2 hidden md:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono font-medium bg-muted rounded border border-border">
          <CommandIcon className="h-3 w-3" />K
        </kbd>
      </button>

      {/* Command Palette Dialog */}
      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop overlay */}
            <motion.div
              className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm"
              variants={overlayVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />

            {/* Command dialog */}
            <motion.div
              className="fixed left-1/2 top-[20%] z-50 w-full max-w-[640px] -translate-x-1/2"
              variants={dialogVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <Command
                className={cn(
                  'overflow-hidden rounded-xl border border-border bg-card shadow-2xl',
                  'ring-1 ring-primary/10'
                )}
                loop
                shouldFilter={true}
              >
                {/* Search Input */}
                <div className="flex items-center border-b border-border px-4">
                  <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <Command.Input
                    ref={inputRef}
                    value={search}
                    onValueChange={setSearch}
                    placeholder="Search commands, pages, or symbols..."
                    className={cn(
                      'flex-1 h-14 px-3 bg-transparent text-foreground placeholder:text-muted-foreground',
                      'outline-none border-none focus:ring-0',
                      'text-base font-sans'
                    )}
                  />
                  <kbd className="hidden sm:inline-flex items-center px-2 py-1 text-[10px] font-mono font-medium text-muted-foreground bg-muted rounded border border-border">
                    ESC
                  </kbd>
                </div>

                {/* Command List */}
                <Command.List className="max-h-[400px] overflow-y-auto custom-scrollbar p-2">
                  <Command.Empty className="py-12 text-center text-sm text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <Search className="h-10 w-10 text-muted-foreground/50" />
                      <p>No results found.</p>
                      <p className="text-xs">Try searching for pages, exchanges, or symbols.</p>
                    </div>
                  </Command.Empty>

                  {/* Quick Symbol Search */}
                  {search.trim() && (
                    <Command.Group heading="Quick Actions">
                      <Command.Item
                        value={`search-symbol-${search}`}
                        onSelect={handleSymbolSearch}
                        className={cn(
                          'flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer',
                          'text-sm text-foreground',
                          'aria-selected:bg-primary/10 aria-selected:text-primary',
                          'transition-colors duration-150'
                        )}
                      >
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                          <Search className="h-4 w-4 text-primary" />
                        </div>
                        <div className="flex-1">
                          <p className="font-medium">
                            Search for &quot;{search}&quot;
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Find symbol in markets
                          </p>
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </Command.Item>
                    </Command.Group>
                  )}

                  {/* Navigation Commands */}
                  <Command.Group heading="Navigation">
                    {navigationItems.map((item) => {
                      const Icon = item.icon;
                      return (
                        <Command.Item
                          key={item.href}
                          value={`${item.label} ${item.keywords.join(' ')}`}
                          onSelect={() => handleNavigate(item.href)}
                          className={cn(
                            'flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer',
                            'text-sm text-foreground',
                            'aria-selected:bg-primary/10 aria-selected:text-primary',
                            'transition-colors duration-150'
                          )}
                        >
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                            <Icon className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div className="flex-1">
                            <p className="font-medium">{item.label}</p>
                            <p className="text-xs text-muted-foreground">
                              {item.description}
                            </p>
                          </div>
                          <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-aria-selected:opacity-100 transition-opacity" />
                        </Command.Item>
                      );
                    })}
                  </Command.Group>

                  {/* Exchange Quick Switch */}
                  <Command.Group heading="Switch Exchange">
                    {exchangeItems.map((exchange) => (
                      <Command.Item
                        key={exchange.id}
                        value={`exchange ${exchange.label} ${exchange.keywords.join(' ')}`}
                        onSelect={() => handleExchangeSwitch(exchange.id)}
                        className={cn(
                          'flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer',
                          'text-sm text-foreground',
                          'aria-selected:bg-primary/10 aria-selected:text-primary',
                          'transition-colors duration-150'
                        )}
                      >
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                          <Globe className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <span className="font-medium">{exchange.label}</span>
                        <ExternalLink className="ml-auto h-3 w-3 text-muted-foreground" />
                      </Command.Item>
                    ))}
                  </Command.Group>

                  {/* Market Type Switch */}
                  <Command.Group heading="Market Type">
                    {marketTypeItems.map((marketType) => (
                      <Command.Item
                        key={marketType.id}
                        value={`market ${marketType.label} ${marketType.keywords.join(' ')}`}
                        onSelect={() => handleMarketTypeSwitch(marketType.id)}
                        className={cn(
                          'flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer',
                          'text-sm text-foreground',
                          'aria-selected:bg-primary/10 aria-selected:text-primary',
                          'transition-colors duration-150'
                        )}
                      >
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                          <TrendingUp className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <span className="font-medium">{marketType.label}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>

                  {/* Utility Commands */}
                  <Command.Group heading="Utilities">
                    <Command.Item
                      value="refresh data reload"
                      onSelect={() => {
                        setOpen(false);
                        window.location.reload();
                      }}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer',
                        'text-sm text-foreground',
                        'aria-selected:bg-primary/10 aria-selected:text-primary',
                        'transition-colors duration-150'
                      )}
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                        <RefreshCw className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1">
                        <p className="font-medium">Refresh Data</p>
                        <p className="text-xs text-muted-foreground">
                          Reload current page data
                        </p>
                      </div>
                    </Command.Item>
                    <Command.Item
                      value="api status health"
                      onSelect={() => handleNavigate('/exchanges')}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer',
                        'text-sm text-foreground',
                        'aria-selected:bg-primary/10 aria-selected:text-primary',
                        'transition-colors duration-150'
                      )}
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                        <Settings className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1">
                        <p className="font-medium">API Status</p>
                        <p className="text-xs text-muted-foreground">
                          Check exchange connections
                        </p>
                      </div>
                    </Command.Item>
                  </Command.Group>
                </Command.List>

                {/* Footer with keyboard shortcuts */}
                <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
                  <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1">
                      <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border font-mono">
                        ↑↓
                      </kbd>
                      Navigate
                    </span>
                    <span className="flex items-center gap-1">
                      <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border font-mono">
                        ↵
                      </kbd>
                      Select
                    </span>
                    <span className="flex items-center gap-1">
                      <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border font-mono">
                        esc
                      </kbd>
                      Close
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground/70">
                    Lazuli Terminal
                  </span>
                </div>
              </Command>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

/**
 * Export a hook for opening the command palette from anywhere
 */
export function useCommandPalette() {
  const [, setOpen] = React.useState(false);

  const openCommandPalette = React.useCallback(() => {
    // Dispatch a custom event to open the command palette
    const event = new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: true,
      bubbles: true,
    });
    document.dispatchEvent(event);
  }, []);

  return { openCommandPalette };
}
