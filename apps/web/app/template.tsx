'use client'

/**
 * Root template - Wraps all pages with transition animations
 * This file re-renders on navigation, enabling page transitions
 */

import { PageTransition } from '@/components/page-transition'

export default function Template({ children }: { children: React.ReactNode }) {
  return <PageTransition>{children}</PageTransition>
}
