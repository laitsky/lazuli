import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LazuliAPI, formatCurrency, formatPercentage } from '@/lib/api-client';
import { TrendingUp, TrendingDown } from 'lucide-react';
import type { Ticker } from '@lazuli/shared';

/**
 * Market Ticker Strip - Terminal Luxe
 * Displays key market prices in a clean horizontal strip
 */
export function MarketTicker() {
  const exchange = 'binance';
  const desiredSymbols = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'XRP/USDT'];
  const [tickers, setTickers] = useState<Ticker[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchTickers() {
      const response = await LazuliAPI.getTickers(exchange, {
        limit: 100,
        type: 'spot',
        sortBy: 'volume',
        sortOrder: 'desc',
      });

      if (response.success) {
        const allTickers = response.data.tickers;
        const filtered = desiredSymbols
          .map((symbol) => allTickers.find((t) => t.symbol === symbol))
          .filter((t): t is Ticker => t !== undefined);
        setTickers(filtered);
      }
      setLoading(false);
    }
    fetchTickers();
  }, []);

  if (loading) {
    return (
      <div className="w-full border-b border-border bg-card/50">
        <div className="flex items-center justify-center gap-4 px-4 py-2.5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-2 animate-pulse">
              <div className="h-4 w-12 bg-secondary rounded" />
              <div className="h-4 w-16 bg-secondary rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (tickers.length === 0) {
    return null;
  }

  return (
    <div className="w-full border-b border-border bg-card/50">
      <div className="flex items-center justify-center gap-1 px-4 py-2.5 overflow-x-auto no-scrollbar">
        {tickers.map((ticker, index) => {
          const isPositive = (ticker.percentage24h ?? 0) >= 0;

          return (
            <Link
              key={ticker.symbol}
              to={`/markets?exchange=${exchange}&symbol=${ticker.symbol}`}
              className="group flex items-center gap-3 px-4 py-1.5 rounded-lg hover:bg-accent transition-colors shrink-0"
            >
              {/* Symbol */}
              <div className="flex items-baseline gap-1">
                <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                  {ticker.symbol.split('/')[0]}
                </span>
                <span className="text-[10px] font-mono text-muted-foreground">
                  /{ticker.symbol.split('/')[1]}
                </span>
              </div>

              {/* Price & Change */}
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono text-foreground">
                  {formatCurrency(ticker.last)}
                </span>
                <span
                  className={`inline-flex items-center gap-0.5 text-xs font-mono ${
                    isPositive ? 'text-[hsl(152_60%_50%)]' : 'text-destructive'
                  }`}
                >
                  {isPositive ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : (
                    <TrendingDown className="h-3 w-3" />
                  )}
                  {formatPercentage(ticker.percentage24h)}
                </span>
              </div>

              {/* Separator */}
              {index < tickers.length - 1 && <div className="w-px h-4 bg-border ml-2" />}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
