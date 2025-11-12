'use client'

/**
 * Navigation component - Responsive sidebar navigation for the application
 * Features:
 * - Fixed sidebar on desktop (left side, always visible)
 * - Collapsible sidebar on mobile with hamburger menu
 * - Smooth transitions and animations
 * - Active link highlighting
 * - Logo at top, Live status at bottom
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useState } from 'react'

const navItems = [
  { href: '/', label: 'Dashboard', icon: '📊' },
  { href: '/exchanges', label: 'Exchanges', icon: '🏦' },
  { href: '/tickers', label: 'Tickers', icon: '📈' },
  { href: '/markets', label: 'Markets', icon: '💹' },
  { href: '/multitf', label: 'MultiTF', icon: '⏱️' },
  { href: '/custom-pair', label: 'Custom Pair', icon: '🔍' },
]

export function Navigation() {
  const pathname = usePathname()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  return (
    <>
      {/* Mobile Menu Button - Only visible on mobile */}
      <button
        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        className="fixed left-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground lg:hidden"
        aria-label="Toggle navigation menu"
      >
        {/* Hamburger Icon */}
        <div className="flex flex-col space-y-1.5">
          <span
            className={cn(
              'block h-0.5 w-5 bg-current transition-transform',
              isMobileMenuOpen && 'translate-y-2 rotate-45'
            )}
          />
          <span
            className={cn(
              'block h-0.5 w-5 bg-current transition-opacity',
              isMobileMenuOpen && 'opacity-0'
            )}
          />
          <span
            className={cn(
              'block h-0.5 w-5 bg-current transition-transform',
              isMobileMenuOpen && '-translate-y-2 -rotate-45'
            )}
          />
        </div>
      </button>

      {/* Overlay for mobile - darkens background when menu is open */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar Navigation */}
      <nav
        className={cn(
          'fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r bg-background transition-transform duration-300',
          // Mobile: slide in from left when open, hide when closed
          'lg:translate-x-0', // Always visible on desktop
          !isMobileMenuOpen && '-translate-x-full lg:translate-x-0' // Hidden on mobile by default
        )}
      >
        {/* Logo Section */}
        <div className="flex h-16 items-center space-x-3 border-b px-6">
          <Link
            href="/"
            className="flex items-center space-x-3"
            onClick={() => setIsMobileMenuOpen(false)}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <span className="text-xl font-bold">L</span>
            </div>
            <span className="text-xl font-bold">Lazuli</span>
          </Link>
        </div>

        {/* Navigation Links */}
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <div className="space-y-1">
            {navItems.map((item) => {
              const isActive = pathname === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={cn(
                    'flex items-center space-x-3 rounded-lg px-4 py-3 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  )}
                >
                  <span className="text-xl">{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              )
            })}
          </div>
        </div>

        {/* Status Indicator - Fixed at bottom */}
        <div className="border-t px-6 py-4">
          <div className="flex items-center space-x-2">
            <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-sm font-medium text-muted-foreground">
              Live
            </span>
          </div>
        </div>
      </nav>
    </>
  )
}
