/**
 * Exchanges Page - List all supported cryptocurrency exchanges
 * Shows exchange capabilities and links to their tickers/markets
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { LazuliAPI } from '@/lib/api-client';
import type { ExchangeInfo } from '@lazuli/shared';
import { ArrowRight, BarChart2, Check, X, Activity, Globe } from 'lucide-react';

export default function ExchangesPage() {
  const [exchanges, setExchanges] = useState<ExchangeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchExchanges() {
      const response = await LazuliAPI.getExchanges();
      if (response.success) {
        setExchanges(response.data);
      } else {
        setError(response.error);
      }
      setLoading(false);
    }
    fetchExchanges();
  }, []);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary/10 via-background to-background border border-white/10 p-8 md:p-12">
        <div className="absolute top-0 right-0 -mt-16 -mr-16 w-64 h-64 bg-primary/20 rounded-full blur-3xl opacity-50"></div>
        <div className="relative z-10 max-w-3xl">
          <h1 className="text-4xl md:text-6xl font-display font-bold tracking-tight mb-4 bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">
            Supported Exchanges
          </h1>
          <p className="text-lg md:text-xl font-light text-muted-foreground leading-relaxed">
            Connect to the world's leading cryptocurrency exchanges. Access real-time market data,
            spot trading, and perpetual futures through a unified interface.
          </p>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-64 rounded-xl bg-muted/50 animate-pulse" />
          ))}
        </div>
      )}

      {/* Error State */}
      {!loading && error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-destructive">Error Loading Exchanges</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* Exchanges Grid */}
      {!loading && !error && (
        <>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {exchanges.map((exchange) => (
              <Link key={exchange.id} href={`/markets?exchange=${exchange.id}`} className="group">
                <Card className="h-full glass glass-hover transition-all duration-300 border-white/5">
                  <CardHeader className="pb-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="p-2 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                        <Globe className="h-6 w-6" />
                      </div>
                      <Badge
                        variant={exchange.supported ? 'success' : 'secondary'}
                        className="uppercase text-xs tracking-wider"
                      >
                        {exchange.supported ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                    <CardTitle className="text-2xl font-display capitalize">
                      {exchange.name}
                    </CardTitle>
                    <CardDescription className="font-mono text-xs opacity-70">
                      ID: {exchange.id}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="flex flex-wrap gap-2">
                        {exchange.hasSpot && (
                          <Badge variant="outline" className="bg-background/50 backdrop-blur-sm">
                            Spot
                          </Badge>
                        )}
                        {exchange.hasPerp && (
                          <Badge variant="outline" className="bg-background/50 backdrop-blur-sm">
                            Perpetual
                          </Badge>
                        )}
                      </div>

                      <div className="pt-4 flex items-center text-sm text-muted-foreground group-hover:text-primary transition-colors">
                        <span>View Markets</span>
                        <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          {/* Detailed Comparison Table */}
          <Card className="glass border-white/5 overflow-hidden">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-primary" />
                <CardTitle>Feature Comparison</CardTitle>
              </div>
              <CardDescription>
                Detailed breakdown of supported features per exchange
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-white/5 border-white/5">
                    <TableHead className="pl-6">Exchange</TableHead>
                    <TableHead>Spot Trading</TableHead>
                    <TableHead>Perpetual Futures</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right pr-6">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {exchanges.map((exchange) => (
                    <TableRow
                      key={exchange.id}
                      className="hover:bg-white/5 border-white/5 transition-colors"
                    >
                      <TableCell className="font-medium pl-6 capitalize text-lg">
                        {exchange.name}
                      </TableCell>
                      <TableCell>
                        {exchange.hasSpot ? (
                          <div className="flex items-center text-green-500">
                            <Check className="h-4 w-4 mr-2" />
                            <span className="text-sm">Supported</span>
                          </div>
                        ) : (
                          <div className="flex items-center text-muted-foreground/50">
                            <X className="h-4 w-4 mr-2" />
                            <span className="text-sm">Not Available</span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {exchange.hasPerp ? (
                          <div className="flex items-center text-green-500">
                            <Check className="h-4 w-4 mr-2" />
                            <span className="text-sm">Supported</span>
                          </div>
                        ) : (
                          <div className="flex items-center text-muted-foreground/50">
                            <X className="h-4 w-4 mr-2" />
                            <span className="text-sm">Not Available</span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={exchange.supported ? 'default' : 'secondary'}>
                          {exchange.supported ? 'Online' : 'Offline'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right pr-6">
                        <Link
                          href={`/markets?exchange=${exchange.id}`}
                          className="inline-flex items-center text-sm font-medium text-primary hover:underline"
                        >
                          Explore <ArrowRight className="ml-1 h-3 w-3" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
