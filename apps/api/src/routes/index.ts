import { Router, type Router as RouterType } from 'express';
import { exchangeController } from '../controllers/exchangeController';
import { tickerController } from '../controllers/tickerController';
import { dataController } from '../controllers/dataController';
import { docsController } from '../controllers/docsController';
import { ohlcvController } from '../controllers/ohlcvController';
import { customPairController } from '../controllers/customPairController';
import { customIndexController } from '../controllers/customIndexController';
import { superEmaController } from '../controllers/superEmaController';
import { screenerController } from '../controllers/screenerController';
import { fundingRateController } from '../controllers/fundingRateController';
import { technicalIndicatorController } from '../controllers/technicalIndicatorController';

// Create Express router for API v1 endpoints
const router: RouterType = Router();

// GET /api/v1/exchanges - List all supported exchanges
router.get('/exchanges', async (req, res) => {
  await exchangeController.listExchanges(req, res);
});

// GET /api/v1/tickers/:exchange - Get all tickers for an exchange
router.get('/tickers/:exchange', async (req, res) => {
  await tickerController.getAllTickers(req, res);
});

// GET /api/v1/tickers/:exchange/:symbol - Get specific ticker data
router.get('/tickers/:exchange/:symbol', async (req, res) => {
  await tickerController.getTicker(req, res);
});

// GET /api/v1/markets/:exchange - Get all markets for an exchange
router.get('/markets/:exchange', async (req, res) => {
  await tickerController.getMarkets(req, res);
});

// GET /api/v1/ohlcv/timeframes/:exchange - Get supported timeframes for an exchange
router.get('/ohlcv/timeframes/:exchange', async (req, res) => {
  await ohlcvController.getSupportedTimeframes(req, res);
});

// GET /api/v1/ohlcv/multi/:exchange/:symbol - Get OHLCV data for multiple timeframes
router.get('/ohlcv/multi/:exchange/:symbol', async (req, res) => {
  await ohlcvController.getMultiTimeframeOHLCV(req, res);
});

// GET /api/v1/ohlcv/:exchange/:symbol - Get OHLCV (candlestick) data for a symbol
router.get('/ohlcv/:exchange/:symbol', async (req, res) => {
  await ohlcvController.getOHLCV(req, res);
});

// GET /api/v1/custom-pair/:exchange/:symbol1/:symbol2 - Generate custom pair by dividing two ticker prices
router.get('/custom-pair/:exchange/:symbol1/:symbol2', async (req, res) => {
  await customPairController.getCustomPair(req, res);
});

// POST /api/v1/custom-index - Calculate custom index performance with weighted assets
router.post('/custom-index', async (req, res) => {
  await customIndexController.calculateIndex(req, res);
});

// GET /api/v1/superema/:exchange/:symbol - Get SuperEMA data (1-400 EMA periods)
router.get('/superema/:exchange/:symbol', async (req, res) => {
  await superEmaController.getSuperEMA(req, res);
});

// GET /api/v1/indicators/:exchange/:symbol - Get technical indicators (SMA, EMA, RSI)
router.get('/indicators/:exchange/:symbol', async (req, res) => {
  await technicalIndicatorController.getIndicators(req, res);
});

// GET /api/v1/screener/:exchange - Get all altcoins with performance data for Alt Screener
router.get('/screener/:exchange', async (req, res) => {
  await screenerController.getAltcoins(req, res);
});

// GET /api/v1/screener/:exchange/stats - Get quick stats for Alt Screener
router.get('/screener/:exchange/stats', async (req, res) => {
  await screenerController.getStats(req, res);
});

// GET /api/v1/funding/compare - Get cross-exchange funding rate comparison
// Must be before :exchange route to avoid matching "compare" as an exchange
router.get('/funding/compare', async (req, res) => {
  await fundingRateController.getCrossExchangeFunding(req, res);
});

// GET /api/v1/funding/:exchange - Get funding rates for all perpetual contracts
router.get('/funding/:exchange', async (req, res) => {
  await fundingRateController.getFundingRates(req, res);
});

// POST /api/v1/data/store/:exchange - Store live ticker data for an exchange
router.post('/data/store/:exchange', async (req, res) => {
  await dataController.storeLiveTickers(req, res);
});

// GET /api/v1/data/history/:symbol - Get historical ticker data for a symbol
router.get('/data/history/:symbol', async (req, res) => {
  await dataController.getHistoricalTickers(req, res);
});

// GET /api/v1/data/latest/:exchange/:symbol - Get latest stored ticker
router.get('/data/latest/:exchange/:symbol', async (req, res) => {
  await dataController.getLatestStoredTicker(req, res);
});

// POST /api/v1/data/markets/:exchange - Store market data for an exchange
router.post('/data/markets/:exchange', async (req, res) => {
  await dataController.storeMarkets(req, res);
});

// DELETE /api/v1/data/cleanup - Clean up old ticker data
router.delete('/data/cleanup', async (req, res) => {
  await dataController.cleanupOldData(req, res);
});

// GET /api/v1/docs - Serve interactive API documentation
router.get('/docs', async (req, res) => {
  await docsController.serveDocs(req, res);
});

// GET /api/v1/docs/spec - Serve OpenAPI specification
router.get('/docs/spec', async (req, res) => {
  await docsController.serveApiSpec(req, res);
});

// GET /api/v1/docs/info - Get documentation metadata
router.get('/docs/info', async (req, res) => {
  await docsController.getDocsInfo(req, res);
});

export default router;
