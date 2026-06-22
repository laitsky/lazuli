import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { LazuliAPI } from '@/lib/api-client';
import { formatPrice } from '@/lib/format';
import type { PriceArbitrageOpportunity, PriceArbitrageResponse } from '@lazuli/shared';
import { AlertCircle, ArrowRightLeft, RefreshCw, Search } from 'lucide-react';

export default function PriceArbitragePage() {
  const [marketType, setMarketType] = useState<'spot' | 'perp'>('spot');
  const [quote, setQuote] = useState('USDT');
  const [minSpreadBps, setMinSpreadBps] = useState(10);
  const [searchQuery, setSearchQuery] = useState('');
  const [data, setData] = useState<PriceArbitrageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadArbitrage = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const response = await LazuliAPI.getPriceArbitrage({
        type: marketType,
        quote,
        minSpreadBps,
        limit: 100,
      });

      if (response.success && response.data) {
        setData(response.data);
      } else {
        setError(response.error || 'Failed to load price arbitrage opportunities');
      }

      setLoading(false);
      setRefreshing(false);
    },
    [marketType, minSpreadBps, quote]
  );

  useEffect(() => {
    loadArbitrage();
  }, [loadArbitrage]);

  const filteredOpportunities = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const opportunities = data?.opportunities ?? [];
    if (!query) {
      return opportunities;
    }
    return opportunities.filter(
      (item) =>
        item.asset.toLowerCase().includes(query) ||
        item.bestBuyExchange.toLowerCase().includes(query) ||
        item.bestSellExchange.toLowerCase().includes(query)
    );
  }, [data?.opportunities, searchQuery]);

  const topOpportunity = filteredOpportunities[0];

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ArrowRightLeft}
        title="Price Arbitrage"
        description="Discover cross-exchange price discrepancies. This view does not execute trades or account for fees, slippage, transfer delays, or venue limits."
      />

      <Card>
        <CardContent className="grid gap-3 pt-5 md:grid-cols-2 xl:grid-cols-5">
          <Field label="Market Type">
            <select
              value={marketType}
              onChange={(event) => setMarketType(event.target.value as 'spot' | 'perp')}
              className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <option value="spot">Spot</option>
              <option value="perp">Perp</option>
            </select>
          </Field>
          <Field label="Quote">
            <select
              value={quote}
              onChange={(event) => setQuote(event.target.value)}
              className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <option value="USDT">USDT</option>
              <option value="USDC">USDC</option>
              <option value="KRW">KRW</option>
            </select>
          </Field>
          <Field label="Min Spread">
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              max={10000}
              value={minSpreadBps}
              onChange={(event) => setMinSpreadBps(Number(event.target.value))}
            />
          </Field>
          <Field label="Search">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Asset or exchange"
                className="pl-9"
              />
            </div>
          </Field>
          <div className="flex items-end">
            <Button
              type="button"
              onClick={() => loadArbitrage(true)}
              disabled={refreshing}
              className="h-11 w-full"
            >
              <RefreshCw className={refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="rounded-lg border border-primary/20 bg-primary/10 p-4 text-sm text-muted-foreground">
        <div className="flex gap-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p>
            Spreads use ticker ask for the buy side and bid for the sell side when available. Always
            account for fees, order book depth, borrow/transfer constraints, and execution latency
            before acting.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((item) => (
            <Skeleton key={item} className="h-28 w-full" />
          ))}
        </div>
      ) : filteredOpportunities.length === 0 ? (
        <Card>
          <CardContent className="pt-5 text-sm text-muted-foreground">
            No price discrepancies match the current filters.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Metric label="Matches" value={filteredOpportunities.length.toLocaleString()} />
              <Metric
                label="Best Spread"
                value={topOpportunity ? `${topOpportunity.spreadBps.toFixed(2)} bps` : 'N/A'}
              />
              <Metric
                label="Exchanges"
                value={
                  data?.exchanges.map((exchange) => exchange.toUpperCase()).join(', ') ?? 'N/A'
                }
              />
            </CardContent>
          </Card>

          <div className="space-y-3">
            {filteredOpportunities.map((opportunity) => (
              <OpportunityCard key={opportunity.asset} opportunity={opportunity} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function OpportunityCard({ opportunity }: { opportunity: PriceArbitrageOpportunity }) {
  return (
    <Card>
      <CardContent className="grid gap-4 pt-5 lg:grid-cols-[220px_minmax(0,1fr)_160px] lg:items-center">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-display text-2xl font-bold">{opportunity.asset}</h2>
            <Badge variant={opportunity.marketType === 'perp' ? 'default' : 'secondary'}>
              {opportunity.marketType.toUpperCase()}
            </Badge>
          </div>
          <p className="mt-1 text-xs font-mono uppercase tracking-wider text-muted-foreground">
            {opportunity.quoteCurrency} quoted
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <VenueBlock
            label="Buy"
            exchange={opportunity.bestBuyExchange}
            price={opportunity.buyPrice}
          />
          <VenueBlock
            label="Sell"
            exchange={opportunity.bestSellExchange}
            price={opportunity.sellPrice}
          />
        </div>

        <div className="rounded-lg border border-[hsl(152_60%_45%/0.25)] bg-[hsl(152_60%_45%/0.08)] p-3 text-right">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Spread
          </div>
          <div className="mt-1 font-display text-2xl font-bold text-[hsl(152_60%_50%)]">
            {opportunity.spreadBps.toFixed(2)}
          </div>
          <div className="text-xs text-muted-foreground">basis points</div>
        </div>
      </CardContent>
      <div className="border-t border-border px-5 py-3">
        <div className="flex flex-wrap gap-2">
          {opportunity.quotes.map((quote) => (
            <span
              key={`${opportunity.asset}-${quote.exchange}`}
              className="rounded-md border border-border bg-secondary/40 px-2 py-1 text-xs text-muted-foreground"
            >
              <span className="font-medium text-foreground">{quote.exchange}</span>{' '}
              {formatPrice(quote.price)}
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}

function VenueBlock({
  label,
  exchange,
  price,
}: {
  label: string;
  exchange: string;
  price: number;
}) {
  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-3">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold capitalize">{exchange}</div>
      <div className="mt-1 font-mono text-sm text-foreground">{formatPrice(price)}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-3">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
