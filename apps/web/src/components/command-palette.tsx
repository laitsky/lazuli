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
 * - Full accessibility support (ARIA, focus trap, keyboard navigation)
 */

import * as React from 'react';
import { useNavigate } from 'react-router-dom';
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
  Flame,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Navigation items matching the sidebar navigation
 * Each item includes keywords for better search filtering
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
    href: '/liquidations',
    label: 'Liquidations',
    description: 'Real-time liquidation monitor',
    icon: Flame,
    keywords: ['liquidation', 'cascade', 'forced', 'margin', 'rekt'],
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
 * Animation variants for the dialog overlay
 */
const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

/**
 * Animation variants for the dialog content
 */
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
      type: 'spring' as const,
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
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const dialogRef = React.useRef<HTMLDivElement>(null);

  /**
   * Handle keyboard shortcut to open/close command palette
   * Cmd+K on Mac, Ctrl+K on Windows/Linux
   */
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  /**
   * Lock body scroll when dialog is open
   * This prevents scrolling the page behind the modal
   */
  React.useEffect(() => {
    if (open) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [open]);

  /**
   * Reset search when dialog closes
   */
  React.useEffect(() => {
    if (!open) {
      setSearch('');
    }
  }, [open]);

  /**
   * Handle navigation action
   */
  const handleNavigate = React.useCallback(
    (href: string) => {
      setOpen(false);
      navigate(href);
    },
    [navigate]
  );

  /**
   * Handle exchange switch - navigates to markets with exchange filter
   */
  const handleExchangeSwitch = React.useCallback(
    (exchangeId: string) => {
      setOpen(false);
      navigate(`/markets?exchange=${exchangeId}`);
    },
    [navigate]
  );

  /**
   * Handle market type switch - navigates to markets with type filter
   */
  const handleMarketTypeSwitch = React.useCallback(
    (marketType: string) => {
      setOpen(false);
      navigate(`/markets?type=${marketType}`);
    },
    [navigate]
  );

  /**
   * Handle symbol search - navigates to markets with search query
   */
  const handleSymbolSearch = React.useCallback(() => {
    if (search.trim()) {
      setOpen(false);
      navigate(`/markets?search=${encodeURIComponent(search.trim())}`);
    }
  }, [navigate, search]);

  /**
   * Handle dialog close via overlay click or escape key
   */
  const handleClose = React.useCallback(() => {
    setOpen(false);
  }, []);

  return (
    <>
      {/* Trigger Button - Visible on desktop, shows keyboard shortcut */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'hidden lg:flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground',
          'bg-card border border-border rounded-lg',
          'hover:bg-accent hover:text-foreground hover:border-primary/30',
          'transition-all duration-200',
          className
        )}
        aria-label="Open command palette (Cmd+K)"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Search className="h-4 w-4" aria-hidden="true" />
        <span className="text-xs">Search...</span>
        <kbd className="ml-2 hidden md:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono font-medium bg-muted rounded border border-border">
          <CommandIcon className="h-3 w-3" aria-hidden="true" />
          <span>K</span>
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
              onClick={handleClose}
              aria-hidden="true"
            />

            {/* Command dialog container */}
            <motion.div
              ref={dialogRef}
              className="fixed inset-x-4 top-[15%] z-50 mx-auto max-w-[640px] sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-full"
              variants={dialogVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              role="dialog"
              aria-modal="true"
              aria-label="Command palette"
            >
              <Command
                className={cn(
                  'overflow-hidden rounded-xl border border-border bg-card shadow-2xl',
                  'ring-1 ring-primary/10'
                )}
                loop
                shouldFilter={true}
                onKeyDown={(e) => {
                  // Close on Escape
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    handleClose();
                  }
                }}
              >
                {/* Search Input */}
                <div className="flex items-center border-b border-border px-4">
                  <Search className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <Command.Input
                    value={search}
                    onValueChange={setSearch}
                    placeholder="Search commands, pages, or symbols..."
                    className={cn(
                      'flex-1 h-14 px-3 bg-transparent text-foreground placeholder:text-muted-foreground',
                      'outline-none border-none focus:ring-0',
                      'text-base font-sans'
                    )}
                    autoFocus
                  />
                  <kbd className="hidden sm:inline-flex items-center px-2 py-1 text-[10px] font-mono font-medium text-muted-foreground bg-muted rounded border border-border">
                    ESC
                  </kbd>
                </div>

                {/* Command List */}
                <Command.List className="max-h-[60vh] sm:max-h-[400px] overflow-y-auto custom-scrollbar p-2">
                  <Command.Empty className="py-12 text-center text-sm text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <Search className="h-10 w-10 text-muted-foreground/50" aria-hidden="true" />
                      <p>No results found.</p>
                      <p className="text-xs">Try searching for pages, exchanges, or symbols.</p>
                    </div>
                  </Command.Empty>

                  {/* Quick Symbol Search - appears when user types */}
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
                          <Search className="h-4 w-4 text-primary" aria-hidden="true" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">Search for &quot;{search}&quot;</p>
                          <p className="text-xs text-muted-foreground">Find symbol in markets</p>
                        </div>
                        <ArrowRight
                          className="h-4 w-4 text-muted-foreground shrink-0"
                          aria-hidden="true"
                        />
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
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted shrink-0">
                            <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium">{item.label}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {item.description}
                            </p>
                          </div>
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
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted shrink-0">
                          <Globe className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        </div>
                        <span className="font-medium flex-1">{exchange.label}</span>
                        <ExternalLink
                          className="h-3 w-3 text-muted-foreground shrink-0"
                          aria-hidden="true"
                        />
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
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted shrink-0">
                          <TrendingUp
                            className="h-4 w-4 text-muted-foreground"
                            aria-hidden="true"
                          />
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
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted shrink-0">
                        <RefreshCw className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium">Refresh Data</p>
                        <p className="text-xs text-muted-foreground">Reload current page data</p>
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
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted shrink-0">
                        <Settings className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium">API Status</p>
                        <p className="text-xs text-muted-foreground">Check exchange connections</p>
                      </div>
                    </Command.Item>
                  </Command.Group>
                </Command.List>

                {/* Footer with keyboard shortcuts help */}
                <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
                  <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1">
                      <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border font-mono">
                        ↑↓
                      </kbd>
                      <span className="hidden sm:inline">Navigate</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border font-mono">
                        ↵
                      </kbd>
                      <span className="hidden sm:inline">Select</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border font-mono">
                        esc
                      </kbd>
                      <span className="hidden sm:inline">Close</span>
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground/70 hidden sm:inline">
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
