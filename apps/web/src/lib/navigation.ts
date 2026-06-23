/**
 * Lazuli route registry
 *
 * Flat URLs — no section prefixes. Routes are organized into 4 navigation
 * sections for the sidebar, but the URL space is flat:
 *
 *   /markets, /screener, /exchanges, /workspace, /orderbook, ...
 *
 * Legacy section-prefixed paths (/discover/markets, /analyze/workspace, etc.)
 * are aliased and 301-redirected in App.tsx.
 */

import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BookOpen,
  GitCompareArrows,
  Globe,
  LayoutDashboard,
  LayoutGrid,
  LineChart,
  Percent,
  PieChart,
  Radar,
  Search,
  TrendingUp,
  Zap,
} from 'lucide-react';

export type NavigationSectionId = 'dashboard' | 'markets' | 'analyze' | 'strategies';

export interface AppRouteItem {
  /** Flat URL path */
  href: string;
  /** Short label for sidebar */
  label: string;
  /** One-line description, used in tooltips + command palette */
  description: string;
  /** Lucide icon */
  icon: LucideIcon;
  /** Keywords for fuzzy search in command palette */
  keywords: string[];
  /** Section grouping in the sidebar */
  section: NavigationSectionId;
}

export interface NavigationSection {
  id: NavigationSectionId;
  label: string;
  items: AppRouteItem[];
}

/**
 * All routes. Each one is reachable from the sidebar — nothing is hidden.
 * Add new routes here, and App.tsx picks them up automatically.
 */
export const appRoutes = {
  dashboard: {
    href: '/',
    label: 'Dashboard',
    description: 'Live market cockpit',
    icon: LayoutDashboard,
    keywords: ['home', 'overview', 'main', 'cockpit', 'landing'],
    section: 'dashboard',
  },
  markets: {
    href: '/markets',
    label: 'Markets',
    description: 'All tickers across exchanges',
    icon: TrendingUp,
    keywords: ['tickers', 'prices', 'spot', 'perpetual', 'perp', 'table'],
    section: 'markets',
  },
  screener: {
    href: '/screener',
    label: 'Screener',
    description: 'Altcoin relative strength scanner',
    icon: Zap,
    keywords: ['altcoin', 'scan', 'movers', 'heatmap', 'strength'],
    section: 'markets',
  },
  exchanges: {
    href: '/exchanges',
    label: 'Exchanges',
    description: 'Connected exchanges and capabilities',
    icon: Globe,
    keywords: ['binance', 'bybit', 'okx', 'hyperliquid', 'upbit', 'status'],
    section: 'markets',
  },
  workspace: {
    href: '/workspace',
    label: 'Workspace',
    description: 'Single-symbol analysis cockpit',
    icon: LineChart,
    keywords: ['chart', 'symbol', 'analysis', 'candlestick', 'ohlc'],
    section: 'analyze',
  },
  orderbook: {
    href: '/orderbook',
    label: 'Order Book',
    description: 'Market depth and liquidity',
    icon: BookOpen,
    keywords: ['depth', 'bid', 'ask', 'liquidity', 'spread'],
    section: 'analyze',
  },
  multiTimeframe: {
    href: '/multi-timeframe',
    label: 'Multi-Timeframe',
    description: 'Trend across time horizons',
    icon: LayoutGrid,
    keywords: ['multitf', 'timeframe', 'trend', 'comparison'],
    section: 'analyze',
  },
  superema: {
    href: '/superema',
    label: 'SuperEMA',
    description: '400-EMA trend heatmap',
    icon: Activity,
    keywords: ['ema', 'trend', 'moving average', 'technical', 'heatmap'],
    section: 'analyze',
  },
  priceArbitrage: {
    href: '/price-arbitrage',
    label: 'Price Arbitrage',
    description: 'Cross-exchange price spreads',
    icon: Search,
    keywords: ['arbitrage', 'arb', 'spread', 'bps', 'cross-exchange'],
    section: 'strategies',
  },
  funding: {
    href: '/funding',
    label: 'Funding Rates',
    description: 'Perpetual funding sentiment',
    icon: Percent,
    keywords: ['funding', 'perp', 'sentiment', 'perpetual'],
    section: 'strategies',
  },
  fundingArbitrage: {
    href: '/funding-arbitrage',
    label: 'Funding Arbitrage',
    description: 'Cross-exchange funding yield',
    icon: Radar,
    keywords: ['funding', 'arbitrage', 'yield', 'basis', 'carry'],
    section: 'strategies',
  },
  syntheticPair: {
    href: '/synthetic-pair',
    label: 'Synthetic Pair',
    description: 'Relative-value ratio charts',
    icon: GitCompareArrows,
    keywords: ['synthetic', 'ratio', 'pair', 'relative value', 'custom'],
    section: 'strategies',
  },
  customIndex: {
    href: '/custom-index',
    label: 'Custom Index',
    description: 'Weighted asset basket',
    icon: PieChart,
    keywords: ['index', 'portfolio', 'weighted', 'basket', 'benchmark'],
    section: 'strategies',
  },
} satisfies Record<string, AppRouteItem>;

