/**
 * Homepage/Dashboard - Overview of the Lazuli trading tool
 * Displays API status, supported exchanges, and quick links
 */

import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { LazuliAPI } from '@/lib/api-client'
import { ApiStatusIndicator } from '@/components/api-status-indicator'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  // Fetch exchanges on server-side
  // Health status is fetched client-side to avoid SSR networking issues
  const exchangesResponse = await LazuliAPI.getExchanges()

  const exchanges = exchangesResponse.success ? exchangesResponse.data : []

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-5xl font-display font-bold tracking-tight">
          Welcome to Lazuli
        </h1>
        <p className="text-lg font-light text-muted-foreground">
          Real-time cryptocurrency trading data from multiple exchanges
        </p>
      </div>

      {/* Status Card */}
      <Card>
        <CardHeader>
          <CardTitle>System Status</CardTitle>
          <CardDescription>Current API and service status</CardDescription>
        </CardHeader>
        <CardContent>
          <ApiStatusIndicator />
        </CardContent>
      </Card>

      {/* Exchanges Overview */}
      <div className="space-y-4">
        <h2 className="text-3xl font-display font-bold">Supported Exchanges</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {exchanges.map((exchange) => (
            <Card key={exchange.id}>
              <CardHeader>
                <CardTitle className="text-lg">{exchange.name}</CardTitle>
                <CardDescription>
                  {exchange.hasSpot && exchange.hasPerp
                    ? 'Spot & Perpetual'
                    : exchange.hasSpot
                    ? 'Spot Only'
                    : 'Perpetual Only'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex space-x-2">
                  {exchange.hasSpot && <Badge>Spot</Badge>}
                  {exchange.hasPerp && <Badge variant="secondary">Perp</Badge>}
                </div>
                <Link
                  href={`/markets?exchange=${exchange.id}`}
                  className="w-full inline-flex items-center justify-center h-8 px-3 rounded-md text-xs font-medium border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer"
                >
                  View Markets
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Quick Links */}
      <div className="space-y-4">
        <h2 className="text-3xl font-display font-bold">Quick Access</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle>Exchanges</CardTitle>
              <CardDescription>View all supported cryptocurrency exchanges</CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                href="/exchanges"
                className="w-full inline-flex items-center justify-center h-9 px-4 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground shadow hover:bg-primary/90 transition-colors cursor-pointer"
              >
                View Exchanges
              </Link>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle>Markets</CardTitle>
              <CardDescription>Real-time price data and market information</CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                href="/markets"
                className="w-full inline-flex items-center justify-center h-9 px-4 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground shadow hover:bg-primary/90 transition-colors cursor-pointer"
              >
                View Markets
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Features */}
      <Card>
        <CardHeader>
          <CardTitle>Features</CardTitle>
          <CardDescription>What Lazuli offers</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center space-x-2">
              <div className="h-1.5 w-1.5 rounded-full bg-primary" />
              <span>Real-time cryptocurrency price data from 3 major exchanges</span>
            </li>
            <li className="flex items-center space-x-2">
              <div className="h-1.5 w-1.5 rounded-full bg-primary" />
              <span>Support for both spot and perpetual futures markets</span>
            </li>
            <li className="flex items-center space-x-2">
              <div className="h-1.5 w-1.5 rounded-full bg-primary" />
              <span>24-hour price changes, volume, and market statistics</span>
            </li>
            <li className="flex items-center space-x-2">
              <div className="h-1.5 w-1.5 rounded-full bg-primary" />
              <span>Optional historical data storage for analysis</span>
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
