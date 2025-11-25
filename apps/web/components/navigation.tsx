'use client';

/**
 * Navigation component - Responsive sidebar navigation for the application
 * Features:
 * - Fixed sidebar on desktop (left side, always visible)
 * - Collapsible sidebar on mobile with hamburger menu
 * - Beautiful framer-motion animations throughout
 * - Staggered nav item animations
 * - Active link highlighting with smooth transitions
 * - Logo at top, Live status at bottom
 * - Keyboard navigation support (Escape to close mobile menu)
 * - Icons for each navigation item
 * - Improved mobile UX with better touch targets
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  Globe,
  TrendingUp,
  LayoutGrid,
  GitMerge,
  PieChart,
  Activity,
  ChevronRight,
  Zap,
} from 'lucide-react';

/**
 * Navigation items with icons and descriptions for better UX
 */
const navItems = [
  {
    href: '/',
    label: 'Dashboard',
    icon: LayoutDashboard,
    description: 'Overview & stats',
  },
  {
    href: '/exchanges',
    label: 'Exchanges',
    icon: Globe,
    description: 'View all exchanges',
  },
  {
    href: '/markets',
    label: 'Markets',
    icon: TrendingUp,
    description: 'Browse tickers',
  },
  {
    href: '/alt-screener',
    label: 'Alt Screener',
    icon: Zap,
    description: 'Scan all altcoins',
  },
  {
    href: '/multitf',
    label: 'MultiTF',
    icon: LayoutGrid,
    description: 'Multi-timeframe charts',
  },
  {
    href: '/synthetic-pair',
    label: 'Synthetic Pair',
    icon: GitMerge,
    description: 'Custom pair builder',
  },
  {
    href: '/custom-index',
    label: 'Custom Index',
    icon: PieChart,
    description: 'Create custom indices',
  },
  {
    href: '/superema',
    label: 'SuperEMA',
    icon: Activity,
    description: 'EMA indicator',
  },
];

/**
 * Animation variants for sidebar
 */
const sidebarVariants = {
  open: {
    x: 0,
    transition: {
      type: 'spring' as const,
      stiffness: 300,
      damping: 30,
    },
  },
  closed: {
    x: '-100%',
    transition: {
      type: 'spring' as const,
      stiffness: 300,
      damping: 30,
    },
  },
};

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
};

const navItemVariants = {
  open: {
    x: 0,
    opacity: 1,
    transition: {
      type: 'spring' as const,
      stiffness: 300,
      damping: 24,
    },
  },
  closed: {
    x: -20,
    opacity: 0,
    transition: {
      type: 'spring' as const,
      stiffness: 300,
      damping: 24,
    },
  },
};

/**
 * Animation variants for logo
 */
const logoVariants = {
  initial: { scale: 0.8, opacity: 0 },
  animate: {
    scale: 1,
    opacity: 1,
    transition: {
      type: 'spring' as const,
      stiffness: 260,
      damping: 20,
    },
  },
};

