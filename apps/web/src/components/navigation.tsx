/**
 * Navigation Component - Terminal Luxe Aesthetic
 *
 * Features:
 * - Refined minimal sidebar with warm amber accents
 * - Elegant typography hierarchy using Clash Display
 * - Subtle animations with sophisticated easing
 * - Clean lines and generous whitespace
 * - Mobile-responsive with slide-out drawer
 */

import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  TrendingUp,
  LayoutGrid,
  GitMerge,
  PieChart,
  Activity,
  Zap,
  Menu,
  X,
  Percent,
  Search,
  Command,
  BookOpen,
} from 'lucide-react';
import { LazuliAPI } from '@/lib/api-client';

/**
 * System health status interface
 */
interface SystemHealth {
  status: 'online' | 'degraded' | 'offline';
  exchangeCount: number;
  message: string;
}

/**
 * Navigation items with semantic icons
 */
const navItems = [
  {
    href: '/',
    label: 'Dashboard',
    icon: LayoutDashboard,
  },
  // TODO: Revamp exchanges page
  // {
  //   href: '/exchanges',
  //   label: 'Exchanges',
  //   icon: Globe,
  // },
  {
    href: '/markets',
    label: 'Markets',
    icon: TrendingUp,
  },
  {
    href: '/orderbook',
    label: 'Order Book',
    icon: BookOpen,
  },
  {
    href: '/alt-screener',
    label: 'Alt Screener',
    icon: Zap,
  },
  {
    href: '/funding-rates',
    label: 'Funding Rates',
    icon: Percent,
  },
  {
    href: '/multitf',
    label: 'Multi-TF',
    icon: LayoutGrid,
  },
  {
    href: '/synthetic-pair',
    label: 'Synthetic',
    icon: GitMerge,
  },
  {
    href: '/custom-index',
    label: 'Index',
    icon: PieChart,
  },
  {
    href: '/superema',
    label: 'SuperEMA',
    icon: Activity,
  },
];

/**
 * Refined animation variants
 */
const sidebarVariants = {
  open: {
    x: 0,
    transition: {
      type: 'spring' as const,
      stiffness: 400,
      damping: 40,
    },
  },
  closed: {
    x: '-100%',
    transition: {
      type: 'spring' as const,
      stiffness: 400,
      damping: 40,
    },
  },
};

const navItemsContainerVariants = {
  open: {
    transition: {
      staggerChildren: 0.04,
      delayChildren: 0.1,
    },
  },
  closed: {
    transition: {
      staggerChildren: 0.03,
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
      stiffness: 400,
      damping: 30,
    },
  },
  closed: {
    x: -16,
    opacity: 0,
    transition: {
      type: 'spring' as const,
      stiffness: 400,
      damping: 30,
    },
  },
};

