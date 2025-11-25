import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LazuliAPI, formatCurrency, formatPercentage, getChangeColor } from '@/lib/api-client';
import { TrendingDown } from 'lucide-react';

/**
 * Top Losers Widget - Displays the top 5 coins with biggest 24h losses
 * Filters by USDT quote currency for meaningful comparison
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
    <Card className="glass border-primary/10 h-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-red-500" />
              Top Losers
            </CardTitle>
            <CardDescription>Biggest drops (24h)</CardDescription>
          </div>
          <Button variant="ghost" size="sm" className="h-8 text-xs" asChild>
            <Link href="/markets?sortBy=change&sortOrder=asc">View All</Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {losers.map((ticker, index) => (
            <Link
              key={ticker.symbol}
              href={`/markets?exchange=binance&symbol=${ticker.symbol}`}
              className="flex items-center justify-between p-2.5 rounded-lg hover:bg-white/5 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <div className="font-display font-bold text-sm w-5 text-muted-foreground/50 group-hover:text-red-500 transition-colors">
                  {index + 1}
                </div>
                <div>
                  <div className="font-bold text-sm">{ticker.symbol.split('-')[0]}</div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {formatCurrency(ticker.last)}
                  </div>
                </div>
              </div>
              <Badge
                variant="secondary"
                className={`text-xs h-6 ${getChangeColor(ticker.percentage24h)} bg-red-500/10 border-red-500/20`}
              >
                {formatPercentage(ticker.percentage24h)}
              </Badge>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