/** Sidebar section ordering + grouping. Drives the sidebar directly. */
export const navigationSections: NavigationSection[] = [
  {
    id: 'dashboard',
    label: '',
    items: [appRoutes.dashboard],
  },
  {
    id: 'markets',
    label: 'Markets',
    items: [appRoutes.markets, appRoutes.screener, appRoutes.exchanges],
  },
  {
    id: 'analyze',
    label: 'Analyze',
    items: [appRoutes.workspace, appRoutes.orderbook, appRoutes.multiTimeframe, appRoutes.superema],
  },
  {
    id: 'strategies',
    label: 'Strategies',
    items: [
      appRoutes.priceArbitrage,
      appRoutes.funding,
      appRoutes.fundingArbitrage,
      appRoutes.syntheticPair,
      appRoutes.customIndex,
    ],
  },
];

/** Flattened list of all nav items — used by command palette */
export const commandNavigationItems: AppRouteItem[] = navigationSections.flatMap((s) => s.items);

/** Find a route by href prefix (used for active-state detection) */
export function findRouteByPathname(pathname: string): AppRouteItem | undefined {
  // Sort by href length DESC so /markets matches before /
  const sorted = [...commandNavigationItems].sort((a, b) => b.href.length - a.href.length);
  return sorted.find((r) => r.href === pathname || (r.href !== '/' && pathname.startsWith(r.href)));
}

/**
 * Legacy → flat URL aliases. Every old prefixed path redirects to its new home.
 * 301-equivalent (replace: true) is set in App.tsx.
 */
export const legacyRouteAliases: Record<string, string> = {
  // Section-prefixed → flat
  '/discover/markets': appRoutes.markets.href,
  '/discover/screener': appRoutes.screener.href,
  '/discover/exchanges': appRoutes.exchanges.href,
  '/analyze/workspace': appRoutes.workspace.href,
  '/analyze/orderbook': appRoutes.orderbook.href,
  '/analyze/multi-timeframe': appRoutes.multiTimeframe.href,
  '/analyze/superema': appRoutes.superema.href,
  '/strategies/funding': appRoutes.funding.href,
  '/strategies/funding/arbitrage': appRoutes.fundingArbitrage.href,
  '/strategies/price-arbitrage': appRoutes.priceArbitrage.href,
  '/strategies/synthetic-pair': appRoutes.syntheticPair.href,
  '/strategies/custom-index': appRoutes.customIndex.href,
  // Old short paths → new flat
  '/exchanges': appRoutes.exchanges.href,
  '/markets': appRoutes.markets.href,
  '/alt-screener': appRoutes.screener.href,
  '/orderbook': appRoutes.orderbook.href,
  '/multitf': appRoutes.multiTimeframe.href,
  '/funding-rates': appRoutes.funding.href,
  '/funding-rates/arbitrage': appRoutes.fundingArbitrage.href,
  '/synthetic-pair': appRoutes.syntheticPair.href,
  '/custom-index': appRoutes.customIndex.href,
  '/superema': appRoutes.superema.href,
  '/price-arbitrage-old': appRoutes.priceArbitrage.href,
};