export function Navigation() {
  const location = useLocation();
  const pathname = location.pathname;
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [systemHealth, setSystemHealth] = useState<SystemHealth>({
    status: 'offline',
    exchangeCount: 0,
    message: 'Connecting...',
  });

  const closeMobileMenu = useCallback(() => {
    setIsMobileMenuOpen(false);
  }, []);

  // Fetch system health status periodically
  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const response = await LazuliAPI.getHealth();
        if (response.success && response.data) {
          const exchangeCount = response.data.exchanges?.length || 0;
          const isApiReady = response.data.api === 'ready';
          const isDbConnected = response.data.database === 'connected';

          // Determine overall status
          let status: SystemHealth['status'] = 'online';
          let message = `${exchangeCount} exchange${exchangeCount !== 1 ? 's' : ''} connected`;

          if (!isApiReady) {
            status = 'offline';
            message = 'API not ready';
          } else if (!isDbConnected) {
            status = 'degraded';
            message = `${exchangeCount} exchanges (DB offline)`;
          }

          setSystemHealth({ status, exchangeCount, message });
        } else {
          setSystemHealth({
            status: 'offline',
            exchangeCount: 0,
            message: 'Connection failed',
          });
        }
      } catch {
        setSystemHealth({
          status: 'offline',
          exchangeCount: 0,
          message: 'Connection failed',
        });
      }
    };

    // Initial fetch
    fetchHealth();

    // Poll every 30 seconds
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  // Detect desktop screen size
  useEffect(() => {
    const checkDesktop = () => {
      setIsDesktop(window.innerWidth >= 1024);
    };
    checkDesktop();
    window.addEventListener('resize', checkDesktop);
    return () => window.removeEventListener('resize', checkDesktop);
  }, []);

  // Keyboard navigation - Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isMobileMenuOpen) {
        closeMobileMenu();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isMobileMenuOpen, closeMobileMenu]);

  // Prevent body scroll when menu is open
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

  const sidebarState = isDesktop || isMobileMenuOpen ? 'open' : 'closed';

  return (
    <>
      {/* Mobile Menu Button */}
      <motion.button
        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        className="fixed left-4 top-4 z-50 flex h-11 w-11 items-center justify-center rounded-lg bg-card border border-border lg:hidden"
        aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={isMobileMenuOpen}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        <AnimatePresence mode="wait">
          {isMobileMenuOpen ? (
            <motion.div
              key="close"
              initial={{ rotate: -90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: 90, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <X className="h-5 w-5 text-foreground" />
            </motion.div>
          ) : (
            <motion.div
              key="menu"
              initial={{ rotate: 90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: -90, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <Menu className="h-5 w-5 text-foreground" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>

      {/* Mobile Overlay */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            className="fixed inset-0 z-30 bg-background/80 backdrop-blur-sm lg:hidden"
            onClick={closeMobileMenu}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            aria-hidden="true"
          />
        )}
      </AnimatePresence>

      {/* Sidebar Navigation */}
      <motion.nav
        className="fixed left-0 top-0 z-40 flex h-screen w-[280px] flex-col border-r border-border bg-card lg:translate-x-0"
        initial={false}
        animate={sidebarState}
        variants={sidebarVariants}
        role="navigation"
        aria-label="Main navigation"
      >
        {/* Logo Section */}
        <div className="flex h-[72px] items-center border-b border-border px-6">
          <Link to="/" className="group flex items-center" onClick={closeMobileMenu}>
            {/* Logo Text */}
            <div className="flex flex-col">
              <span className="text-lg font-display font-semibold tracking-tight text-foreground">
                Lazuli
              </span>
              <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Market Intelligence
              </span>
            </div>
          </Link>
        </div>

        {/* Command Palette Trigger */}
        <div className="px-3 py-3 border-b border-border">
          <button
            onClick={() => {
              // Dispatch keyboard event to open command palette
              const event = new KeyboardEvent('keydown', {
                key: 'k',
                metaKey: true,
                bubbles: true,
              });
              document.dispatchEvent(event);
              closeMobileMenu();
            }}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg',
              'text-sm text-muted-foreground',
              'bg-muted/50 border border-border',
              'hover:bg-accent hover:text-foreground hover:border-primary/30',
              'transition-all duration-200'
            )}
            aria-label="Open command palette"
          >
            <Search className="h-4 w-4" />
            <span className="flex-1 text-left text-xs">Search...</span>
            <kbd className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono font-medium bg-background rounded border border-border">
              <Command className="h-3 w-3" />K
            </kbd>
          </button>
        </div>

        {/* Navigation Links */}
        <div className="flex-1 overflow-y-auto px-3 py-4 custom-scrollbar">
          <motion.div
            className="space-y-0.5"
            variants={navItemsContainerVariants}
            initial="closed"
            animate="open"
          >
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              const Icon = item.icon;

              return (
                <motion.div key={item.href} variants={navItemVariants}>
                  <Link to={item.href} onClick={closeMobileMenu} className="block">
                    <motion.div
                      className={cn(
                        'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors duration-200',
                        isActive
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                      )}
                      whileHover={{ x: isActive ? 0 : 2 }}
                      whileTap={{ scale: 0.99 }}
                    >
                      {/* Active indicator line */}
                      {isActive && (
                        <motion.div
                          className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-full"
                          layoutId="activeNav"
                          transition={{
                            type: 'spring',
                            stiffness: 500,
                            damping: 35,
                          }}
                        />
                      )}

                      {/* Icon */}
                      <Icon
                        className={cn(
                          'h-[18px] w-[18px] shrink-0 transition-colors',
                          isActive
                            ? 'text-primary'
                            : 'text-muted-foreground group-hover:text-foreground'
                        )}
                        strokeWidth={isActive ? 2.5 : 2}
                      />

                      {/* Label */}
                      <span
                        className={cn('font-medium tracking-tight', isActive && 'font-semibold')}
                      >
                        {item.label}
                      </span>
                    </motion.div>
                  </Link>
                </motion.div>
              );
            })}
          </motion.div>
        </div>

        {/* Status Footer - Dynamic health status from API */}
        <div className="border-t border-border px-4 py-4">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'status-dot',
                systemHealth.status === 'online' && 'status-online',
                systemHealth.status === 'degraded' && 'status-warning',
                systemHealth.status === 'offline' && 'status-offline'
              )}
            />
            <div className="flex flex-col">
              <span className="text-xs font-medium text-foreground">
                {systemHealth.status === 'online' && 'System Online'}
                {systemHealth.status === 'degraded' && 'System Degraded'}
                {systemHealth.status === 'offline' && 'System Offline'}
              </span>
              <span className="text-[10px] font-mono text-muted-foreground">
                {systemHealth.message}
              </span>
            </div>
          </div>
        </div>
      </motion.nav>
    </>
  );
}
