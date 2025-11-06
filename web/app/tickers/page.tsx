/**
 * Tickers Page - Display real-time ticker data from exchanges
 * Supports filtering by exchange and searching symbols
 */

import { Suspense } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TickersTable } from '@/components/tickers-table'
import { LazuliAPI } from '@/lib/api-client'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

interface TickersPageProps {
  searchParams: Promise<{ exchange?: string }>
}

export default async function TickersPage({ searchParams }: TickersPageProps) {
  const params = await searchParams
  const selectedExchange = params.exchange || 'binance'

  // Validate exchange
  const validExchanges = ['binance', 'bybit', 'okx', 'hyperliquid']
  const exchange = validExchanges.includes(selectedExchange)
    ? (selectedExchange as any)
    : 'binance'

  // Fetch exchanges list and tickers
  const [exchangesResponse, tickersResponse] = await Promise.all([
    LazuliAPI.getExchanges(),
    LazuliAPI.getTickers(exchange),
  ])

  const exchanges = exchangesResponse.success ? exchangesResponse.data : []
  const tickersData = tickersResponse.success ? tickersResponse.data : null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Live Tickers</h1>
        <p className="text-muted-foreground">
          Real-time cryptocurrency price data and market statistics
        </p>
      </div>

      {/* Exchange Selector */}
      <Card>
        <CardHeader>
          <CardTitle>Select Exchange</CardTitle>
          <CardDescription>Choose an exchange to view tickers</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {exchanges.map((ex) => (
              <Link key={ex.id} href={`/tickers?exchange=${ex.id}`}>
                <Button
                  variant={exchange === ex.id ? 'default' : 'outline'}
                  size="lg"
                >
                  {ex.name}
                  {exchange === ex.id && (
                    <Badge variant="secondary" className="ml-2">
                      Active
                    </Badge>
                  )}
                </Button>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Error State */}
      {!tickersResponse.success && (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">Error Loading Tickers</CardTitle>
            <CardDescription>{tickersResponse.error}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* Tickers Data */}
      {tickersResponse.success && tickersData && (
        <>
          {/* Stats */}
          <Card>
            <CardHeader>
              <CardTitle>
                {tickersData.exchange.charAt(0).toUpperCase() + tickersData.exchange.slice(1)} Market Overview
              </CardTitle>
              <CardDescription>
                Last updated: {new Date().toLocaleTimeString()}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">Total Tickers</p>
                  <p className="text-2xl font-bold">{tickersData.count}</p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">Spot Markets</p>
                  <p className="text-2xl font-bold">
                    {tickersData.tickers.filter(t => t.type === 'spot').length}
                  </p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">Perpetual Markets</p>
                  <p className="text-2xl font-bold">
                    {tickersData.tickers.filter(t => t.type === 'perp').length}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Tickers Table */}
          <TickersTable tickers={tickersData.tickers} exchange={tickersData.exchange} />
        </>
      )}
    </div>
  )
}
