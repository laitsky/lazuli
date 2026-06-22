import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { Layout } from './components/layout';
import { LoadingPage } from './components/loading-page';
import { ErrorBoundary } from './components/error-boundary';
import { legacyRouteAliases } from './lib/navigation';

/**
 * Lazy-loaded page components for code splitting
 * This improves initial load time by only loading pages when needed
 */
const HomePage = lazy(() => import('./pages/home'));
const ExchangesPage = lazy(() => import('./pages/exchanges'));
const MarketsPage = lazy(() => import('./pages/markets'));
const OrderBookPage = lazy(() => import('./pages/orderbook'));
const AltScreenerPage = lazy(() => import('./pages/alt-screener'));
const FundingRatesPage = lazy(() => import('./pages/funding-rates'));
const FundingArbitragePage = lazy(() => import('./pages/funding-arbitrage'));
const MultiTFPage = lazy(() => import('./pages/multitf'));
const SyntheticPairPage = lazy(() => import('./pages/synthetic-pair'));
const CustomIndexPage = lazy(() => import('./pages/custom-index'));
const SuperEMAPage = lazy(() => import('./pages/superema'));
const MarketWorkspacePage = lazy(() => import('./pages/market-workspace'));
const PriceArbitragePage = lazy(() => import('./pages/price-arbitrage'));

function LegacyRedirect({ to }: { to: string }) {
  const location = useLocation();
  return <Navigate to={{ pathname: to, search: location.search }} replace />;
}

/**
 * Main Application Component
 *
 * Defines the application routing structure with:
 * - Shared layout wrapper (navigation, command palette)
 * - Lazy-loaded pages with Suspense fallback
 * - React Router v7 route definitions
 */
export default function App() {
  return (
    <ErrorBoundary>
      <Layout>
        <ErrorBoundary>
          <Suspense fallback={<LoadingPage />}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/discover/exchanges" element={<ExchangesPage />} />
              <Route path="/discover/markets" element={<MarketsPage />} />
              <Route path="/discover/screener" element={<AltScreenerPage />} />
              <Route path="/analyze/workspace" element={<MarketWorkspacePage />} />
              <Route path="/analyze/orderbook" element={<OrderBookPage />} />
              <Route path="/analyze/multi-timeframe" element={<MultiTFPage />} />
              <Route path="/analyze/superema" element={<SuperEMAPage />} />
              <Route path="/strategies/funding" element={<FundingRatesPage />} />
              <Route path="/strategies/funding/arbitrage" element={<FundingArbitragePage />} />
              <Route path="/strategies/price-arbitrage" element={<PriceArbitragePage />} />
              <Route path="/strategies/synthetic-pair" element={<SyntheticPairPage />} />
              <Route path="/strategies/custom-index" element={<CustomIndexPage />} />
              {Object.entries(legacyRouteAliases).map(([legacyPath, newPath]) => (
                <Route
                  key={legacyPath}
                  path={legacyPath}
                  element={<LegacyRedirect to={newPath} />}
                />
              ))}
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </Layout>
    </ErrorBoundary>
  );
}
