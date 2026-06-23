/**
 * Legacy PageHeader — backward-compat wrapper around new ui/page-header
 *
 * Existing pages import from `@/components/page-header`. This file preserves
 * that import path and adapts the old API to the new clean PageHeader.
 * New code should import from `@/components/ui/page-header` directly.
 */

import type { LucideIcon } from 'lucide-react';
import { PageHeader as NewPageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';

interface PageHeaderProps {
  icon: LucideIcon;
  title: string;
  description: string;
  badge?: {
    text: string;
    variant?: 'default' | 'success' | 'warning';
  };
  className?: string;
}

export function PageHeader({ icon, title, description, badge, className }: PageHeaderProps) {
  return (
    <NewPageHeader
      icon={icon}
      title={title}
      description={description}
      className={className}
      actions={
        badge && (
          <Badge
            variant={
              badge.variant === 'success' ? 'up' : badge.variant === 'warning' ? 'stale' : 'default'
            }
          >
            {badge.text}
          </Badge>
        )
      }
    />
  );
}
