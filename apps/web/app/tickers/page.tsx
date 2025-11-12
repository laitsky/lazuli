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
import { Ticker, SupportedExchange } from '@lazuli/shared'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

interface TickersPageProps {
  searchParams: Promise<{ exchange?: string }>
}

/**
 * Fetch all tickers from all pages without any limit
 * Continues fetching until all pages are retrieved
 */
async function fetchAllTickers(exchange: SupportedExchange) {
  const allTickers: Ticker[] = []
  let currentPage = 1
  let hasMorePages = true
  const pageLimit = 500 // Maximum allowed by backend

  while (hasMorePages) {
    const response = await LazuliAPI.getTickers(exchange, {
      page: currentPage,
      limit: pageLimit,
      sortBy: 'volume',
      sortOrder: 'desc',
    })

    if (!response.success || !response.data) {
      // If any page fails, return what we have so far
      break
    }

    allTickers.push(...response.data.tickers)

    // Check if there are more pages
    if (response.data.pagination && response.data.pagination.hasNext) {
      currentPage++
    } else {
      hasMorePages = false
    }
  }

  return {
    exchange,
    tickers: allTickers,
    count: allTickers.length,
  }
}

export default async function TickersPage({ searchParams }: TickersPageProps) {
  const params = await searchParams
  const selectedExchange = params.exchange || 'binance'

  // Validate exchange
  const validExchanges = ['binance', 'bybit', 'okx']
  const exchange = validExchanges.includes(selectedExchange)
    ? (selectedExchange as any)
    : 'binance'

  // Fetch exchanges list and ALL tickers (no limit)
  const [exchangesResponse, tickersData] = await Promise.all([
    LazuliAPI.getExchanges(),
    fetchAllTickers(exchange),
  ])

  const exchanges = exchangesResponse.success ? exchangesResponse.data : []

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

      {/* Tickers Data */}
      {tickersData && tickersData.tickers.length > 0 && (
        <>
          {/* Stats */}
          <Card>
            <CardHeader>
              <CardTitle>
                {tickersData.exchange.charAt(0).toUpperCase() + tickersData.exchange.slice(1)} Market Overview
              </CardTitle>
              <CardDescription>
                Last updated: {new Date().toLocaleTimeString()} • Showing all {tickersData.count} tickers (sorted by volume)
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

      {/* No Data State */}
      {tickersData && tickersData.tickers.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No Tickers Available</CardTitle>
            <CardDescription>No ticker data found for this exchange.</CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  )
}
