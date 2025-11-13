/**
 * API Status Indicator - Client Component
 * Fetches health status on the client-side to avoid SSR networking issues
 */

'use client'

import { useEffect, useState } from 'react'
import { LazuliAPI } from '@/lib/api-client'
import type { HealthResponse } from '@lazuli/shared'

export function ApiStatusIndicator() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const response = await LazuliAPI.getHealth()

        if (response.success) {
          setHealth(response.data)
          setError(null)
        } else {
          setError(response.error || 'Unknown error')
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        setError(errorMsg)
      } finally {
        setLoading(false)
      }
    }

    fetchHealth()

    // Poll health status every 30 seconds
    const interval = setInterval(fetchHealth, 30000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md bg-red-50 dark:bg-red-950 p-4 text-sm text-red-800 dark:text-red-200">
          <p className="font-semibold">Connection Error:</p>
          <p>{error}</p>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
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
      </div>
    </div>
  )
}
