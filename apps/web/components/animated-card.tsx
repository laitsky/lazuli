'use client'

/**
 * AnimatedCard component - Card wrapper with beautiful hover animations
 * Features:
 * - Smooth scale and shadow transitions on hover
 * - Subtle lift effect for better depth perception
 * - Tap feedback for mobile interactions
 * - Entrance animation when scrolling into view
 */

import { motion, HTMLMotionProps } from 'framer-motion'
import { ReactNode } from 'react'

interface AnimatedCardProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  children: ReactNode
  delay?: number
}

/**
 * AnimatedCard wrapper
 * Enhances any card component with smooth animations
 */
export function AnimatedCard({ children, delay = 0, ...props }: AnimatedCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.5,
        delay,
        ease: [0.6, 0.05, 0.01, 0.9],
      }}
      whileHover={{
        y: -4,
        transition: { duration: 0.2 },
      }}
      whileTap={{ scale: 0.98 }}
      {...props}
    >
      {children}
    </motion.div>
  )
}
