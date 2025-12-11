import * as React from 'react';
import { cn } from '@/lib/utils';

interface ExchangeLogoProps extends React.HTMLAttributes<HTMLDivElement> {
  exchangeId: string;
}

/**
 * Exchange Logo Component
 * Displays exchange logos using standard img tags (migrated from next/image)
 */
export function ExchangeLogo({ exchangeId, className, ...props }: ExchangeLogoProps) {
  const id = exchangeId.toLowerCase();

  // Exchange logo mappings - logos stored in /public/exchanges/
  const exchangeLogos: Record<string, { src: string; alt: string }> = {
    binance: { src: '/exchanges/binance.png', alt: 'Binance Logo' },
    bybit: { src: '/exchanges/bybit.png', alt: 'Bybit Logo' },
    okx: { src: '/exchanges/okx.png', alt: 'OKX Logo' },
    hyperliquid: { src: '/exchanges/hyperliquid.png', alt: 'Hyperliquid Logo' },
    upbit: { src: '/exchanges/upbit.png', alt: 'Upbit Logo' },
  };

  const logo = exchangeLogos[id];

  if (!logo) {
    // Fallback for unknown exchanges
    return (
      <div
        className={cn('flex items-center justify-center bg-muted rounded-full', className)}
        {...props}
      >
        <span className="text-xs font-bold">{id.substring(0, 2).toUpperCase()}</span>
      </div>
    );
  }

  return (
    <div className={cn('relative overflow-hidden', className)} {...props}>
      <img
        src={logo.src}
        alt={logo.alt}
        className="w-full h-full object-contain p-1"
        loading="lazy"
      />
    </div>
  );
}
