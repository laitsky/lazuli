/**
 * Funding Arbitrage Page - Terminal Luxe
 * Cross-exchange funding rate arbitrage opportunities
 */

import { PageHeader } from '@/components/page-header';
import { Percent } from 'lucide-react';

export default function FundingArbitragePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        icon={Percent}
        title="Funding Arbitrage"
        description="Cross-exchange funding rate arbitrage opportunities."
      />

      <div className="bg-card rounded-xl border border-border p-8 text-center">
        <p className="text-muted-foreground">Funding arbitrage analysis coming soon...</p>
      </div>
    </div>
  );
}
