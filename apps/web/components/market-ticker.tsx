import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LazuliAPI, formatCurrency, formatPercentage, getChangeColor } from '@/lib/api-client';
import { TrendingUp, TrendingDown } from 'lucide-react';

export async function MarketTicker() {
  // Fetch key assets for the ticker using a single API call for better performance
  // We'll get top volume tickers from Binance and filter for our desired symbols
  const exchange = 'binance';
  const desiredSymbols = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'XRP/USDT'];

  // Single API call to fetch all tickers, then filter for our desired symbols
  const response = await LazuliAPI.getTickers(exchange, {
    limit: 100, // Get enough tickers to ensure we have all our desired symbols
    type: 'spot',
    sortBy: 'volume',
    sortOrder: 'desc',
  });

  // Filter response to only include our desired symbols, maintaining order
  const allTickers = response.success ? response.data.tickers : [];
  const tickers = desiredSymbols
    .map((symbol) => allTickers.find((t) => t.symbol === symbol))
    .filter((t) => t !== undefined);

  if (tickers.length === 0) {
    return null; // Don't show if no data
  }

  return (
    <div className="w-full overflow-hidden py-4 border-y border-white/5 bg-black/20 backdrop-blur-sm">
      <div className="flex animate-scroll gap-8 min-w-full px-4">
        {/* Duplicate list for seamless scrolling effect if we had more items, 
            but for now just a static flex row that wraps on mobile is fine, 
            or a simple horizontal scroll */}
        <div className="flex flex-wrap md:flex-nowrap gap-4 md:gap-8 justify-center w-full">
          {tickers.map((ticker) => (
            <Link
              key={ticker.symbol}
              href={`/markets?exchange=${exchange}&symbol=${ticker.symbol}`}
              className="group flex items-center gap-3 min-w-[200px] px-4 py-2 rounded-lg hover:bg-white/5 transition-colors"
            >
              <div className="flex flex-col gap-0.5">
                <span className="font-bold text-sm text-muted-foreground group-hover:text-primary transition-colors leading-tight">
                  {ticker.symbol.split('/')[0]}
                </span>
                <span className="font-mono text-xs text-muted-foreground/50 leading-tight">
                  {ticker.symbol.split('/')[1]}
                </span>
              </div>

              <div className="flex flex-col items-end ml-auto">
                <span className="font-mono font-medium">{formatCurrency(ticker.last)}</span>
                <div
                  className={`flex items-center text-xs ${getChangeColor(ticker.percentage24h)}`}
                >
                  {(ticker.percentage24h ?? 0) >= 0 ? (
                    <TrendingUp className="h-3 w-3 mr-1" />
                  ) : (
                    <TrendingDown className="h-3 w-3 mr-1" />
                  )}
                  {formatPercentage(ticker.percentage24h)}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
