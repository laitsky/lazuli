/**
 * Live market strip — topbar right zone
 *
 * Shows BTC/ETH/SOL prices with 24h % change. Updates every 10s via
 * TanStack Query. Hidden on mobile (<md) to preserve space.
 */

import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useTopbarPrices } from '@/lib/queries';
import { formatPrice } from '@/lib/format';
import type { Ticker } from '@lazuli/shared';

interface TopbarPricesProps {
  exchange?: string;
}

export function TopbarPrices({ exchange = 'bybit' }: TopbarPricesProps) {
  const { data, isLoading, isError } = useTopbarPrices(exchange);

  if (isError) {
    return (
      <div className="hidden lg:flex items-center text-xs text-muted-foreground font-mono">
        <span className="status-dead h-1.5 w-1.5 rounded-full bg-destructive mr-2" />
        offline
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="hidden lg:flex items-center gap-4 animate-pulse">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-6 w-20 bg-surface-2 rounded" />
        ))}
      </div>
    );
  }

  return (
    <div className="hidden md:flex items-center gap-1 lg:gap-3">
      {data.map(({ symbol, ticker }) => (
        <PriceChip key={symbol} symbol={symbol} ticker={ticker} />
      ))}
    </div>
  );
}

function PriceChip({ symbol, ticker }: { symbol: string; ticker: Ticker | null }) {
  const base = symbol.split('-')[0];
  const price = ticker?.last ?? null;
  const pct = ticker?.percentage24h ?? null;
  const isUp = (pct ?? 0) >= 0;

  return (
    <Link
      to={`/workspace?exchange=bybit&symbol=${symbol}&type=spot&timeframe=1h`}
      className={cn(
        'group flex items-center gap-1.5 px-2 py-1 rounded',
        'hover:bg-surface-2 transition-colors',
        'no-tap-highlight'
      )}
      title={`${symbol} — click to open in workspace`}
    >
      <span className="text-[10px] font-mono font-medium text-muted-foreground group-hover:text-foreground transition-colors">
        {base}
      </span>
      {price !== null ? (
        <span className="numeric text-xs font-medium text-foreground">${formatPrice(price)}</span>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      )}
      {pct !== null && (
        <span className={cn('numeric text-[10px] font-medium', isUp ? 'text-up' : 'text-down')}>
          {isUp ? '+' : ''}
          {pct.toFixed(1)}%
        </span>
      )}
    </Link>
  );
}
