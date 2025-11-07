'use client'

/**
 * Tickers Table Component - Interactive table for displaying ticker data
 * Includes search, filtering, sorting, and virtual scrolling for performance
 * Uses @tanstack/react-virtual for efficient rendering of large datasets
 */

import { useState, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Ticker } from '@lazuli/shared'
import { formatCurrency, formatPercentage, formatVolume, getChangeColor } from '@/lib/api-client'

interface TickersTableProps {
  tickers: Ticker[]
  exchange: string
}

export function TickersTable({ tickers, exchange }: TickersTableProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'spot' | 'perp'>('all')
  const [sortBy, setSortBy] = useState<'symbol' | 'price' | 'change' | 'volume'>('volume')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  // Filter and sort tickers
  const filteredTickers = useMemo(() => {
    let filtered = tickers.filter((ticker) => {
      const matchesSearch = ticker.symbol.toLowerCase().includes(searchQuery.toLowerCase())
      const matchesType = typeFilter === 'all' || ticker.type === typeFilter
      return matchesSearch && matchesType
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
  }, [tickers, searchQuery, typeFilter, sortBy, sortOrder])

  const toggleSort = (column: typeof sortBy) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(column)
      setSortOrder('desc')
    }
  }

  // Virtual scrolling setup for efficient rendering of large lists
  const parentRef = useRef<HTMLDivElement>(null)

  const rowVirtualizer = useVirtualizer({
    count: filteredTickers.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 57, // Approximate row height in pixels
    overscan: 10, // Number of items to render outside visible area for smooth scrolling
  })

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Search and filter {exchange} tickers</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Search */}
          <div>
            <Input
              placeholder="Search symbols (e.g., BTC, ETH, USDT)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="max-w-md"
            />
          </div>

          {/* Type Filter */}
          <div className="flex space-x-2">
            <Button
              variant={typeFilter === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTypeFilter('all')}
            >
              All ({tickers.length})
            </Button>
            <Button
              variant={typeFilter === 'spot' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTypeFilter('spot')}
            >
              Spot ({tickers.filter(t => t.type === 'spot').length})
            </Button>
            <Button
              variant={typeFilter === 'perp' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTypeFilter('perp')}
            >
              Perpetual ({tickers.filter(t => t.type === 'perp').length})
            </Button>
          </div>

          {/* Results Count */}
          <p className="text-sm text-muted-foreground">
            Showing {filteredTickers.length} of {tickers.length} tickers
          </p>
        </CardContent>
      </Card>

      {/* Tickers Table with Virtual Scrolling */}
      <Card>
        <CardContent className="p-0">
          {filteredTickers.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              No tickers found matching your filters
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead>
                      <Button variant="ghost" size="sm" onClick={() => toggleSort('symbol')}>
                        Symbol {sortBy === 'symbol' && (sortOrder === 'asc' ? '↑' : '↓')}
                      </Button>
                    </TableHead>
                    <TableHead>Type</TableHead>
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
                    <TableHead className="text-right">High / Low</TableHead>
                    {typeFilter === 'perp' && <TableHead className="text-right">Funding Rate</TableHead>}
                  </TableRow>
                </TableHeader>
              </Table>

              {/* Virtual scrolling container - max height for performance */}
              <div
                ref={parentRef}
                className="overflow-auto"
                style={{ maxHeight: '800px' }}
              >
                <Table>
                  <TableBody
                    style={{
                      height: `${rowVirtualizer.getTotalSize()}px`,
                      position: 'relative',
                    }}
                  >
                    {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                      const ticker = filteredTickers[virtualRow.index]
                      return (
                        <TableRow
                          key={`${ticker.exchange}-${ticker.symbol}-${ticker.type}`}
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                        >
                          <TableCell className="font-medium">{ticker.symbol}</TableCell>
                          <TableCell>
                            <Badge variant={ticker.type === 'spot' ? 'default' : 'secondary'}>
                              {ticker.type}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(ticker.last)}
                          </TableCell>
                          <TableCell className={`text-right font-mono ${getChangeColor(ticker.percentage24h)}`}>
                            {formatPercentage(ticker.percentage24h)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            ${formatVolume(ticker.quoteVolume24h)}
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
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
