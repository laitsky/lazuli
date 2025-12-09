import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LazuliAPI, formatCurrency, formatPercentage } from '@/lib/api-client';
import { TrendingUp } from 'lucide-react';
import type { Ticker } from '@lazuli/shared';

/**
 * Top Gainers Widget - Terminal Luxe
 * Displays the top 5 coins with highest 24h gains
 */
export function TopGainers() {
  const [gainers, setGainers] = useState<Ticker[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchGainers() {
      const response = await LazuliAPI.getTickers('binance', {
        limit: 5,
        sortBy: 'change',
        sortOrder: 'desc',
        type: 'spot',
        quote: 'USDT',
      });

      if (response.success) {
        setGainers(response.data.tickers);
      }
      setLoading(false);
    }
    fetchGainers();
  }, []);

  if (loading) {
    return (
      <div className="bg-card rounded-xl border border-border h-full flex flex-col animate-pulse">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="h-4 w-20 bg-secondary rounded" />
          <div className="h-3 w-12 bg-secondary rounded" />
        </div>
        <div className="flex-1 p-2 space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center justify-between p-2">
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 bg-secondary rounded" />
                <div className="space-y-1">
                  <div className="h-4 w-12 bg-secondary rounded" />
                  <div className="h-3 w-16 bg-secondary rounded" />
                </div>
              </div>
              <div className="h-5 w-14 bg-secondary rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

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
          to="/markets?sortBy=change&sortOrder=desc"
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
            to={`/markets?exchange=binance&symbol=${ticker.symbol}`}
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
