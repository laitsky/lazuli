/**
 * Multi-Timeframe Analysis Page - Terminal Luxe
 */

import { PageHeader } from '@/components/page-header';
import { LayoutGrid } from 'lucide-react';

export default function MultiTFPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        icon={LayoutGrid}
        title="Multi-Timeframe"
        description="Analyze price action across multiple timeframes simultaneously."
      />

      <div className="bg-card rounded-xl border border-border p-8 text-center">
        <p className="text-muted-foreground">Multi-timeframe charts coming soon...</p>
      </div>
    </div>
  );
}
