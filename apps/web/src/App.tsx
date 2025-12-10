import { Routes, Route } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { Layout } from './components/layout';
import { LoadingPage } from './components/loading-page';

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
const LiquidationsPage = lazy(() => import('./pages/liquidations'));

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
    <Layout>
      <Suspense fallback={<LoadingPage />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/exchanges" element={<ExchangesPage />} />
          <Route path="/markets" element={<MarketsPage />} />
          <Route path="/orderbook" element={<OrderBookPage />} />
          <Route path="/alt-screener" element={<AltScreenerPage />} />
          <Route path="/funding-rates" element={<FundingRatesPage />} />
          <Route path="/funding-rates/arbitrage" element={<FundingArbitragePage />} />
          <Route path="/multitf" element={<MultiTFPage />} />
          <Route path="/synthetic-pair" element={<SyntheticPairPage />} />
          <Route path="/custom-index" element={<CustomIndexPage />} />
          <Route path="/superema" element={<SuperEMAPage />} />
          <Route path="/liquidations" element={<LiquidationsPage />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
