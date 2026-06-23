/**
 * Sidebar health footer — system status
 *
 * Polls /health every 30s. Shows aggregate state: online / degraded / offline
 * with the count of connected exchanges.
 */

import { cn } from '@/lib/utils';
import { useHealth } from '@/lib/queries';

export function SidebarHealth() {
  const { data, isLoading, isError } = useHealth();

  const status =
    isError || !data
      ? 'offline'
      : data.api === 'ready'
        ? (data.exchanges?.length ?? 0) > 0
          ? 'online'
          : 'degraded'
        : 'offline';

  const exchangeCount = data?.exchanges?.length ?? 0;

  const dotClass =
    status === 'online' ? 'bg-success' : status === 'degraded' ? 'bg-warning' : 'bg-destructive';

  const label =
    status === 'online' ? 'System Online' : status === 'degraded' ? 'Degraded' : 'Offline';

  const sublabel = isLoading
    ? 'Connecting…'
    : isError || !data
      ? 'Connection failed'
      : `${exchangeCount} exchange${exchangeCount === 1 ? '' : 's'} connected`;

  return (
    <footer className={cn('border-t border-border px-4 py-3', 'flex items-center gap-2.5')}>
      <span className="relative flex h-2 w-2 shrink-0">
        <span
          className={cn(
            'absolute inline-flex h-full w-full rounded-full opacity-60',
            dotClass,
            status === 'online' && 'animate-blink-soft'
          )}
        />
        <span className={cn('relative inline-flex h-2 w-2 rounded-full', dotClass)} />
      </span>
      <div className="flex flex-col min-w-0">
        <span className="text-xs font-medium text-foreground truncate">{label}</span>
        <span className="text-[10px] font-mono text-muted-foreground truncate">{sublabel}</span>
      </div>
    </footer>
  );
}
