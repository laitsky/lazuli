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

  let src = '';
  let alt = '';

  if (id === 'binance') {
    src = 'https://upload.wikimedia.org/wikipedia/commons/5/57/Binance_Logo.png';
    alt = 'Binance Logo';
  } else if (id === 'bybit') {
    src = 'https://altcoinsbox.com/wp-content/uploads/2022/10/bybit-logo-white.jpg';
    alt = 'Bybit Logo';
  } else if (id === 'okx') {
    src = 'https://altcoinsbox.com/wp-content/uploads/2023/03/okx-logo-300x300.webp';
    alt = 'OKX Logo';
  } else if (id === 'hyperliquid') {
    src = 'https://avatars.githubusercontent.com/u/125463758?s=200&v=4';
    alt = 'Hyperliquid Logo';
  } else if (id === 'upbit') {
    src =
      'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2a/Upbit_Logo.svg/1024px-Upbit_Logo.svg.png';
    alt = 'Upbit Logo';
  } else {
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
      <img src={src} alt={alt} className="w-full h-full object-contain p-1" loading="lazy" />
    </div>
  );
}
