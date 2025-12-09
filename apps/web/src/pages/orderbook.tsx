/**
 * Order Book Page - Terminal Luxe
 * Real-time order book visualization
 */

import { PageHeader } from '@/components/page-header';
import { BookOpen } from 'lucide-react';

export default function OrderBookPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        icon={BookOpen}
        title="Order Book"
        description="Real-time order book visualization with depth analysis."
      />

      <div className="bg-card rounded-xl border border-border p-8 text-center">
        <p className="text-muted-foreground">Order book visualization coming soon...</p>
      </div>
    </div>
  );
}
