import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BookOpen,
  GitMerge,
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

export type NavigationSectionId = 'overview' | 'discover' | 'analyze' | 'strategies';

export interface AppRouteItem {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  keywords: string[];
  section: NavigationSectionId;
}

export interface NavigationSection {
  id: NavigationSectionId;
  label: string;
  items: AppRouteItem[];
}

export const appRoutes = {
  dashboard: {
    href: '/',
    label: 'Dashboard',
    description: 'Operational cockpit and system status',
    icon: LayoutDashboard,
    keywords: ['home', 'overview', 'main', 'cockpit'],
    section: 'overview',
  },
  exchanges: {
    href: '/discover/exchanges',
    label: 'Exchanges',
    description: 'Connected exchange capabilities',
    icon: Globe,
    keywords: ['binance', 'bybit', 'okx', 'hyperliquid', 'upbit'],
    section: 'discover',
  },
  markets: {
    href: '/discover/markets',
    label: 'Markets',
    description: 'Real-time ticker discovery',
    icon: TrendingUp,
    keywords: ['tickers', 'prices', 'spot', 'perpetual'],
    section: 'discover',
  },
  screener: {
    href: '/discover/screener',
    label: 'Alt Screener',
    description: 'Scan altcoins for relative strength',
    icon: Zap,
    keywords: ['altcoins', 'screener', 'scan', 'movers'],
    section: 'discover',
  },
  workspace: {
    href: '/analyze/workspace',
    label: 'Workspace',
    description: 'Single-market analysis workspace',
    icon: LineChart,
    keywords: ['symbol', 'chart', 'workspace', 'analysis'],
    section: 'analyze',
  },
  orderbook: {
    href: '/analyze/orderbook',
    label: 'Order Book',
    description: 'Market depth and liquidity',
    icon: BookOpen,
    keywords: ['depth', 'bid', 'ask', 'liquidity'],
    section: 'analyze',
  },
  multiTimeframe: {
    href: '/analyze/multi-timeframe',
    label: 'Multi-Timeframe',
    description: 'Trend checks across time horizons',
    icon: LayoutGrid,
    keywords: ['timeframe', 'chart', 'candlestick'],
    section: 'analyze',
  },
  superema: {
    href: '/analyze/superema',
    label: 'SuperEMA',
    description: '400 EMA trend map',
    icon: Activity,
    keywords: ['ema', 'trend', 'moving average', 'technical'],
    section: 'analyze',
  },
  funding: {
    href: '/strategies/funding',
    label: 'Funding Rates',
    description: 'Perpetual funding sentiment',
    icon: Percent,
    keywords: ['funding', 'perps', 'sentiment'],
    section: 'strategies',
  },
  fundingArbitrage: {
    href: '/strategies/funding/arbitrage',
    label: 'Funding Arbitrage',
    description: 'Cross-exchange funding spreads',
    icon: Radar,
    keywords: ['funding', 'arbitrage', 'yield', 'basis'],
    section: 'strategies',
  },
  priceArbitrage: {
    href: '/strategies/price-arbitrage',
    label: 'Price Arbitrage',
    description: 'Cross-exchange price discrepancies',
    icon: Search,
    keywords: ['arbitrage', 'spread', 'price', 'exchange'],
    section: 'strategies',
  },
  syntheticPair: {
    href: '/strategies/synthetic-pair',
    label: 'Synthetic Pair',
    description: 'Relative-value custom pairs',
    icon: GitMerge,
    keywords: ['synthetic', 'ratio', 'custom', 'pair'],
    section: 'strategies',
  },
  customIndex: {
    href: '/strategies/custom-index',
    label: 'Custom Index',
    description: 'Weighted asset baskets',
    icon: PieChart,
    keywords: ['index', 'portfolio', 'weighted', 'basket'],
    section: 'strategies',
  },
} satisfies Record<string, AppRouteItem>;

export const navigationSections: NavigationSection[] = [
  {
    id: 'overview',
    label: 'Overview',
    items: [appRoutes.dashboard],
  },
  {
    id: 'discover',
    label: 'Discover',
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
      appRoutes.funding,
      appRoutes.fundingArbitrage,
      appRoutes.priceArbitrage,
      appRoutes.syntheticPair,
      appRoutes.customIndex,
    ],
  },
];

export const commandNavigationItems = navigationSections.flatMap((section) => section.items);

export const legacyRouteAliases: Record<string, string> = {
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
};
