/**
 * Custom Index Page - Terminal Luxe
 */

import { PageHeader } from '@/components/page-header';
import { PieChart } from 'lucide-react';

export default function CustomIndexPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        icon={PieChart}
        title="Custom Index"
        description="Build weighted asset indices to track custom baskets of cryptocurrencies."
      />

      <div className="bg-card rounded-xl border border-border p-8 text-center">
        <p className="text-muted-foreground">Custom index builder coming soon...</p>
      </div>
    </div>
  );
}
