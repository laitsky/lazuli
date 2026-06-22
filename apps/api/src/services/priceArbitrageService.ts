import type {
  PriceArbitrageOpportunity,
  PriceArbitrageQuote,
  PriceArbitrageResponse,
  SupportedExchange,
  Ticker,
} from '@lazuli/shared';

export interface PriceArbitrageExchangeTickers {
  exchange: SupportedExchange;
  tickers: Ticker[];
}

export interface PriceArbitrageOptions {
  type: 'spot' | 'perp';
  quote: string;
  minSpreadBps: number;
  limit: number;
}

interface CandidateQuote extends PriceArbitrageQuote {
  buyPrice: number;
  sellPrice: number;
}

/**
 * Build cross-exchange price discrepancy opportunities from already-fetched
 * ticker snapshots. The service is pure so spread math and symbol
 * normalization stay easy to test without Worker bindings.
 */
export function buildPriceArbitrageResponse(
  exchangeTickers: PriceArbitrageExchangeTickers[],
  options: PriceArbitrageOptions
): PriceArbitrageResponse {
  const quoteCurrency = options.quote.toUpperCase();
  const byAsset = new Map<string, CandidateQuote[]>();

  for (const { exchange, tickers } of exchangeTickers) {
    for (const ticker of tickers) {
      const asset = normalizeArbitrageAsset(ticker.symbol, ticker.type, quoteCurrency);
      if (!asset || ticker.type !== options.type) {
        continue;
      }

      const price = ticker.last ?? midpoint(ticker.bid, ticker.ask);
      const buyPrice = ticker.ask ?? ticker.last ?? null;
      const sellPrice = ticker.bid ?? ticker.last ?? null;
      if (price === null || buyPrice === null || sellPrice === null || buyPrice <= 0) {
        continue;
      }

      const quotes = byAsset.get(asset) ?? [];
      quotes.push({
        exchange,
        symbol: ticker.symbol,
        price,
        bid: ticker.bid,
        ask: ticker.ask,
        last: ticker.last,
        timestamp: ticker.timestamp,
        buyPrice,
        sellPrice,
      });
      byAsset.set(asset, quotes);
    }
  }

  const opportunities: PriceArbitrageOpportunity[] = [];
  for (const [asset, quotes] of byAsset.entries()) {
    const uniqueExchanges = new Set(quotes.map((quote) => quote.exchange));
    if (uniqueExchanges.size < 2) {
      continue;
    }

    let best: { buy: CandidateQuote; sell: CandidateQuote; spreadBps: number } | null = null;
    for (const buy of quotes) {
      for (const sell of quotes) {
        if (buy.exchange === sell.exchange) {
          continue;
        }
        const spreadBps = ((sell.sellPrice - buy.buyPrice) / buy.buyPrice) * 10_000;
        if (!best || spreadBps > best.spreadBps) {
          best = { buy, sell, spreadBps };
        }
      }
    }

    if (!best || best.spreadBps < options.minSpreadBps) {
      continue;
    }

    opportunities.push({
      asset,
      marketType: options.type,
      quoteCurrency,
      bestBuyExchange: best.buy.exchange,
      bestSellExchange: best.sell.exchange,
      buyPrice: best.buy.buyPrice,
      sellPrice: best.sell.sellPrice,
      spread: best.sell.sellPrice - best.buy.buyPrice,
      spreadBps: best.spreadBps,
      quotes: quotes
        .map(({ buyPrice: _buyPrice, sellPrice: _sellPrice, ...quote }) => quote)
        .sort((a, b) => a.exchange.localeCompare(b.exchange)),
      timestamp: Math.max(...quotes.map((quote) => quote.timestamp)),
    });
  }

  const sorted = opportunities.sort((a, b) => b.spreadBps - a.spreadBps).slice(0, options.limit);

  return {
    opportunities: sorted,
    count: sorted.length,
    exchanges: exchangeTickers.map((item) => item.exchange),
    marketType: options.type,
    quoteCurrency,
    minSpreadBps: options.minSpreadBps,
    timestamp: Date.now(),
  };
}

/**
 * Normalize exchange-specific spot/perp symbols into a base asset for grouping.
 * Spot symbols are expected as BASE-QUOTE; perpetuals commonly arrive as
 * BASEQUOTE.P. Symbols that do not match the requested quote are ignored.
 */
export function normalizeArbitrageAsset(
  symbol: string,
  type: 'spot' | 'perp',
  quoteCurrency: string
): string | null {
  const quote = quoteCurrency.toUpperCase();
  if (type === 'spot') {
    const [base, symbolQuote] = symbol.split('-');
    if (!base || symbolQuote?.toUpperCase() !== quote) {
      return null;
    }
    return base.toUpperCase();
  }

  const withoutSuffix = symbol.endsWith('.P') ? symbol.slice(0, -2) : symbol;
  if (!withoutSuffix.toUpperCase().endsWith(quote)) {
    return null;
  }
  const base = withoutSuffix.slice(0, withoutSuffix.length - quote.length);
  return base ? base.toUpperCase() : null;
}

function midpoint(bid: number | null, ask: number | null): number | null {
  if (bid === null || ask === null) {
    return null;
  }
  return (bid + ask) / 2;
}