export function Navigation() {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  // Close mobile menu handler
  const closeMobileMenu = useCallback(() => {
    setIsMobileMenuOpen(false);
  }, []);

  // Detect desktop screen size on mount and window resize
  // This runs only on client-side to avoid hydration mismatch
  useEffect(() => {
    const checkDesktop = () => {
      setIsDesktop(window.innerWidth >= 1024);
    };

    // Set initial state
    checkDesktop();

    // Listen for resize events
    window.addEventListener('resize', checkDesktop);

    return () => window.removeEventListener('resize', checkDesktop);
  }, []);

  // Keyboard navigation - close menu on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isMobileMenuOpen) {
        closeMobileMenu();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isMobileMenuOpen, closeMobileMenu]);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMobileMenuOpen]);

  // Determine sidebar state
  const sidebarState = isDesktop || isMobileMenuOpen ? 'open' : 'closed';

  return (
    <>
      {/* Mobile Menu Button - Only visible on mobile */}
      <motion.button
        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        className="fixed left-4 top-4 z-50 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/25 lg:hidden"
        aria-label={isMobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={isMobileMenuOpen}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        {/* Animated Hamburger Icon */}
        <div className="flex flex-col space-y-1.5">
          <motion.span
            className="block h-0.5 w-5 bg-current rounded-full"
            animate={isMobileMenuOpen ? { rotate: 45, y: 8 } : { rotate: 0, y: 0 }}
            transition={{ duration: 0.3 }}
          />
          <motion.span
            className="block h-0.5 w-5 bg-current rounded-full"
            animate={isMobileMenuOpen ? { opacity: 0, x: -10 } : { opacity: 1, x: 0 }}
            transition={{ duration: 0.3 }}
          />
          <motion.span
            className="block h-0.5 w-5 bg-current rounded-full"
            animate={isMobileMenuOpen ? { rotate: -45, y: -8 } : { rotate: 0, y: 0 }}
            transition={{ duration: 0.3 }}
          />
        </div>
      </motion.button>

      {/* Overlay for mobile - darkens background when menu is open */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
            onClick={closeMobileMenu}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            aria-hidden="true"
          />
        )}
      </AnimatePresence>

      {/* Sidebar Navigation */}
      <motion.nav
        className="fixed left-0 top-0 z-40 flex h-screen w-72 flex-col border-r border-white/10 bg-card/95 backdrop-blur-xl shadow-2xl lg:translate-x-0"
        initial={false}
        animate={sidebarState}
        variants={sidebarVariants}
        role="navigation"
        aria-label="Main navigation"
      >
        {/* Logo Section */}
        <motion.div
          className="flex h-20 items-center space-x-3 border-b border-white/10 px-6"
          variants={logoVariants}
          initial="initial"
          animate="animate"
        >
          <Link href="/" className="group flex items-center space-x-3" onClick={closeMobileMenu}>
            <motion.div
              className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-blue-600 text-primary-foreground shadow-lg shadow-primary/25"
              whileHover={{ rotate: 360, scale: 1.05 }}
              transition={{ duration: 0.6 }}
            >
              <span className="text-xl font-display font-bold">L</span>
              {/* Glow effect on hover */}
              <div className="absolute inset-0 rounded-xl bg-primary/20 blur-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 -z-10" />
            </motion.div>
            <div>
              <span className="text-xl font-display font-bold group-hover:text-primary transition-colors">
                Lazuli
              </span>
              <span className="block text-[10px] text-muted-foreground font-medium tracking-wider uppercase">
                Trading Platform
              </span>
            </div>
          </Link>
        </motion.div>

        {/* Navigation Links */}
        <div className="flex-1 overflow-y-auto px-4 py-6 custom-scrollbar">
          <motion.div
            className="space-y-1.5"
            variants={navItemsContainerVariants}
            initial="closed"
            animate="open"
          >
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              const Icon = item.icon;

              return (
                <motion.div key={item.href} variants={navItemVariants}>
                  <Link
                    href={item.href}
                    onClick={closeMobileMenu}
                    className="block"
                    onMouseEnter={() => setHoveredItem(item.href)}
                    onMouseLeave={() => setHoveredItem(null)}
                  >
                    <motion.div
                      className={cn(
                        'group relative flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200',
                        isActive
                          ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/25'
                          : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
                      )}
                      whileHover={{
                        scale: isActive ? 1 : 1.02,
                        x: isActive ? 0 : 4,
                        transition: { duration: 0.2 },
                      }}
                      whileTap={{ scale: 0.98 }}
                    >
                      {/* Icon */}
                      <Icon
                        className={cn(
                          'h-5 w-5 shrink-0 transition-colors',
                          isActive
                            ? 'text-primary-foreground'
                            : 'text-muted-foreground group-hover:text-primary'
                        )}
                      />

                      {/* Label and description */}
                      <div className="flex-1 min-w-0">
                        <span className="block truncate">{item.label}</span>
                        <span
                          className={cn(
                            'block text-[10px] truncate transition-colors',
                            isActive ? 'text-primary-foreground/70' : 'text-muted-foreground/70'
                          )}
                        >
                          {item.description}
                        </span>
                      </div>

                      {/* Arrow indicator on hover */}
                      <motion.div
                        initial={{ opacity: 0, x: -5 }}
                        animate={{
                          opacity: hoveredItem === item.href && !isActive ? 1 : 0,
                          x: hoveredItem === item.href && !isActive ? 0 : -5,
                        }}
                        transition={{ duration: 0.2 }}
                      >
                        <ChevronRight className="h-4 w-4 text-primary" />
                      </motion.div>

                      {/* Active indicator bar */}
                      {isActive && (
                        <motion.div
                          className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary-foreground rounded-r-full"
                          layoutId="activeIndicator"
                          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                        />
                      )}
                    </motion.div>
                  </Link>
                </motion.div>
              );
            })}
          </motion.div>
        </div>

        {/* Status Indicator - Fixed at bottom */}
        <motion.div
          className="border-t border-white/10 px-6 py-5 bg-white/5"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.5 }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <motion.div
                className="relative h-3 w-3 rounded-full bg-green-500"
                animate={{
                  scale: [1, 1.2, 1],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              >
                {/* Ping effect */}
                <span className="absolute inset-0 rounded-full bg-green-400 animate-ping opacity-75" />
              </motion.div>
              <div>
                <span className="text-sm font-medium text-foreground">System Online</span>
                <span className="block text-[10px] text-muted-foreground">
                  All services operational
                </span>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.nav>
    </>
  );
}
