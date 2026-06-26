/**
 * URL state primitives via nuqs
 *
 * All filter state lives in the URL. This makes pages shareable, back/forward
 * work, and refresh preserves state. nuqs handles the React 19 + Suspense
 * integration and gives us type-safe parsers.
 *
 * Convention: every page exports a `useXxxFilters()` hook that returns the
 * parsed state + setters. The setters update the URL; nuqs batches updates
 * so a single history entry is created.
 */

import {
  parseAsInteger,
  parseAsString,
  parseAsStringEnum,
  useQueryState,
  useQueryStates,
  parseAsBoolean,
  parseAsStringLiteral,
} from 'nuqs';

/** Market type — used across most pages */
export const marketTypeParser = parseAsStringEnum(['spot', 'perp']).withDefault('spot');

/** All exchanges (kept in sync with backend SupportedExchange) */
export const EXCHANGES = ['binance', 'bybit', 'okx', 'hyperliquid', 'upbit'] as const;
export type ExchangeId = (typeof EXCHANGES)[number];
export const exchangeParser = parseAsStringLiteral(EXCHANGES).withDefault('bybit');

/** Quote currency filter — USDT is dominant, BTC/ETH/FIAT for advanced */
export const QUOTES = ['ALL', 'USDT', 'USDC', 'FDUSD', 'BTC', 'ETH'] as const;
export const quoteParser = parseAsStringLiteral(QUOTES).withDefault('USDT');

/** Sortable columns on the markets table */
export const marketsSortParser = parseAsStringEnum(['volume', 'price', 'change']).withDefault(
  'volume'
);
export const sortDirParser = parseAsStringEnum(['asc', 'desc']).withDefault('desc');

/** All supported timeframes — matches shared/Timeframe */
export const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d', '3d', '1w'] as const;
export type TimeframeValue = (typeof TIMEFRAMES)[number];
export const timeframeParser = parseAsStringLiteral(TIMEFRAMES).withDefault('1h');

/** Performance period for screener / charts */
export const PERF_PERIODS = ['1h', '4h', '24h', '7d', '30d'] as const;
export const perfPeriodParser = parseAsStringLiteral(PERF_PERIODS).withDefault('24h');

/** Base currency for altcoin performance comparison */
export const BASE_CURRENCIES = ['USD', 'BTC', 'ETH', 'SOL'] as const;
export const baseCurrencyParser = parseAsStringLiteral(BASE_CURRENCIES).withDefault('USD');

/* ============================================================
   Page-scoped filter hooks — one per page that has filters.
   Each returns [state, setters] and uses a single useQueryStates call
   so updates batch into one history entry.
   ============================================================ */

export interface MarketsFilters {
  exchange: ExchangeId;
  type: 'spot' | 'perp';
  quote: string;
  search: string;
  sort: 'volume' | 'price' | 'change';
  dir: 'asc' | 'desc';
  page: number;
  view: string;
}

export function useMarketsFilters() {
  const [state, setState] = useQueryStates({
    exchange: exchangeParser,
    type: marketTypeParser,
    quote: quoteParser,
    search: parseAsString.withDefault(''),
    sort: marketsSortParser,
    dir: sortDirParser,
    page: parseAsInteger.withDefault(1),
    view: parseAsString.withDefault('default'),
  });
  return [state, setState] as const;
}

export interface WorkspaceFilters {
  exchange: ExchangeId;
  symbol: string;
  type: 'spot' | 'perp';
  timeframe: TimeframeValue;
}

export function useWorkspaceFilters() {
  const [state, setState] = useQueryStates({
    exchange: exchangeParser,
    symbol: parseAsString.withDefault('BTC-USDT'),
    type: marketTypeParser,
    timeframe: timeframeParser,
  });
  return [state, setState] as const;
}

export interface ArbitrageFilters {
  type: 'spot' | 'perp';
  quote: string;
  minSpreadBps: number;
}

export function useArbitrageFilters() {
  const [state, setState] = useQueryStates({
    type: marketTypeParser,
    quote: quoteParser,
    minSpreadBps: parseAsInteger.withDefault(10),
  });
  return [state, setState] as const;
}

export interface ScreenerFilters {
  exchange: ExchangeId;
  base: 'USD' | 'BTC' | 'ETH' | 'SOL';
  period: '1h' | '4h' | '24h' | '7d' | '30d';
  search: string;
}

export function useScreenerFilters() {
  const [state, setState] = useQueryStates({
    exchange: exchangeParser,
    base: baseCurrencyParser,
    period: perfPeriodParser,
    search: parseAsString.withDefault(''),
  });
  return [state, setState] as const;
}

export const signalModeParser = parseAsStringEnum([
  'momentum',
  'contrarian',
  'breakout',
]).withDefault('momentum');
export const signalVolumeParser = parseAsStringEnum([
  '0',
  '1000000',
  '10000000',
  '50000000',
]).withDefault('10000000');

export interface SignalLabFilters {
  exchange: ExchangeId;
  type: 'spot' | 'perp';
  quote: string;
  mode: 'momentum' | 'contrarian' | 'breakout';
  minVolume: string;
  search: string;
}

/** URL-backed filters for the live ticker-derived setup scanner. */
export function useSignalLabFilters() {
  const [state, setState] = useQueryStates({
    exchange: exchangeParser,
    type: marketTypeParser,
    quote: quoteParser,
    mode: signalModeParser,
    minVolume: signalVolumeParser,
    search: parseAsString.withDefault(''),
  });
  return [state, setState] as const;
}

/** Generic boolean toggle (e.g. for auto-refresh, log-scale) */
export function useBooleanParam(key: string, defaultValue = false) {
  return useQueryState(key, parseAsBoolean.withDefault(defaultValue));
}

/** Generic string param */
export function useStringParam(key: string, defaultValue = '') {
  return useQueryState(key, parseAsString.withDefault(defaultValue));
}

/** Generic integer param */
export function useIntParam(key: string, defaultValue = 0) {
  return useQueryState(key, parseAsInteger.withDefault(defaultValue));
}
