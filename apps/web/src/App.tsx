/**
 * Route definitions
 *
 * Flat URL structure (no section prefixes). All 12 routes are direct children
 * of the layout. Legacy section-prefixed paths 301-redirect.
 *
 * Pages are lazy-loaded for code-splitting. Suspense fallback is a full-page
 * loader that doesn't shift layout.
 */

import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { AppFrame } from './components/shell/AppFrame';
import { LoadingPage } from './components/loading-page';
import { ErrorBoundary } from './components/error-boundary';
import { CommandPalette } from './components/command-palette';
import NotFoundPage from './pages/not-found';
import { legacyRouteAliases } from './lib/navigation';

// Lazy-loaded page components. Each is a separate chunk.
const DashboardPage = lazy(() => import('./pages/home'));
const ExchangesPage = lazy(() => import('./pages/exchanges'));
const MarketsPage = lazy(() => import('./pages/markets'));
const OrderBookPage = lazy(() => import('./pages/orderbook'));
const AltScreenerPage = lazy(() => import('./pages/alt-screener'));
const FundingRatesPage = lazy(() => import('./pages/funding-rates'));
const FundingArbitragePage = lazy(() => import('./pages/funding-arbitrage'));
const InstitutionalPage = lazy(() => import('./pages/institutional'));
const EtfFlowsPage = lazy(() => import('./pages/etf-flows'));
const OptionsPage = lazy(() => import('./pages/options'));
const MultiTFPage = lazy(() => import('./pages/multitf'));
const SyntheticPairPage = lazy(() => import('./pages/synthetic-pair'));
const CustomIndexPage = lazy(() => import('./pages/custom-index'));
const SuperEMAPage = lazy(() => import('./pages/superema'));
const MarketWorkspacePage = lazy(() => import('./pages/market-workspace'));
const PriceArbitragePage = lazy(() => import('./pages/price-arbitrage'));
const SignalLabPage = lazy(() => import('./pages/signal-lab'));
const AlphaFeedPage = lazy(() => import('./pages/alpha-feed'));
const MarketSymbolPage = lazy(() => import('./pages/market-symbol'));
const ExchangeDetailPage = lazy(() => import('./pages/exchange-detail'));
const SignalDetailPage = lazy(() => import('./pages/signal-detail'));

/** Preserve query string on legacy redirects */
function LegacyRedirect({ to }: { to: string }) {
  const location = useLocation();
  return <Navigate to={{ pathname: to, search: location.search }} replace />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppFrame>
        <CommandPalette showTrigger={false} />
        <ErrorBoundary>
          <Suspense fallback={<LoadingPage />}>
            <Routes>
              {/* Primary routes — flat URLs */}
              <Route path="/" element={<DashboardPage />} />
              <Route path="/markets" element={<MarketsPage />} />
              <Route path="/markets/:exchange/:symbol" element={<MarketSymbolPage />} />
              <Route path="/screener" element={<AltScreenerPage />} />
              <Route path="/exchanges" element={<ExchangesPage />} />
              <Route path="/exchanges/:exchange" element={<ExchangeDetailPage />} />
              <Route path="/workspace" element={<MarketWorkspacePage />} />
              <Route path="/orderbook" element={<OrderBookPage />} />
              <Route path="/multi-timeframe" element={<MultiTFPage />} />
              <Route path="/superema" element={<SuperEMAPage />} />
              <Route path="/price-arbitrage" element={<PriceArbitragePage />} />
              <Route path="/signal-lab" element={<SignalLabPage />} />
              <Route path="/alpha-feed" element={<AlphaFeedPage />} />
              <Route path="/signals/:id" element={<SignalDetailPage />} />
              <Route path="/institutional" element={<InstitutionalPage />} />
              <Route path="/etf-flows" element={<EtfFlowsPage />} />
              <Route path="/options" element={<OptionsPage />} />
              <Route path="/funding" element={<FundingRatesPage />} />
              <Route path="/funding-arbitrage" element={<FundingArbitragePage />} />
              <Route path="/synthetic-pair" element={<SyntheticPairPage />} />
              <Route path="/custom-index" element={<CustomIndexPage />} />

              {/* Legacy aliases — 301 to new flat URLs */}
              {Object.entries(legacyRouteAliases).map(([legacyPath, newPath]) => (
                <Route
                  key={legacyPath}
                  path={legacyPath}
                  element={<LegacyRedirect to={newPath} />}
                />
              ))}

              {/* Catch-all 404 */}
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </AppFrame>
    </ErrorBoundary>
  );
}
