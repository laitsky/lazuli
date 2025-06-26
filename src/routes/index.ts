import { Router } from 'express';
import { exchangeController } from '../controllers/exchangeController';
import { tickerController } from '../controllers/tickerController';

// Create Express router for API v1 endpoints
const router = Router();

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

export default router;