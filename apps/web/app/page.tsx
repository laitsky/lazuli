/**
 * Homepage/Dashboard - Overview of the Lazuli trading tool
 * Displays API status, supported exchanges, and quick links
 */

import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { LazuliAPI } from '@/lib/api-client'
import { ApiStatusIndicator } from '@/components/api-status-indicator'
import { ExchangeLogo } from '@/components/exchange-logo'
import { ArrowRight, BarChart2, Globe, Activity, Database } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  // Fetch exchanges on server-side
  // Health status is fetched client-side to avoid SSR networking issues
  const exchangesResponse = await LazuliAPI.getExchanges()

  const exchanges = exchangesResponse.success ? exchangesResponse.data : []

  return (
    <div className="space-y-12 pb-12">
      {/* Hero Section */}
      <div className="relative space-y-6 py-8 animate-fade-in">
        <div className="absolute top-0 right-0 -z-10 opacity-50">
          <div className="h-64 w-64 rounded-full bg-primary/20 blur-3xl filter" />
        </div>

        <div className="space-y-4 max-w-3xl">
          <Badge variant="outline" className="animate-delay-100 animate-fade-in backdrop-blur-md">
            v1.0 Public Beta
          </Badge>
          <h1 className="text-6xl md:text-7xl font-display font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-foreground to-foreground/70 animate-delay-100 animate-fade-in">
            Trade with <br />
            <span className="text-primary">Precision</span>
          </h1>
          <p className="text-xl font-light text-muted-foreground max-w-2xl animate-delay-200 animate-fade-in leading-relaxed">
            Real-time cryptocurrency data aggregation from major exchanges.
            Unified interface for spot and perpetual markets.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 pt-4 animate-delay-300 animate-fade-in">
          <Button size="lg" className="w-full sm:w-auto rounded-full" asChild>
            <Link href="/markets">
              Start Trading <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <Button size="lg" variant="outline" className="w-full sm:w-auto rounded-full glass hover:bg-white/10" asChild>
            <Link href="/exchanges">
              View Exchanges
            </Link>
          </Button>
        </div>
      </div>

      {/* Status Section */}
      <div className="grid gap-6 md:grid-cols-3 animate-delay-300 animate-fade-in">
        <Card className="md:col-span-2 glass border-primary/10">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <CardTitle>System Status</CardTitle>
                <CardDescription>Real-time API health monitoring</CardDescription>
              </div>
              <Activity className="h-5 w-5 text-primary" />
            </div>
          </CardHeader>
          <CardContent>
            <ApiStatusIndicator />
          </CardContent>
        </Card>

        <Card className="glass border-primary/10 bg-primary/5">
          <CardHeader>
            <CardTitle>Quick Stats</CardTitle>
            <CardDescription>Network overview</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Active Exchanges</span>
              <span className="font-mono text-xl font-bold">{exchanges.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Market Types</span>
              <div className="flex gap-2">
                <Badge variant="secondary" className="text-[10px]">SPOT</Badge>
                <Badge variant="secondary" className="text-[10px]">PERP</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Exchanges Grid */}
      <div className="space-y-6 animate-delay-300 animate-fade-in">
        <div className="flex items-center justify-between">
          <h2 className="text-3xl font-display font-bold">Supported Exchanges</h2>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/exchanges" className="group">
              View All <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </Button>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {exchanges.map((exchange, index) => (
            <Card key={exchange.id} className="group glass-hover border-white/5">
              <CardHeader>
                <div className="flex items-center justify-between mb-2">
                  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary/10 to-transparent flex items-center justify-center text-primary border border-white/5">
                    <ExchangeLogo exchangeId={exchange.id} className="h-7 w-7" />
                  </div>
                  <Badge variant="outline" className="text-[10px] border-primary/20 text-primary">
                    SUPPORTED
                  </Badge>
                </div>
                <CardTitle className="text-xl">{exchange.name}</CardTitle>
                <CardDescription>
                  {exchange.hasSpot && exchange.hasPerp
                    ? 'Spot & Perpetual Markets'
                    : exchange.hasSpot
                      ? 'Spot Markets Only'
                      : 'Perpetual Markets Only'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {exchange.hasSpot && <Badge variant="secondary" className="bg-background/50">Spot</Badge>}
                  {exchange.hasPerp && <Badge variant="secondary" className="bg-background/50">Perp</Badge>}
                </div>
                <Button className="w-full group-hover:bg-primary group-hover:text-primary-foreground transition-colors" variant="secondary" asChild>
                  <Link href={`/markets?exchange=${exchange.id}`}>
                    Trade Now
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Features Grid */}
      <div className="grid gap-6 md:grid-cols-3 animate-delay-300 animate-fade-in">
        <Card className="glass border-white/5">
          <CardHeader>
            <BarChart2 className="h-8 w-8 text-primary mb-4" />
            <CardTitle>Real-time Data</CardTitle>
            <CardDescription>
              Live price updates via WebSocket connections from all supported exchanges.
            </CardDescription>
          </CardHeader>
        </Card>
        <Card className="glass border-white/5">
          <CardHeader>
            <Activity className="h-8 w-8 text-primary mb-4" />
            <CardTitle>Unified API</CardTitle>
            <CardDescription>
              Normalized data structure across different exchange protocols.
            </CardDescription>
          </CardHeader>
        </Card>
        <Card className="glass border-white/5">
          <CardHeader>
            <Database className="h-8 w-8 text-primary mb-4" />
            <CardTitle>Historical Data</CardTitle>
            <CardDescription>
              Access to historical price action and volume data for analysis.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  )
}
