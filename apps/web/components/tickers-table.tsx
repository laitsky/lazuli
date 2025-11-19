'use client'

/**
 * Tickers Table Component - Interactive table for displaying ticker data
 * Includes search, filtering, sorting, and client-side pagination for performance
 * Uses pagination to efficiently display large datasets without rendering issues
 */

import { useState, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Ticker } from '@lazuli/shared'
import { formatCurrency, formatPercentage, formatVolume, getChangeColor } from '@/lib/api-client'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Search } from 'lucide-react'

interface TickersTableProps {
  tickers: Ticker[]
  exchange: string
}

export function TickersTable({ tickers, exchange }: TickersTableProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<'spot' | 'perp'>('spot')
  const [quoteFilter, setQuoteFilter] = useState<string>('USDT')
  const [sortBy, setSortBy] = useState<'symbol' | 'price' | 'change' | 'volume'>('volume')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 50 // Show 50 tickers per page

  /**
   * Parse symbol using our standardized notation
   *
   * Notation:
   * - Spot: BTC-USDT (hyphen separator)
   * - Perpetual: BTCUSDT.P (.P suffix)
   *
   * Returns parsed components: base, quote, and whether it's a perpetual
   */
  const parseSymbol = (symbol: string) => {
    // Check if it's a perpetual contract (.P suffix)
    if (symbol.endsWith('.P')) {
      // Extract the combined base+quote (e.g., BTCUSDT from BTCUSDT.P)
      const baseQuote = symbol.slice(0, -2) // Remove .P

      // Common quote currencies to check (in order of likelihood)
      const commonQuotes = ['USDT', 'USDC', 'BUSD', 'USD', 'BTC', 'ETH', 'BNB', 'TUSD', 'DAI', 'FDUSD']

      for (const quote of commonQuotes) {
        if (baseQuote.endsWith(quote)) {
          const base = baseQuote.slice(0, -quote.length)
          return {
            base,
            quote,
            isPerpetual: true,
          }
        }
      }

      // Fallback: couldn't parse perpetual, return as-is
      return {
        base: baseQuote,
        quote: '',
        isPerpetual: true,
      }
    }

    // Spot market with hyphen separator (BTC-USDT)
    if (symbol.includes('-')) {
      const [base, quote] = symbol.split('-')
      return {
        base: base || '',
        quote: quote || '',
        isPerpetual: false,
      }
    }

    // Fallback: symbol doesn't match expected format
    return {
      base: symbol,
      quote: '',
      isPerpetual: false,
    }
  }

  /**
   * Get display symbol for UI
   * Converts our notation to a clean display format
   * - Spot: BTC-USDT -> BTC-USDT
   * - Perpetual: BTCUSDT.P -> BTCUSDT.P
   */
  const getDisplaySymbol = (symbol: string): string => {
    return symbol
  }

  /**
   * Extract quote currency from symbol
   * - BTC-USDT -> USDT
   * - BTCUSDT.P -> USDT
   */
  const getQuoteCurrency = (symbol: string): string => {
    const parsed = parseSymbol(symbol)
    return parsed.quote
  }

  /**
   * Get all available quote currencies from tickers
   * Custom ordering: USDT, BTC, ETH, USDC, then other stablecoins (BUSD, DAI, FDUSD, TUSD), then others
   */
  const availableQuotes = useMemo(() => {
    const quotes = new Set<string>()
    tickers.forEach((ticker) => {
      const quote = getQuoteCurrency(ticker.symbol)
      if (quote) {
        quotes.add(quote.toUpperCase())
      }
    })

    // Custom sort order: USDT, BTC, ETH, USDC, then stablecoins alphabetically, then others alphabetically
    const sortedQuotes = Array.from(quotes).sort((a, b) => {
      // Define priority order
      const priorityOrder = ['USDT', 'BTC', 'ETH', 'USDC']
      const stablecoins = ['BUSD', 'DAI', 'FDUSD', 'TUSD']

      // Get priority index (-1 if not in priority list)
      const aPriority = priorityOrder.indexOf(a)
      const bPriority = priorityOrder.indexOf(b)

      // Both are in priority list - sort by priority
      if (aPriority !== -1 && bPriority !== -1) {
        return aPriority - bPriority
      }

      // Only a is priority - a comes first
      if (aPriority !== -1) return -1

      // Only b is priority - b comes first
      if (bPriority !== -1) return 1

      // Neither is priority - check if they're stablecoins
      const aIsStable = stablecoins.includes(a)
      const bIsStable = stablecoins.includes(b)

      // Both are stablecoins - sort alphabetically
      if (aIsStable && bIsStable) {
        return a.localeCompare(b)
      }

      // Only a is stablecoin - a comes first
      if (aIsStable) return -1

      // Only b is stablecoin - b comes first
      if (bIsStable) return 1

      // Neither is priority nor stablecoin - sort alphabetically
      return a.localeCompare(b)
    })

    return sortedQuotes
  }, [tickers])

  /**
   * Get icon/logo for currency
   * Returns an emoji or Unicode symbol for major currencies
   */
  const getCurrencyIcon = (currency: string): string | null => {
    const icons: Record<string, string> = {
      'USDT': '₮',  // Tether symbol
      'BTC': '₿',   // Bitcoin symbol
      'ETH': 'Ξ',   // Ethereum symbol (Greek Xi)
    }
    return icons[currency] || null
  }

  // Filter and sort tickers
  const filteredTickers = useMemo(() => {
    let filtered = tickers.filter((ticker) => {
      const matchesSearch = ticker.symbol.toLowerCase().includes(searchQuery.toLowerCase())
      const matchesType = ticker.type === typeFilter

      // Quote currency filter
      const tickerQuote = getQuoteCurrency(ticker.symbol).toUpperCase()
      const matchesQuote = tickerQuote === quoteFilter

      return matchesSearch && matchesType && matchesQuote
    })

    // Sort tickers
    filtered.sort((a, b) => {
      let aValue: number | string = 0
      let bValue: number | string = 0

      switch (sortBy) {
        case 'symbol':
          aValue = a.symbol
          bValue = b.symbol
          break
        case 'price':
          aValue = a.last || 0
          bValue = b.last || 0
          break
        case 'change':
          aValue = a.percentage24h || 0
          bValue = b.percentage24h || 0
          break
        case 'volume':
          aValue = a.quoteVolume24h || 0
          bValue = b.quoteVolume24h || 0
          break
      }

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortOrder === 'asc'
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue)
      }

      const numA = typeof aValue === 'number' ? aValue : 0
      const numB = typeof bValue === 'number' ? bValue : 0
      return sortOrder === 'asc' ? numA - numB : numB - numA
    })

    return filtered
  }, [tickers, searchQuery, typeFilter, quoteFilter, sortBy, sortOrder])

  const toggleSort = (column: typeof sortBy) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(column)
      setSortOrder('desc')
    }
    setCurrentPage(1) // Reset to first page when sorting changes
  }

  // Reset to page 1 when filters change
  const handleSearchChange = (value: string) => {
    setSearchQuery(value)
    setCurrentPage(1)
  }

  const handleTypeFilterChange = (type: 'spot' | 'perp') => {
    setTypeFilter(type)
    setCurrentPage(1)
  }

  const handleQuoteFilterChange = (quote: string) => {
    setQuoteFilter(quote)
    setCurrentPage(1)
  }

  // Pagination calculations
  const totalPages = Math.ceil(filteredTickers.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const paginatedTickers = filteredTickers.slice(startIndex, endIndex)

  // Pagination controls
  const goToFirstPage = () => setCurrentPage(1)
  const goToLastPage = () => setCurrentPage(totalPages)
  const goToPreviousPage = () => setCurrentPage(Math.max(1, currentPage - 1))
  const goToNextPage = () => setCurrentPage(Math.min(totalPages, currentPage + 1))

  // Generate page numbers to display (show current page and 2 pages on each side)
  const getPageNumbers = () => {
    const pages: (number | string)[] = []
    const maxPagesToShow = 5

    if (totalPages <= maxPagesToShow) {
      // Show all pages if total is small
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i)
      }
    } else {
      // Show first page
      pages.push(1)

      // Show pages around current page
      const start = Math.max(2, currentPage - 1)
      const end = Math.min(totalPages - 1, currentPage + 1)

      if (start > 2) pages.push('...')

      for (let i = start; i <= end; i++) {
        pages.push(i)
      }

      if (end < totalPages - 1) pages.push('...')

      // Show last page
      pages.push(totalPages)
    }

    return pages
  }

  return (
    <div className="space-y-4">
      {/* Search - Prominent placement above filters */}
      <div className="relative max-w-2xl">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search symbols (e.g., BTC, ETH, USDT)..."
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Filter {exchange} tickers by market type and quote currency</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Type Filter */}
          <div>
            <p className="text-sm font-semibold mb-2">Market Type</p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={typeFilter === 'spot' ? 'default' : 'outline'}
                size="sm"
                onClick={() => handleTypeFilterChange('spot')}
              >
                Spot ({tickers.filter(t => t.type === 'spot').length})
              </Button>
              <Button
                variant={typeFilter === 'perp' ? 'default' : 'outline'}
                size="sm"
                onClick={() => handleTypeFilterChange('perp')}
              >
                Perpetual ({tickers.filter(t => t.type === 'perp').length})
              </Button>
            </div>
          </div>

          {/* Quote Currency Filter */}
          <div>
            <p className="text-sm font-semibold mb-2">Quote Currency</p>
            <div className="flex flex-wrap gap-2">
              {availableQuotes.map((quote) => {
                const count = tickers.filter((t) => {
                  const tickerQuote = getQuoteCurrency(t.symbol).toUpperCase()
                  return tickerQuote === quote
                }).length
                const icon = getCurrencyIcon(quote)
                return (
                  <Button
                    key={quote}
                    variant={quoteFilter === quote ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => handleQuoteFilterChange(quote)}
                    className="gap-1.5"
                  >
                    {icon && <span className="text-base">{icon}</span>}
                    <span>{quote}</span>
                    <span className="text-muted-foreground">({count})</span>
                  </Button>
                )
              })}
            </div>
          </div>

          {/* Results Count */}
          <p className="text-sm text-muted-foreground">
            Showing {startIndex + 1}-{Math.min(endIndex, filteredTickers.length)} of {filteredTickers.length} tickers
            {filteredTickers.length !== tickers.length && ` (filtered from ${tickers.length} total)`}
          </p>
        </CardContent>
      </Card>

      {/* Tickers Table with Pagination */}
      <Card>
        <CardContent className="p-0">
          {filteredTickers.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              No tickers found matching your filters
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <Button variant="ghost" size="sm" onClick={() => toggleSort('symbol')}>
                          Symbol {sortBy === 'symbol' && (sortOrder === 'asc' ? '↑' : '↓')}
                        </Button>
                      </TableHead>
                      <TableHead className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => toggleSort('price')}>
                          Price {sortBy === 'price' && (sortOrder === 'asc' ? '↑' : '↓')}
                        </Button>
                      </TableHead>
                      <TableHead className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => toggleSort('change')}>
                          24h Change {sortBy === 'change' && (sortOrder === 'asc' ? '↑' : '↓')}
                        </Button>
                      </TableHead>
                      <TableHead className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => toggleSort('volume')}>
                          24h Volume {sortBy === 'volume' && (sortOrder === 'asc' ? '↑' : '↓')}
                        </Button>
                      </TableHead>
                      <TableHead className="text-right font-extralight">High / Low</TableHead>
                      {typeFilter === 'perp' && <TableHead className="text-right">Funding Rate</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedTickers.map((ticker) => {
                      const displaySymbol = getDisplaySymbol(ticker.symbol)
                      const quoteCurrency = getQuoteCurrency(ticker.symbol)

                      return (
                        <TableRow key={`${ticker.exchange}-${ticker.symbol}-${ticker.type}`}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <span>{displaySymbol}</span>
                              <Badge
                                variant={ticker.type === 'spot' ? 'default' : 'secondary'}
                                className="text-xs"
                              >
                                {ticker.type}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(ticker.last)}
                          </TableCell>
                          <TableCell className={`text-right font-mono ${getChangeColor(ticker.percentage24h)}`}>
                            {formatPercentage(ticker.percentage24h)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatVolume(ticker.quoteVolume24h, quoteCurrency)}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            <div className="text-green-600 dark:text-green-400">
                              {formatCurrency(ticker.high24h)}
                            </div>
                            <div className="text-red-600 dark:text-red-400">
                              {formatCurrency(ticker.low24h)}
                            </div>
                          </TableCell>
                          {typeFilter === 'perp' && (
                            <TableCell className="text-right font-mono text-sm">
                              {ticker.fundingRate !== null && ticker.fundingRate !== undefined
                                ? `${(ticker.fundingRate * 100).toFixed(4)}%`
                                : 'N/A'}
                            </TableCell>
                          )}
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-4 border-t">
                  <div className="text-sm text-muted-foreground">
                    Page {currentPage} of {totalPages}
                  </div>
                  <div className="flex items-center space-x-2">
                    {/* First Page */}
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={goToFirstPage}
                      disabled={currentPage === 1}
                      aria-label="Go to first page"
                    >
                      <ChevronsLeft className="h-4 w-4" />
                    </Button>

                    {/* Previous Page */}
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={goToPreviousPage}
                      disabled={currentPage === 1}
                      aria-label="Go to previous page"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>

                    {/* Page Numbers */}
                    <div className="flex items-center space-x-1">
                      {getPageNumbers().map((page, index) => (
                        page === '...' ? (
                          <span key={`ellipsis-${index}`} className="px-2 text-muted-foreground">
                            ...
                          </span>
                        ) : (
                          <Button
                            key={page}
                            variant={currentPage === page ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setCurrentPage(page as number)}
                            className="min-w-[40px]"
                          >
                            {page}
                          </Button>
                        )
                      ))}
                    </div>

                    {/* Next Page */}
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={goToNextPage}
                      disabled={currentPage === totalPages}
                      aria-label="Go to next page"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>

                    {/* Last Page */}
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={goToLastPage}
                      disabled={currentPage === totalPages}
                      aria-label="Go to last page"
                    >
                      <ChevronsRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
