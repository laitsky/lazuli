/**
 * Exchanges Page - List all supported cryptocurrency exchanges
 * Shows exchange capabilities and links to their tickers/markets
 */

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { LazuliAPI } from '@/lib/api-client'
import type { ExchangeInfo } from '@lazuli/shared'

export default function ExchangesPage() {
  const [exchanges, setExchanges] = useState<ExchangeInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchExchanges() {
      const response = await LazuliAPI.getExchanges()
      if (response.success) {
        setExchanges(response.data)
      } else {
        setError(response.error)
      }
      setLoading(false)
    }
    fetchExchanges()
  }, [])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-5xl font-display font-extrabold tracking-tight">Exchanges</h1>
        <p className="text-lg font-light text-muted-foreground">
          All supported cryptocurrency exchanges and their capabilities
        </p>
      </div>

      {/* Loading State */}
      {loading && (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">Loading exchanges...</p>
          </CardContent>
        </Card>
      )}

      {/* Error State */}
      {!loading && error && (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">Error Loading Exchanges</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* Exchanges Grid */}
      {!loading && !error && (
        <>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-2">
            {exchanges.map((exchange) => (
              <Card key={exchange.id} className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-2xl">{exchange.name}</CardTitle>
                    <Badge variant={exchange.supported ? 'success' : 'secondary'}>
                      {exchange.supported ? 'Supported' : 'Not Supported'}
                    </Badge>
                  </div>
                  <CardDescription>Exchange ID: {exchange.id}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Market Types */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Market Types</p>
                    <div className="flex space-x-2">
                      {exchange.hasSpot ? (
                        <Badge>Spot Trading</Badge>
                      ) : (
                        <Badge variant="outline">No Spot</Badge>
                      )}
                      {exchange.hasPerp ? (
                        <Badge variant="secondary">Perpetual Futures</Badge>
                      ) : (
                        <Badge variant="outline">No Perpetual</Badge>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex space-x-2">
                    <Link
                      href={`/tickers?exchange=${exchange.id}`}
                      className="flex-1 inline-flex items-center justify-center h-9 px-4 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground shadow hover:bg-primary/90 transition-colors"
                    >
                      View Tickers
                    </Link>
                    <Link
                      href={`/markets?exchange=${exchange.id}`}
                      className="flex-1 inline-flex items-center justify-center h-9 px-4 py-2 rounded-md text-sm font-medium border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                    >
                      View Markets
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Exchanges Table */}
          <Card>
            <CardHeader>
              <CardTitle>Exchange Comparison</CardTitle>
              <CardDescription>Quick comparison of all supported exchanges</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Exchange</TableHead>
                    <TableHead>ID</TableHead>
                    <TableHead>Spot Markets</TableHead>
                    <TableHead>Perpetual Futures</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {exchanges.map((exchange) => (
                    <TableRow key={exchange.id}>
                      <TableCell className="font-medium">{exchange.name}</TableCell>
                      <TableCell className="font-mono text-sm">{exchange.id}</TableCell>
                      <TableCell>
                        {exchange.hasSpot ? (
                          <Badge variant="success">Yes</Badge>
                        ) : (
                          <Badge variant="outline">No</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {exchange.hasPerp ? (
                          <Badge variant="success">Yes</Badge>
                        ) : (
                          <Badge variant="outline">No</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={exchange.supported ? 'default' : 'secondary'}>
                          {exchange.supported ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Exchange Info */}
          <Card>
            <CardHeader>
              <CardTitle>About Exchange Support</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                Lazuli currently supports {exchanges.length} major cryptocurrency exchanges,
                providing real-time market data through their official APIs.
              </p>
              <ul className="space-y-1 ml-4">
                <li className="flex items-center space-x-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                  <span><strong>Binance, Bybit, OKX:</strong> Integrated via CCXT library</span>
                </li>
                <li className="flex items-center space-x-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                  <span><strong>Spot Markets:</strong> Traditional buy/sell trading pairs</span>
                </li>
                <li className="flex items-center space-x-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                  <span><strong>Perpetual Futures:</strong> Leveraged contracts with funding rates</span>
                </li>
              </ul>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
