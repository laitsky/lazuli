/**
 * Markets Page - Browse all available trading pairs
 * Shows market information grouped by exchange
 */

'use client'

import { useState, useEffect, useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { LazuliAPI } from '@/lib/api-client'
import { Market, ExchangeInfo, SupportedExchange } from '@/lib/types'

export default function MarketsPage() {
  const [exchanges, setExchanges] = useState<ExchangeInfo[]>([])
  const [selectedExchange, setSelectedExchange] = useState<SupportedExchange>('binance')
  const [markets, setMarkets] = useState<Market[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'spot' | 'perp'>('all')

  // Load exchanges on mount
  useEffect(() => {
    async function loadExchanges() {
      const response = await LazuliAPI.getExchanges()
      if (response.success) {
        setExchanges(response.data)
      }
    }
    loadExchanges()
  }, [])

  // Load markets when exchange changes
  useEffect(() => {
    async function loadMarkets() {
      setLoading(true)
      setError(null)
      const response = await LazuliAPI.getMarkets(selectedExchange)
      if (response.success) {
        setMarkets(response.data.markets)
      } else {
        setError(response.error)
      }
      setLoading(false)
    }
    loadMarkets()
  }, [selectedExchange])

  // Filter markets
  const filteredMarkets = useMemo(() => {
    return markets.filter((market) => {
      const matchesSearch =
        market.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        market.base.toLowerCase().includes(searchQuery.toLowerCase()) ||
        market.quote.toLowerCase().includes(searchQuery.toLowerCase())
      const matchesType = typeFilter === 'all' || market.type === typeFilter
      return matchesSearch && matchesType && market.active
    })
  }, [markets, searchQuery, typeFilter])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Markets</h1>
        <p className="text-muted-foreground">
          Browse available trading pairs across all exchanges
        </p>
      </div>

      {/* Exchange Selector */}
      <Card>
        <CardHeader>
          <CardTitle>Select Exchange</CardTitle>
          <CardDescription>Choose an exchange to view available markets</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {exchanges.map((ex) => (
              <Button
                key={ex.id}
                variant={selectedExchange === ex.id ? 'default' : 'outline'}
                size="lg"
                onClick={() => setSelectedExchange(ex.id as SupportedExchange)}
              >
                {ex.name}
                {selectedExchange === ex.id && (
                  <Badge variant="secondary" className="ml-2">
                    Active
                  </Badge>
                )}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Error State */}
      {error && (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">Error Loading Markets</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* Loading State */}
      {loading && (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">Loading markets...</p>
          </CardContent>
        </Card>
      )}

      {/* Markets Content */}
      {!loading && !error && (
        <>
          {/* Stats */}
          <Card>
            <CardHeader>
              <CardTitle>
                {selectedExchange.charAt(0).toUpperCase() + selectedExchange.slice(1)} Markets
              </CardTitle>
              <CardDescription>
                Total: {markets.length} markets
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">Total Markets</p>
                  <p className="text-2xl font-bold">{markets.length}</p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">Spot Markets</p>
                  <p className="text-2xl font-bold">
                    {markets.filter(m => m.type === 'spot' && m.active).length}
                  </p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">Perpetual Markets</p>
                  <p className="text-2xl font-bold">
                    {markets.filter(m => m.type === 'perp' && m.active).length}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Filters */}
          <Card>
            <CardHeader>
              <CardTitle>Filters</CardTitle>
              <CardDescription>Search and filter markets</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Search */}
              <div>
                <Input
                  placeholder="Search markets (e.g., BTC, ETH, USDT)..."
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
                  All ({markets.filter(m => m.active).length})
                </Button>
                <Button
                  variant={typeFilter === 'spot' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setTypeFilter('spot')}
                >
                  Spot ({markets.filter(m => m.type === 'spot' && m.active).length})
                </Button>
                <Button
                  variant={typeFilter === 'perp' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setTypeFilter('perp')}
                >
                  Perpetual ({markets.filter(m => m.type === 'perp' && m.active).length})
                </Button>
              </div>

              {/* Results Count */}
              <p className="text-sm text-muted-foreground">
                Showing {filteredMarkets.length} of {markets.filter(m => m.active).length} active markets
              </p>
            </CardContent>
          </Card>

          {/* Markets Table */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Base Currency</TableHead>
                      <TableHead>Quote Currency</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Market ID</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredMarkets.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                          No markets found matching your filters
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredMarkets.slice(0, 200).map((market) => (
                        <TableRow key={`${market.exchange}-${market.id}`}>
                          <TableCell className="font-medium">{market.symbol}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{market.base}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{market.quote}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={market.type === 'spot' ? 'default' : 'secondary'}>
                              {market.type}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-sm text-muted-foreground">
                            {market.id}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              {filteredMarkets.length > 200 && (
                <div className="p-4 text-center text-sm text-muted-foreground border-t">
                  Showing top 200 results. Use search to narrow down.
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
