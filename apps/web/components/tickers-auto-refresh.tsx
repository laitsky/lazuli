'use client'

/**
 * Tickers Auto-Refresh Component
 *
 * Automatically refreshes ticker data every 5-10 seconds
 * Provides real-time updates without manual page refresh
 */

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TickersTable } from '@/components/tickers-table'
import { LazuliAPI } from '@/lib/api-client'
import { Ticker, SupportedExchange } from '@lazuli/shared'
import { useRouter, useSearchParams } from 'next/navigation'

interface Exchange {
  id: string
  name: string
}

interface TickersAutoRefreshProps {
  initialExchanges: Exchange[]
  initialTickers: Ticker[]
  initialExchange: SupportedExchange
  refreshInterval?: number // in milliseconds
}

export function TickersAutoRefresh({
  initialExchanges,
  initialTickers,
  initialExchange,
  refreshInterval = 7000, // 7 seconds default (matches backend refresh)
}: TickersAutoRefreshProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [tickers, setTickers] = useState<Ticker[]>(initialTickers)
  const [exchange, setExchange] = useState<SupportedExchange>(initialExchange)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastUpdate, setLastUpdate] = useState(new Date())
  const [error, setError] = useState<string | null>(null)
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true)

  /**
   * Fetch all tickers from all pages without any limit
   * Continues fetching until all pages are retrieved
   */
  const fetchAllTickers = useCallback(async (exchangeId: SupportedExchange) => {
    const allTickers: Ticker[] = []
    let currentPage = 1
    let hasMorePages = true
    const pageLimit = 500 // Maximum allowed by backend

    while (hasMorePages) {
      const response = await LazuliAPI.getTickers(exchangeId, {
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

    return allTickers
  }, [])

  /**
   * Refresh ticker data
   */
  const refreshTickers = useCallback(async () => {
    setIsRefreshing(true)
    setError(null)

    try {
      const newTickers = await fetchAllTickers(exchange)
      setTickers(newTickers)
      setLastUpdate(new Date())
    } catch (err) {
      console.error('Failed to refresh tickers:', err)
      setError(err instanceof Error ? err.message : 'Failed to refresh tickers')
    } finally {
      setIsRefreshing(false)
    }
  }, [exchange, fetchAllTickers])

  /**
   * Auto-refresh effect
   */
  useEffect(() => {
    if (!autoRefreshEnabled) return

    const intervalId = setInterval(() => {
      refreshTickers()
    }, refreshInterval)

    return () => clearInterval(intervalId)
  }, [autoRefreshEnabled, refreshInterval, refreshTickers])

  /**
   * Handle exchange change
   */
  const handleExchangeChange = (newExchange: string) => {
    setExchange(newExchange as SupportedExchange)
    router.push(`/tickers?exchange=${newExchange}`)

    // Immediately fetch tickers for new exchange
    fetchAllTickers(newExchange as SupportedExchange).then(setTickers)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Live Tickers</h1>
            <p className="text-muted-foreground">
              Real-time cryptocurrency price data and market statistics
            </p>
          </div>

          {/* Auto-refresh toggle */}
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAutoRefreshEnabled(!autoRefreshEnabled)}
            >
              {autoRefreshEnabled ? '⏸ Pause' : '▶ Resume'} Auto-Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={refreshTickers}
              disabled={isRefreshing}
            >
              {isRefreshing ? '🔄 Refreshing...' : '🔄 Refresh Now'}
            </Button>
          </div>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <Card className="border-red-500">
          <CardHeader>
            <CardTitle className="text-red-600">Error</CardTitle>
            <CardDescription className="text-red-500">{error}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* Exchange Selector */}
      <Card>
        <CardHeader>
          <CardTitle>Select Exchange</CardTitle>
          <CardDescription>Choose an exchange to view tickers</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {initialExchanges.map((ex) => (
              <Button
                key={ex.id}
                variant={exchange === ex.id ? 'default' : 'outline'}
                size="lg"
                onClick={() => handleExchangeChange(ex.id)}
              >
                {ex.name}
                {exchange === ex.id && (
                  <Badge variant="secondary" className="ml-2">
                    Active
                  </Badge>
                )}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Tickers Data */}
      {tickers && tickers.length > 0 && (
        <>
          {/* Stats */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>
                    {exchange.charAt(0).toUpperCase() + exchange.slice(1)} Market Overview
                  </CardTitle>
                  <CardDescription>
                    <span className="flex items-center gap-2">
                      Last updated: {lastUpdate.toLocaleTimeString()}
                      {autoRefreshEnabled && (
                        <>
                          • Auto-refreshing every {refreshInterval / 1000}s
                          {isRefreshing && <span className="animate-pulse">🔄</span>}
                        </>
                      )}
                      • Showing all {tickers.length} tickers (sorted by volume)
                    </span>
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">Total Tickers</p>
                  <p className="text-2xl font-bold">{tickers.length}</p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">Spot Markets</p>
                  <p className="text-2xl font-bold">
                    {tickers.filter(t => t.type === 'spot').length}
                  </p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">Perpetual Markets</p>
                  <p className="text-2xl font-bold">
                    {tickers.filter(t => t.type === 'perp').length}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Tickers Table */}
          <TickersTable tickers={tickers} exchange={exchange} />
        </>
      )}

      {/* No Data State */}
      {tickers && tickers.length === 0 && (
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
