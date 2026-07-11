/**
 * Live market strip — topbar right zone
 *
 * Shows BTC/ETH/SOL prices with 24h % change from one shared ticker request.
 * The query is disabled when the strip is hidden below the desktop breakpoint.
 */

import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useTopbarPrices } from '@/lib/queries';
import { formatPrice } from '@/lib/format';
import type { Ticker } from '@lazuli/shared';
import { RESOURCE_POLICY } from '@/lib/resource-policy';

interface TopbarPricesProps {
  exchange?: string;
}

export function TopbarPrices({ exchange = 'bybit' }: TopbarPricesProps) {
  const enabled = useMediaQuery(RESOURCE_POLICY.topbarMediaQuery);
  const { data, isLoading, isError } = useTopbarPrices(exchange, enabled);

  if (!enabled) return null;

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
        <PriceChip key={symbol} symbol={symbol} ticker={ticker} exchange={exchange} />
      ))}
    </div>
  );
}

function PriceChip({
  symbol,
  ticker,
  exchange,
}: {
  symbol: string;
  ticker: Ticker | null;
  exchange: string;
}) {
  const base = symbol.split('-')[0];
  const price = ticker?.last ?? null;
  const pct = ticker?.percentage24h ?? null;
  const isUp = (pct ?? 0) >= 0;

  return (
    <Link
      to={`/workspace?exchange=${exchange}&symbol=${symbol}&type=spot&timeframe=1h`}
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

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);

  return matches;
}
