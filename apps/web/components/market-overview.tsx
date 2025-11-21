import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  LazuliAPI,
  formatCurrency,
  formatVolume,
  formatPercentage,
  getChangeColor,
} from '@/lib/api-client';
import { ArrowRight, TrendingUp, TrendingDown, BarChart3 } from 'lucide-react';

export async function MarketOverview() {
  // Fetch top volume tickers from Binance
  const response = await LazuliAPI.getTickers('binance', {
    limit: 5,
    sortBy: 'volume',
    sortOrder: 'desc',
    type: 'spot',
  });

  const tickers = response.success ? response.data.tickers : [];

  if (tickers.length === 0) {
    return null;
  }

  return (
    <Card className="glass border-primary/10 h-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              Top Volume
            </CardTitle>
            <CardDescription>Highest volume assets (24h)</CardDescription>
          </div>
          <Button variant="ghost" size="sm" className="h-8 text-xs" asChild>
            <Link href="/markets">View All</Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {tickers.map((ticker) => (
            <Link
              key={ticker.symbol}
              href={`/markets?exchange=binance&symbol=${ticker.symbol}`}
              className="flex items-center justify-between p-3 rounded-lg hover:bg-white/5 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <div className="font-display font-bold text-lg w-8 text-muted-foreground/50 group-hover:text-primary transition-colors">
                  {tickers.indexOf(ticker) + 1}
                </div>
                <div>
                  <div className="font-bold">{ticker.symbol.split('/')[0]}</div>
                  <div className="text-xs text-muted-foreground">
                    Vol: {formatVolume(ticker.quoteVolume24h)}
                  </div>
                </div>
              </div>

              <div className="text-right">
                <div className="font-mono font-medium">{formatCurrency(ticker.last)}</div>
                <Badge
                  variant="secondary"
                  className={`text-[10px] h-5 ${getChangeColor(ticker.percentage24h)} bg-background/50`}
                >
                  {formatPercentage(ticker.percentage24h)}
                </Badge>
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
