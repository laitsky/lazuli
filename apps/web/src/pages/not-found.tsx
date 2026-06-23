/**
 * 404 page
 *
 * Calm, helpful, not cutesy. Surfaces the main navigation so users can recover
 * quickly. Keeps the topbar/sidebar via AppFrame (this is a route, not a separate layout).
 */

import { Link } from 'react-router-dom';
import { ArrowLeft, Home } from 'lucide-react';
import { navigationSections } from '@/lib/navigation';

export default function NotFoundPage() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center">
      <p className="numeric text-7xl font-display font-semibold text-accent">404</p>
      <h1 className="mt-4 text-xl font-display font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-muted-foreground max-w-sm">
        The page you&apos;re looking for doesn&apos;t exist or has moved.
      </p>
      <Link
        to="/"
        className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-md bg-accent text-accent-foreground hover:opacity-90 transition-opacity text-sm font-medium"
      >
        <Home className="h-4 w-4" aria-hidden /> Back to Dashboard
      </Link>

      <div className="mt-10 w-full max-w-md">
        <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">
          Or jump to
        </p>
        <div className="grid grid-cols-2 gap-2">
          {navigationSections
            .flatMap((s) => s.items)
            .filter((r) => r.href !== '/')
            .slice(0, 8)
            .map((r) => (
              <Link
                key={r.href}
                to={r.href}
                className="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-surface-1 hover:bg-surface-2 hover:border-border-strong transition-colors text-sm text-left"
              >
                <ArrowLeft className="h-3 w-3 text-muted-foreground" aria-hidden />
                <span className="truncate">{r.label}</span>
              </Link>
            ))}
        </div>
      </div>
    </div>
  );
}
