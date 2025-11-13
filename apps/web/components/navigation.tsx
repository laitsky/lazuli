'use client'

/**
 * Navigation component - Responsive sidebar navigation for the application
 * Features:
 * - Fixed sidebar on desktop (left side, always visible)
 * - Collapsible sidebar on mobile with hamburger menu
 * - Beautiful framer-motion animations throughout
 * - Staggered nav item animations
 * - Active link highlighting with smooth transitions
 * - Logo at top, Live status at bottom
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const navItems = [
  { href: '/', label: 'Dashboard' },
  { href: '/exchanges', label: 'Exchanges' },
  { href: '/markets', label: 'Markets' },
  { href: '/multitf', label: 'MultiTF' },
  { href: '/custom-pair', label: 'Custom Pair' },
]

/**
 * Animation variants for sidebar
 */
const sidebarVariants = {
  open: {
    x: 0,
    transition: {
      type: 'spring',
      stiffness: 300,
      damping: 30,
    },
  },
  closed: {
    x: '-100%',
    transition: {
      type: 'spring',
      stiffness: 300,
      damping: 30,
    },
  },
}

/**
 * Animation variants for navigation items
 * Stagger effect makes items appear one by one
 */
const navItemsContainerVariants = {
  open: {
    transition: {
      staggerChildren: 0.07,
      delayChildren: 0.1,
    },
  },
  closed: {
    transition: {
      staggerChildren: 0.05,
      staggerDirection: -1,
    },
  },
}

const navItemVariants = {
  open: {
    x: 0,
    opacity: 1,
    transition: {
      type: 'spring',
      stiffness: 300,
      damping: 24,
    },
  },
  closed: {
    x: -20,
    opacity: 0,
    transition: {
      type: 'spring',
      stiffness: 300,
      damping: 24,
    },
  },
}

/**
 * Animation variants for logo
 */
const logoVariants = {
  initial: { scale: 0.8, opacity: 0 },
  animate: {
    scale: 1,
    opacity: 1,
    transition: {
      type: 'spring',
      stiffness: 260,
      damping: 20,
    },
  },
}

export function Navigation() {
  const pathname = usePathname()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [isDesktop, setIsDesktop] = useState(false)

  // Detect desktop screen size on mount and window resize
  // This runs only on client-side to avoid hydration mismatch
  useEffect(() => {
    const checkDesktop = () => {
      setIsDesktop(window.innerWidth >= 1024)
    }

    // Set initial state
    checkDesktop()

    // Listen for resize events
    window.addEventListener('resize', checkDesktop)

    return () => window.removeEventListener('resize', checkDesktop)
  }, [])

  // Determine sidebar state
  const sidebarState = isDesktop || isMobileMenuOpen ? 'open' : 'closed'

  return (
    <>
      {/* Mobile Menu Button - Only visible on mobile */}
      <motion.button
        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        className="fixed left-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground lg:hidden"
        aria-label="Toggle navigation menu"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        {/* Animated Hamburger Icon */}
        <div className="flex flex-col space-y-1.5">
          <motion.span
            className="block h-0.5 w-5 bg-current"
            animate={
              isMobileMenuOpen
                ? { rotate: 45, y: 8 }
                : { rotate: 0, y: 0 }
            }
            transition={{ duration: 0.3 }}
          />
          <motion.span
            className="block h-0.5 w-5 bg-current"
            animate={isMobileMenuOpen ? { opacity: 0 } : { opacity: 1 }}
            transition={{ duration: 0.3 }}
          />
          <motion.span
            className="block h-0.5 w-5 bg-current"
            animate={
              isMobileMenuOpen
                ? { rotate: -45, y: -8 }
                : { rotate: 0, y: 0 }
            }
            transition={{ duration: 0.3 }}
          />
        </div>
      </motion.button>

      {/* Overlay for mobile - darkens background when menu is open */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            className="fixed inset-0 z-30 bg-black/50 lg:hidden"
            onClick={() => setIsMobileMenuOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          />
        )}
      </AnimatePresence>

      {/* Sidebar Navigation */}
      <motion.nav
        className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r bg-card shadow-lg lg:translate-x-0"
        initial={false}
        animate={sidebarState}
        variants={sidebarVariants}
      >
        {/* Logo Section */}
        <motion.div
          className="flex h-16 items-center space-x-3 border-b px-6"
          variants={logoVariants}
          initial="initial"
          animate="animate"
        >
          <Link
            href="/"
            className="flex items-center space-x-3"
            onClick={() => setIsMobileMenuOpen(false)}
          >
            <motion.div
              className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground"
              whileHover={{ rotate: 360 }}
              transition={{ duration: 0.6 }}
            >
              <span className="text-xl font-display font-bold">L</span>
            </motion.div>
            <span className="text-xl font-display font-bold">Lazuli</span>
          </Link>
        </motion.div>

        {/* Navigation Links */}
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <motion.div
            className="space-y-1"
            variants={navItemsContainerVariants}
            initial="closed"
            animate="open"
          >
            {navItems.map((item) => {
              const isActive = pathname === item.href
              return (
                <motion.div key={item.href} variants={navItemVariants}>
                  <Link
                    href={item.href}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="block"
                  >
                    <motion.div
                      className={cn(
                        'rounded-lg px-4 py-2.5 text-sm font-medium transition-all duration-200',
                        isActive
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground hover:shadow-sm'
                      )}
                      whileHover={{
                        scale: isActive ? 1 : 1.01,
                        transition: { duration: 0.2 },
                      }}
                      whileTap={{ scale: 0.98 }}
                    >
                      {item.label}
                    </motion.div>
                  </Link>
                </motion.div>
              )
            })}
          </motion.div>
        </div>

        {/* Status Indicator - Fixed at bottom */}
        <motion.div
          className="border-t px-6 py-4"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.5 }}
        >
          <div className="flex items-center space-x-2">
            <motion.div
              className="h-2 w-2 rounded-full bg-green-500"
              animate={{
                scale: [1, 1.2, 1],
                opacity: [1, 0.8, 1],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            />
            <span className="text-sm font-medium text-muted-foreground">
              Live
            </span>
          </div>
        </motion.div>
      </motion.nav>
    </>
  )
}
