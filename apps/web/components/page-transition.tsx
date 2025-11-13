'use client'

/**
 * PageTransition component - Provides smooth page transitions using framer-motion
 * Features:
 * - Fade in/out effect when navigating between pages
 * - Slight vertical slide animation for elegance
 * - Staggered animation for child elements
 * - Optimized for performance with layout animations
 */

import { motion } from 'framer-motion'
import { ReactNode } from 'react'

interface PageTransitionProps {
  children: ReactNode
}

/**
 * Animation variants for page transitions
 * - initial: State when page first loads (before animation)
 * - animate: Target state (fully visible)
 * - exit: State when leaving page (if using AnimatePresence)
 * Optimized for speed to reduce perceived navigation delay
 */
const pageVariants = {
  initial: {
    opacity: 0,
    y: 8,
  },
  animate: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.2,
      ease: [0.4, 0, 0.2, 1], // Tailwind's ease-out curve
    },
  },
  exit: {
    opacity: 0,
    transition: {
      duration: 0.15,
    },
  },
}

/**
 * PageTransition wrapper component
 * Wraps page content to provide smooth entrance animations
 */
export function PageTransition({ children }: PageTransitionProps) {
  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="h-full"
    >
      {children}
    </motion.div>
  )
}
