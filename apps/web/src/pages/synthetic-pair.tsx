/**
 * Synthetic Pair Page - Terminal Luxe
 */

import { PageHeader } from '@/components/page-header';
import { GitMerge } from 'lucide-react';

export default function SyntheticPairPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        icon={GitMerge}
        title="Synthetic Pairs"
        description="Create custom synthetic pairs by dividing one asset by another."
      />

      <div className="bg-card rounded-xl border border-border p-8 text-center">
        <p className="text-muted-foreground">Synthetic pair creation coming soon...</p>
      </div>
    </div>
  );
}
