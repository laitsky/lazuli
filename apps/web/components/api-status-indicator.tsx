/**
 * API Status Indicator - Client Component
 * Fetches health status on the client-side to avoid SSR networking issues
 * Enhanced with better visual feedback, animations, and detailed status display
 */

'use client';

import { useEffect, useState } from 'react';
import { LazuliAPI } from '@/lib/api-client';
import type { HealthResponse } from '@lazuli/shared';
import { Wifi, WifiOff, Server, RefreshCw, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

export function ApiStatusIndicator() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchHealth = async (showRefreshState = false) => {
    if (showRefreshState) setIsRefreshing(true);
    try {
      const response = await LazuliAPI.getHealth();

      if (response.success) {
        setHealth(response.data);
        setError(null);
        setLastUpdated(new Date());
      } else {
        setError(response.error || 'Unknown error');
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      setError(errorMsg);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchHealth();

    // Poll health status every 30 seconds
    const interval = setInterval(() => fetchHealth(false), 30000);
    return () => clearInterval(interval);
  }, []);

  const isOnline = health?.status === 'ok';
  const statusColor = loading ? 'yellow' : isOnline ? 'green' : 'red';

  return (
    <div className="space-y-4">
      {/* Error Banner */}
      {error && (
        <div className="flex items-start gap-3 rounded-xl bg-red-500/10 border border-red-500/20 p-4 text-sm animate-in fade-in slide-in-from-top-2 duration-300">
          <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-red-500">Connection Error</p>
            <p className="text-red-400/80 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* Status Grid */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* API Status Card */}
        <div className="group p-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-all duration-300">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              API Status
            </span>
            <button
              onClick={() => fetchHealth(true)}
              disabled={isRefreshing}
              className="h-7 w-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors disabled:opacity-50"
              aria-label="Refresh status"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 text-muted-foreground ${isRefreshing ? 'animate-spin' : ''}`}
              />
            </button>
          </div>
          <div className="flex items-center gap-3">
            {/* Status Indicator */}
            <div
              className={`relative h-12 w-12 rounded-xl flex items-center justify-center transition-colors ${
                statusColor === 'green'
                  ? 'bg-green-500/10'
                  : statusColor === 'yellow'
                    ? 'bg-yellow-500/10'
                    : 'bg-red-500/10'
              }`}
            >
              {loading ? (
                <Loader2 className="h-6 w-6 text-yellow-500 animate-spin" />
              ) : isOnline ? (
                <Wifi className="h-6 w-6 text-green-500" />
              ) : (
                <WifiOff className="h-6 w-6 text-red-500" />
              )}
              {/* Pulse animation for online status */}
              {isOnline && !loading && (
                <span className="absolute inset-0 rounded-xl bg-green-500/20 animate-ping opacity-75" />
              )}
            </div>
            <div>
              <p
                className={`text-xl font-bold ${
                  statusColor === 'green'
                    ? 'text-green-500'
                    : statusColor === 'yellow'
                      ? 'text-yellow-500'
                      : 'text-red-500'
                }`}
              >
                {loading ? 'Checking...' : isOnline ? 'Online' : 'Offline'}
              </p>
              {lastUpdated && !loading && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Updated {lastUpdated.toLocaleTimeString()}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Exchanges Card */}
        <div className="group p-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-all duration-300">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Exchanges
            </span>
            <Server className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <span className="text-xl font-bold text-primary">
                {health?.exchanges?.length || 4}
              </span>
            </div>
            <div>
              <p className="text-xl font-bold">Supported</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <CheckCircle2 className="h-3 w-3 text-green-500" />
                <p className="text-xs text-muted-foreground">All exchanges active</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
