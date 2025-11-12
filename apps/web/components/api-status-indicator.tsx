/**
 * API Status Indicator - Client Component
 * Fetches health status on the client-side to avoid SSR networking issues
 */

'use client'

import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { LazuliAPI } from '@/lib/api-client'
import type { HealthResponse } from '@lazuli/shared'

export function ApiStatusIndicator() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const response = await LazuliAPI.getHealth()
        if (response.success) {
          setHealth(response.data)
        }
      } catch (error) {
        console.error('Failed to fetch health status:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchHealth()

    // Optionally: Poll health status every 30 seconds
    const interval = setInterval(fetchHealth, 30000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">API Status</p>
        <div className="flex items-center space-x-2">
          <div
            className={`h-3 w-3 rounded-full ${
              loading
                ? 'bg-yellow-500 animate-pulse'
                : health?.status === 'ok'
                ? 'bg-green-500'
                : 'bg-red-500'
            }`}
          />
          <span className="text-lg font-semibold">
            {loading ? 'Checking...' : health?.status === 'ok' ? 'Online' : 'Offline'}
          </span>
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">Exchanges</p>
        <p className="text-lg font-semibold">
          {health?.exchanges?.length || 3} Supported
        </p>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">Database</p>
        <Badge variant={health?.database === 'connected' ? 'success' : 'secondary'}>
          {loading ? 'Checking...' : health?.database || 'Not Required'}
        </Badge>
      </div>
    </div>
  )
}
