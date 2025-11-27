import Link from 'next/link';
import { LazuliAPI, formatCurrency, formatPercentage } from '@/lib/api-client';
import { TrendingDown } from 'lucide-react';

/**
 * Top Losers Widget - Terminal Luxe
 * Displays the top 5 coins with biggest 24h losses
 */
export async function TopLosers() {
  const response = await LazuliAPI.getTickers('binance', {
    limit: 5,
    sortBy: 'change',
    sortOrder: 'asc',
    type: 'spot',
    quote: 'USDT',
  });

  const losers = response.success ? response.data.tickers : [];

  if (losers.length === 0) {
    return null;
  }

  return (
    <div className="bg-card rounded-xl border border-border h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <TrendingDown className="h-4 w-4 text-destructive" />
          <span className="text-sm font-semibold text-foreground">Losers</span>
        </div>
        <Link
          href="/markets?sortBy=change&sortOrder=asc"
          className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-primary transition-colors"
        >
          View All
        </Link>
      </div>

      {/* List */}
      <div className="flex-1 p-2">
        {losers.map((ticker, index) => (
          <Link
            key={ticker.symbol}
            href={`/markets?exchange=binance&symbol=${ticker.symbol}`}
            className="flex items-center justify-between p-2 rounded-lg hover:bg-accent transition-colors group"
          >
            <div className="flex items-center gap-2.5">
              <span className="w-4 text-xs font-mono text-muted-foreground/50 group-hover:text-destructive transition-colors">
                {index + 1}
              </span>
              <div>
                <div className="text-sm font-semibold text-foreground">
                  {ticker.symbol.split('-')[0]}
                </div>
                <div className="text-[10px] font-mono text-muted-foreground">
                  {formatCurrency(ticker.last)}
                </div>
              </div>
            </div>
            <span className="text-xs font-mono text-destructive bg-destructive/10 px-2 py-1 rounded">
              {formatPercentage(ticker.percentage24h)}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
