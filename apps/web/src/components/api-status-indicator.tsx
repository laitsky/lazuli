/**
 * API Status Indicator - Terminal Luxe
 * Displays API health status with refined styling and auto-refresh (10s interval)
 */

import { LazuliAPI } from '@/lib/api-client';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import type { HealthResponse } from '@lazuli/shared';
import {
  Wifi,
  WifiOff,
  Server,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Timer,
} from 'lucide-react';

/**
 * Auto-refresh interval in milliseconds (10 seconds)
 */
const AUTO_REFRESH_INTERVAL = 10000;

export function ApiStatusIndicator() {
  /**
   * Auto-refresh hook for health check data
   * Provides near real-time API status updates
   */
  const {
    data: health,
    isLoading: loading,
    isRefreshing,
    error,
    lastUpdatedString,
    refresh,
    countdown,
  } = useAutoRefresh<HealthResponse>({
    fetchFn: () => LazuliAPI.getHealth(),
    interval: AUTO_REFRESH_INTERVAL,
    fetchOnMount: true,
  });

  const isOnline = health?.status === 'ok';

  return (
    <div className="space-y-4">
      {/* Error Banner */}
      {error && (
        <div className="flex items-start gap-3 rounded-lg bg-destructive/10 border border-destructive/20 p-4 text-sm">
          <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-destructive">Connection Error</p>
            <p className="text-destructive/80 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* Status Grid */}
      <div className="grid gap-3 sm:grid-cols-2">
        {/* API Status Card */}
        <div className="p-4 rounded-lg bg-secondary border border-border">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
              API Status
            </span>
            <div className="flex items-center gap-2">
              {/* Countdown indicator */}
              <span className="text-[10px] font-mono text-muted-foreground flex items-center gap-1">
                <Timer className="h-3 w-3" />
                {countdown}s
              </span>
              <button
                onClick={refresh}
                disabled={isRefreshing}
                className="h-7 w-7 rounded-md bg-card border border-border hover:border-primary/30 flex items-center justify-center transition-colors disabled:opacity-50"
                aria-label="Refresh status"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 text-muted-foreground ${isRefreshing ? 'animate-spin' : ''}`}
                />
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div
              className={`relative h-11 w-11 rounded-lg flex items-center justify-center ${
                loading
                  ? 'bg-primary/10'
                  : isOnline
                    ? 'bg-[hsl(152_60%_45%/0.1)]'
                    : 'bg-destructive/10'
              }`}
            >
              {loading ? (
                <Loader2 className="h-5 w-5 text-primary animate-spin" />
              ) : isOnline ? (
                <Wifi className="h-5 w-5 text-[hsl(152_60%_45%)]" />
              ) : (
                <WifiOff className="h-5 w-5 text-destructive" />
              )}
            </div>
            <div>
              <p
                className={`text-lg font-display font-bold ${
                  loading
                    ? 'text-primary'
                    : isOnline
                      ? 'text-[hsl(152_60%_50%)]'
                      : 'text-destructive'
                }`}
              >
                {loading ? 'Checking...' : isOnline ? 'Online' : 'Offline'}
              </p>
              {lastUpdatedString && !loading && (
                <p className="text-[10px] font-mono text-muted-foreground">
                  Updated {lastUpdatedString}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Exchanges Card */}
        <div className="p-4 rounded-lg bg-secondary border border-border">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
              Exchanges
            </span>
            <Server className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-lg bg-primary/10 flex items-center justify-center">
              <span className="text-lg font-display font-bold text-primary">
                {health?.exchanges?.length || 4}
              </span>
            </div>
            <div>
              <p className="text-lg font-display font-bold">Supported</p>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3 w-3 text-[hsl(152_60%_45%)]" />
                <p className="text-[10px] font-mono text-muted-foreground">All exchanges active</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
