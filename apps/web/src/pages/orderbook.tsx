import { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/page-header';
import { LazuliAPI } from '@/lib/api-client';
import { formatPrice } from '@/lib/format';
import { SupportedExchange, Ticker, OrderBookEntry } from '@lazuli/shared';
import {
  Search,
  BookOpen,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  Layers,
} from 'lucide-react';

/**
 * Order Book page
 * Displays real-time bid/ask orders for a selected trading pair
 * Shows market depth visualization with cumulative totals
 */
export default function OrderBookPage() {
  // State management
  const [exchanges, setExchanges] = useState<{ id: SupportedExchange; name: string }[]>([]);
  const [selectedExchange, setSelectedExchange] = useState<SupportedExchange>('bybit');
  const [tickers, setTickers] = useState<Ticker[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');
  const [marketType, setMarketType] = useState<'spot' | 'perp'>('spot');
  const [quoteFilter, setQuoteFilter] = useState<string>('USDT');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [tickersLoading, setTickersLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [depth, setDepth] = useState<number>(25);
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Order book data
  const [bids, setBids] = useState<OrderBookEntry[]>([]);
  const [asks, setAsks] = useState<OrderBookEntry[]>([]);
  const [spread, setSpread] = useState<number | null>(null);
  const [spreadPercent, setSpreadPercent] = useState<number | null>(null);
  const [midPrice, setMidPrice] = useState<number | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  /**
   * Parse symbol using standardized notation
   * - Spot: BTC-USDT (hyphen separator)
   * - Perpetual: BTCUSDT.P (.P suffix)
   */
  const parseSymbol = (symbol: string) => {
    // Check if it's a perpetual contract (.P suffix)
    if (symbol.endsWith('.P')) {
      const baseQuote = symbol.slice(0, -2);
      const commonQuotes = [
        'USDT',
        'USDC',
        'BUSD',
        'USD',
        'BTC',
        'ETH',
        'BNB',
        'TUSD',
        'DAI',
        'FDUSD',
      ];

      for (const quote of commonQuotes) {
        if (baseQuote.endsWith(quote)) {
          const base = baseQuote.slice(0, -quote.length);
          return { base, quote, isPerpetual: true };
        }
      }
      return { base: baseQuote, quote: '', isPerpetual: true };
    }

    // Spot market with hyphen separator (BTC-USDT)
    if (symbol.includes('-')) {
      const [base, quote] = symbol.split('-');
      return { base: base || '', quote: quote || '', isPerpetual: false };
    }

    return { base: symbol, quote: '', isPerpetual: false };
  };

  /**
   * Extract quote currency from symbol
   */
  const getQuoteCurrency = (symbol: string): string => {
    const parsed = parseSymbol(symbol);
    return parsed.quote;
  };

  /**
   * Get icon/logo for currency
   */
  const getCurrencyIcon = (currency: string): string | null => {
    const icons: Record<string, string> = {
      USDT: '\u20AE',
      BTC: '\u20BF',
      ETH: '\u039E',
    };
    return icons[currency] || null;
  };

  /**
   * Format amount with appropriate precision
   */
  const formatAmount = (amount: number): string => {
    if (amount >= 1000000) return `${(amount / 1000000).toFixed(2)}M`;
    if (amount >= 1000) return `${(amount / 1000).toFixed(2)}K`;
    if (amount >= 1) return amount.toFixed(4);
    return amount.toFixed(8);
  };

  // Load exchanges on mount
  useEffect(() => {
    async function loadExchanges() {
      const response = await LazuliAPI.getExchanges();
      if (response.success && response.data) {
        const supportedExchanges = response.data
          .filter((ex) => ex.supported)
          .map((ex) => ({ id: ex.id as SupportedExchange, name: ex.name }));
        setExchanges(supportedExchanges);
      }
    }
    loadExchanges();
  }, []);

  // Auto-switch market type and quote for Hyperliquid (perpetual-only exchange)
  useEffect(() => {
    if (selectedExchange === 'hyperliquid') {
      setMarketType('perp');
      setQuoteFilter('USDC');
      setSelectedSymbol('');
      setBids([]);
      setAsks([]);
    }
  }, [selectedExchange]);

  // Auto-switch market type and quote for Upbit (spot-only exchange)
  useEffect(() => {
    if (selectedExchange === 'upbit') {
      setMarketType('spot');
      setQuoteFilter('KRW');
      setSelectedSymbol('');
      setBids([]);
      setAsks([]);
    }
  }, [selectedExchange]);

  // Load tickers when exchange or market type changes
  useEffect(() => {
    async function loadTickers() {
      if (!selectedExchange) return;

      setTickersLoading(true);
      setError(null);

      try {
        const allTickers: Ticker[] = [];
        let currentPage = 1;
        let hasMorePages = true;
        const pageLimit = 500;

        while (hasMorePages) {
          const response = await LazuliAPI.getTickers(selectedExchange, {
            page: currentPage,
            limit: pageLimit,
            sortBy: 'volume',
            sortOrder: 'desc',
            type: marketType,
          });

          if (!response.success || !response.data) {
            if (currentPage === 1) {
              setError(response.error || 'Failed to load tickers');
            }
            break;
          }

          allTickers.push(...response.data.tickers);

          if (response.data.pagination && response.data.pagination.hasNext) {
            currentPage++;
          } else {
            hasMorePages = false;
          }
        }

        const uniqueTickers = Array.from(new Map(allTickers.map((t) => [t.symbol, t])).values());
        setTickers(uniqueTickers);
      } catch {
        setError('Failed to load tickers');
      } finally {
        setTickersLoading(false);
      }
    }

    loadTickers();
  }, [selectedExchange, marketType]);

  /**
   * Get all available quote currencies from tickers
   */
  const availableQuotes = useMemo(() => {
    const quotes = new Set<string>();
    tickers.forEach((ticker) => {
      const quote = getQuoteCurrency(ticker.symbol);
      if (quote) {
        quotes.add(quote.toUpperCase());
      }
    });

    const sortedQuotes = Array.from(quotes).sort((a, b) => {
      const priorityOrder = ['USDT', 'BTC', 'ETH', 'USDC'];
      const stablecoins = ['BUSD', 'DAI', 'FDUSD', 'TUSD'];

      const aPriority = priorityOrder.indexOf(a);
      const bPriority = priorityOrder.indexOf(b);

      if (aPriority !== -1 && bPriority !== -1) return aPriority - bPriority;
      if (aPriority !== -1) return -1;
      if (bPriority !== -1) return 1;

      const aIsStable = stablecoins.includes(a);
      const bIsStable = stablecoins.includes(b);

      if (aIsStable && bIsStable) return a.localeCompare(b);
      if (aIsStable) return -1;
      if (bIsStable) return 1;

      return a.localeCompare(b);
    });

    return sortedQuotes;
  }, [tickers]);

  // Filter tickers based on search query and quote currency
  const filteredTickers = useMemo(() => {
    return tickers
      .filter((t) => {
        const matchesSearch =
          !searchQuery || t.symbol.toLowerCase().includes(searchQuery.toLowerCase());
        const tickerQuote = getQuoteCurrency(t.symbol).toUpperCase();
        const matchesQuote = tickerQuote === quoteFilter;
        return matchesSearch && matchesQuote;
      })
      .sort((a, b) => {
        const prioritySymbols = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE'];
        const aBase = parseSymbol(a.symbol).base.toUpperCase();
        const bBase = parseSymbol(b.symbol).base.toUpperCase();
        const aPriority = prioritySymbols.indexOf(aBase);
        const bPriority = prioritySymbols.indexOf(bBase);

        if (aPriority !== -1 && bPriority !== -1) return aPriority - bPriority;
        if (aPriority !== -1) return -1;
        if (bPriority !== -1) return 1;

        return a.symbol.localeCompare(b.symbol);
      });
  }, [tickers, searchQuery, quoteFilter]);

  /**
   * Fetch order book data
   */
  const fetchOrderBook = useCallback(async () => {
    if (!selectedSymbol) return;

    setLoading(true);
    setError(null);

    try {
      const response = await LazuliAPI.getOrderBook(selectedExchange, selectedSymbol, {
        type: marketType,
        limit: depth,
      });

      if (response.success && response.data) {
        setBids(response.data.orderbook.bids);
        setAsks(response.data.orderbook.asks);
        setSpread(response.data.spread);
        setSpreadPercent(response.data.spreadPercent);
        setMidPrice(response.data.midPrice);
        setLastUpdate(new Date());
      } else {
        setError(response.error || 'Failed to fetch order book');
      }
    } catch {
      setError('Failed to fetch order book');
    } finally {
      setLoading(false);
    }
  }, [selectedExchange, selectedSymbol, marketType, depth]);

  // Fetch order book when symbol changes
  useEffect(() => {
    if (selectedSymbol) {
      fetchOrderBook();
    }
  }, [selectedSymbol, fetchOrderBook]);

  // Auto-refresh interval
  useEffect(() => {
    if (!autoRefresh || !selectedSymbol) return;

    const interval = setInterval(() => {
      fetchOrderBook();
    }, 2000); // Refresh every 2 seconds

    return () => clearInterval(interval);
  }, [autoRefresh, selectedSymbol, fetchOrderBook]);

  /**
   * Calculate max total for depth visualization scaling
   */
  const maxTotal = useMemo(() => {
    const maxBidTotal = bids.length > 0 ? bids[bids.length - 1].total : 0;
    const maxAskTotal = asks.length > 0 ? asks[asks.length - 1].total : 0;
    return Math.max(maxBidTotal, maxAskTotal);
  }, [bids, asks]);

  /**
   * Calculate total bid/ask volumes
   */
  const totalBidVolume = bids.length > 0 ? bids[bids.length - 1].total : 0;
  const totalAskVolume = asks.length > 0 ? asks[asks.length - 1].total : 0;
  const bidAskRatio =
    totalBidVolume + totalAskVolume > 0
      ? (totalBidVolume / (totalBidVolume + totalAskVolume)) * 100
      : 50;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        icon={BookOpen}
        title="Order Book"
        description="View real-time market depth with bid and ask orders. Analyze liquidity and price levels."
      />

      {/* Controls Card */}
      <Card className="glass border-white/5 overflow-hidden">
        <CardHeader className="border-b border-white/5 bg-white/5">
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            Market Selection
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          {/* Exchange and Market Type */}
          <div className="grid gap-6 md:grid-cols-2">
            {/* Exchange Selector */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-muted-foreground">Exchange</label>
              <div className="flex gap-2 flex-wrap">
                {exchanges.map((exchange) => (
                  <Button
                    key={exchange.id}
                    variant={selectedExchange === exchange.id ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setSelectedExchange(exchange.id);
                      setSelectedSymbol('');
                      setBids([]);
                      setAsks([]);
                    }}
                    className="transition-all"
                  >
                    {exchange.name}
                  </Button>
                ))}
              </div>
            </div>

            {/* Market Type Selector */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-muted-foreground">Market Type</label>
              <div className="flex p-1 bg-muted/50 rounded-lg w-fit">
                <Button
                  variant={marketType === 'spot' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => {
                    setMarketType('spot');
                    setSelectedSymbol('');
                    setBids([]);
                    setAsks([]);
                  }}
                  className="rounded-md"
                  disabled={selectedExchange === 'hyperliquid'}
                  title={
                    selectedExchange === 'hyperliquid'
                      ? 'Hyperliquid only supports perpetual markets'
                      : ''
                  }
                >
                  Spot
                </Button>
                <Button
                  variant={marketType === 'perp' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => {
                    setMarketType('perp');
                    setSelectedSymbol('');
                    setBids([]);
                    setAsks([]);
                  }}
                  className="rounded-md"
                  disabled={selectedExchange === 'upbit'}
                  title={selectedExchange === 'upbit' ? 'Upbit only supports spot markets' : ''}
                >
                  Perpetual
                </Button>
              </div>
            </div>
          </div>

          {/* Quote Currency Filter */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-muted-foreground">Quote Currency</label>
            <div className="flex flex-wrap gap-1.5">
              {availableQuotes.map((quote) => {
                const count = tickers.filter((t) => {
                  const tickerQuote = getQuoteCurrency(t.symbol).toUpperCase();
                  return tickerQuote === quote;
                }).length;
                const icon = getCurrencyIcon(quote);
                return (
                  <Button
                    key={quote}
                    variant={quoteFilter === quote ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setQuoteFilter(quote)}
                    className="gap-1.5"
                  >
                    {icon && <span className="text-base">{icon}</span>}
                    <span>{quote}</span>
                    <span className="text-muted-foreground text-xs opacity-70">({count})</span>
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Symbol Selector */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-muted-foreground">
              Select Symbol ({filteredTickers.length} available)
            </label>
            <div className="border border-white/10 rounded-xl overflow-hidden bg-background/50 backdrop-blur-sm">
              <div className="p-3 border-b border-white/5 bg-white/5">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="Search symbols..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 h-10 bg-transparent border-none focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                </div>
              </div>
              <div className="max-h-48 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                {filteredTickers.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                    {tickersLoading ? (
                      <div className="animate-pulse">Loading tickers...</div>
                    ) : (
                      <>
                        <Search className="h-8 w-8 mb-2 opacity-20" />
                        <p className="text-sm">No tickers found</p>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                    {filteredTickers.map((ticker) => (
                      <button
                        key={ticker.symbol}
                        onClick={() => setSelectedSymbol(ticker.symbol)}
                        className={`text-left px-4 py-3 rounded-lg text-sm transition-all duration-200 border border-transparent ${
                          selectedSymbol === ticker.symbol
                            ? 'bg-primary/20 border-primary/50 text-primary font-medium shadow-[0_0_15px_rgba(var(--primary),0.3)]'
                            : 'hover:bg-white/5 hover:border-white/10'
                        }`}
                      >
                        {ticker.symbol}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Error Display */}
          {error && !selectedSymbol && (
            <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl flex items-center gap-3 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <p className="text-sm font-medium">{error}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Order Book Display */}
      {selectedSymbol && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-500">
          {/* Header with controls */}
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <h2 className="text-2xl font-display font-bold">
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-primary to-purple-400">
                  {selectedSymbol}
                </span>
              </h2>
              <Badge variant="outline" className="bg-background/50">
                {marketType === 'spot' ? 'Spot' : 'Perpetual'}
              </Badge>
            </div>

            <div className="flex items-center gap-3">
              {/* Depth selector */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Depth:</span>
                <div className="flex gap-1">
                  {[10, 25, 50, 100].map((d) => (
                    <Button
                      key={d}
                      variant={depth === d ? 'secondary' : 'ghost'}
                      size="sm"
                      onClick={() => setDepth(d)}
                      className="h-8 px-3"
                    >
                      {d}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Auto-refresh toggle */}
              <Button
                variant={autoRefresh ? 'default' : 'outline'}
                size="sm"
                onClick={() => setAutoRefresh(!autoRefresh)}
                className="gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${autoRefresh ? 'animate-spin' : ''}`} />
                {autoRefresh ? 'Live' : 'Auto'}
              </Button>

              {/* Manual refresh */}
              <Button
                variant="outline"
                size="sm"
                onClick={fetchOrderBook}
                disabled={loading}
                className="gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="glass border-white/5">
              <CardContent className="p-4">
                <div className="text-sm text-muted-foreground mb-1">Mid Price</div>
                <div className="text-xl font-mono font-bold">
                  {midPrice !== null ? formatPrice(midPrice) : '-'}
                </div>
              </CardContent>
            </Card>
            <Card className="glass border-white/5">
              <CardContent className="p-4">
                <div className="text-sm text-muted-foreground mb-1">Spread</div>
                <div className="text-xl font-mono font-bold">
                  {spread !== null ? formatPrice(spread) : '-'}
                  {spreadPercent !== null && (
                    <span className="text-sm text-muted-foreground ml-2">
                      ({spreadPercent.toFixed(4)}%)
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
            <Card className="glass border-white/5">
              <CardContent className="p-4">
                <div className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                  <TrendingUp className="h-4 w-4 text-green-500" />
                  Bid Volume
                </div>
                <div className="text-xl font-mono font-bold text-green-500">
                  {formatAmount(totalBidVolume)}
                </div>
              </CardContent>
            </Card>
            <Card className="glass border-white/5">
              <CardContent className="p-4">
                <div className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                  <TrendingDown className="h-4 w-4 text-red-500" />
                  Ask Volume
                </div>
                <div className="text-xl font-mono font-bold text-red-500">
                  {formatAmount(totalAskVolume)}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Bid/Ask Ratio Bar */}
          <Card className="glass border-white/5">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-green-500 font-medium">
                  Bids {bidAskRatio.toFixed(1)}%
                </span>
                <span className="text-sm text-muted-foreground">Volume Ratio</span>
                <span className="text-sm text-red-500 font-medium">
                  Asks {(100 - bidAskRatio).toFixed(1)}%
                </span>
              </div>
              <div className="h-3 rounded-full overflow-hidden bg-red-500/30 flex">
                <div
                  className="h-full bg-gradient-to-r from-green-500 to-green-400 transition-all duration-500"
                  style={{ width: `${bidAskRatio}%` }}
                />
              </div>
            </CardContent>
          </Card>

          {/* Order Book Table */}
          <div className="grid md:grid-cols-2 gap-6">
            {/* Bids (Buy Orders) */}
            <Card className="glass border-white/5">
              <CardHeader className="border-b border-white/5 bg-green-500/5">
                <CardTitle className="flex items-center gap-2 text-green-500">
                  <TrendingUp className="h-5 w-5" />
                  Bids (Buy Orders)
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {loading && bids.length === 0 ? (
                  <div className="p-4 space-y-2">
                    {Array(10)
                      .fill(0)
                      .map((_, i) => (
                        <Skeleton key={i} className="h-8 w-full" />
                      ))}
                  </div>
                ) : (
                  <div className="divide-y divide-white/5">
                    {/* Header */}
                    <div className="grid grid-cols-3 gap-4 px-4 py-2 text-sm font-medium text-muted-foreground bg-white/5">
                      <div>Price</div>
                      <div className="text-right">Amount</div>
                      <div className="text-right">Total</div>
                    </div>
                    {/* Bid rows */}
                    <div className="max-h-[500px] overflow-y-auto custom-scrollbar">
                      {bids.map((bid, index) => (
                        <div
                          key={`bid-${index}`}
                          className="grid grid-cols-3 gap-4 px-4 py-2 text-sm font-mono relative hover:bg-white/5 transition-colors"
                        >
                          {/* Depth visualization bar */}
                          <div
                            className="absolute inset-0 bg-green-500/10 origin-right transition-all duration-300"
                            style={{ width: `${(bid.total / maxTotal) * 100}%` }}
                          />
                          <div className="relative text-green-500">{formatPrice(bid.price)}</div>
                          <div className="relative text-right">{formatAmount(bid.amount)}</div>
                          <div className="relative text-right text-muted-foreground">
                            {formatAmount(bid.total)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Asks (Sell Orders) */}
            <Card className="glass border-white/5">
              <CardHeader className="border-b border-white/5 bg-red-500/5">
                <CardTitle className="flex items-center gap-2 text-red-500">
                  <TrendingDown className="h-5 w-5" />
                  Asks (Sell Orders)
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {loading && asks.length === 0 ? (
                  <div className="p-4 space-y-2">
                    {Array(10)
                      .fill(0)
                      .map((_, i) => (
                        <Skeleton key={i} className="h-8 w-full" />
                      ))}
                  </div>
                ) : (
                  <div className="divide-y divide-white/5">
                    {/* Header */}
                    <div className="grid grid-cols-3 gap-4 px-4 py-2 text-sm font-medium text-muted-foreground bg-white/5">
                      <div>Price</div>
                      <div className="text-right">Amount</div>
                      <div className="text-right">Total</div>
                    </div>
                    {/* Ask rows */}
                    <div className="max-h-[500px] overflow-y-auto custom-scrollbar">
                      {asks.map((ask, index) => (
                        <div
                          key={`ask-${index}`}
                          className="grid grid-cols-3 gap-4 px-4 py-2 text-sm font-mono relative hover:bg-white/5 transition-colors"
                        >
                          {/* Depth visualization bar */}
                          <div
                            className="absolute inset-0 bg-red-500/10 origin-left transition-all duration-300"
                            style={{ width: `${(ask.total / maxTotal) * 100}%` }}
                          />
                          <div className="relative text-red-500">{formatPrice(ask.price)}</div>
                          <div className="relative text-right">{formatAmount(ask.amount)}</div>
                          <div className="relative text-right text-muted-foreground">
                            {formatAmount(ask.total)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Last Update */}
          {lastUpdate && (
            <div className="text-center text-sm text-muted-foreground">
              Last updated: {lastUpdate.toLocaleTimeString()}
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl flex items-center gap-3 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <p className="text-sm font-medium">{error}</p>
            </div>
          )}
        </div>
      )}

      {/* Empty State */}
      {!selectedSymbol && !error && (
        <Card className="glass border-white/5 border-dashed">
          <CardContent className="py-24 text-center">
            <div className="w-20 h-20 bg-muted/30 rounded-full flex items-center justify-center mx-auto mb-6">
              <BookOpen className="h-10 w-10 text-muted-foreground/50" />
            </div>
            <h3 className="text-2xl font-display font-bold mb-3">Select a Trading Pair</h3>
            <p className="text-muted-foreground max-w-md mx-auto text-lg font-light">
              Choose an exchange and symbol above to view the real-time order book with market depth
              visualization.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
