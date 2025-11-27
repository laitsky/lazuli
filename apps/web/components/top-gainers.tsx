import Link from 'next/link';
import { LazuliAPI, formatCurrency, formatPercentage } from '@/lib/api-client';
import { TrendingUp, ArrowUpRight } from 'lucide-react';

/**
 * Top Gainers Widget - Terminal Luxe
 * Displays the top 5 coins with highest 24h gains
 */
export async function TopGainers() {
  const response = await LazuliAPI.getTickers('binance', {
    limit: 5,
    sortBy: 'change',
    sortOrder: 'desc',
    type: 'spot',
    quote: 'USDT',
  });

  const gainers = response.success ? response.data.tickers : [];

  if (gainers.length === 0) {
    return null;
  }

  return (
    <div className="bg-card rounded-xl border border-border h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-[hsl(152_60%_45%)]" />
          <span className="text-sm font-semibold text-foreground">Gainers</span>
        </div>
        <Link
          href="/markets?sortBy=change&sortOrder=desc"
          className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-primary transition-colors"
        >
          View All
        </Link>
      </div>

      {/* List */}
      <div className="flex-1 p-2">
        {gainers.map((ticker, index) => (
          <Link
            key={ticker.symbol}
            href={`/markets?exchange=binance&symbol=${ticker.symbol}`}
            className="flex items-center justify-between p-2 rounded-lg hover:bg-accent transition-colors group"
          >
            <div className="flex items-center gap-2.5">
              <span className="w-4 text-xs font-mono text-muted-foreground/50 group-hover:text-[hsl(152_60%_45%)] transition-colors">
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
            <span className="text-xs font-mono text-[hsl(152_60%_50%)] bg-[hsl(152_60%_45%/0.1)] px-2 py-1 rounded">
              {formatPercentage(ticker.percentage24h)}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
