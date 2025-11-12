/**
 * Tickers Page - Display real-time ticker data from exchanges
 * Supports filtering by exchange and auto-refreshing every 5-10s
 */

import { LazuliAPI } from '@/lib/api-client'
import { Ticker, SupportedExchange } from '@lazuli/shared'
import { TickersAutoRefresh } from '@/components/tickers-auto-refresh'

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

  return allTickers
}

export default async function TickersPage({ searchParams }: TickersPageProps) {
  const params = await searchParams
  const selectedExchange = params.exchange || 'binance'

  // Validate exchange
  const validExchanges = ['binance', 'bybit', 'okx']
  const exchange = validExchanges.includes(selectedExchange)
    ? (selectedExchange as SupportedExchange)
    : 'binance'

  // Fetch exchanges list and ALL tickers (no limit)
  const [exchangesResponse, initialTickers] = await Promise.all([
    LazuliAPI.getExchanges(),
    fetchAllTickers(exchange),
  ])

  const exchanges = exchangesResponse.success ? exchangesResponse.data : []

  // Render client component with auto-refresh
  return (
    <TickersAutoRefresh
      initialExchanges={exchanges}
      initialTickers={initialTickers}
      initialExchange={exchange}
      refreshInterval={7000} // 7 seconds (matches backend refresh)
    />
  )
}
