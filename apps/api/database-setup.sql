-- Lazuli Database Setup Script
-- Copy and paste this entire script into your Supabase SQL Editor
-- This will create all the tables needed for Lazuli

-- 1. Create tickers table for storing historical ticker data
CREATE TABLE IF NOT EXISTS tickers (
  id BIGSERIAL PRIMARY KEY,
  symbol VARCHAR(50) NOT NULL,
  exchange VARCHAR(20) NOT NULL,
  type VARCHAR(10) NOT NULL CHECK (type IN ('spot', 'perp')),
  bid DECIMAL(20,8),
  ask DECIMAL(20,8),
  last DECIMAL(20,8),
  high24h DECIMAL(20,8),
  low24h DECIMAL(20,8),
  volume24h DECIMAL(20,8),
  quote_volume24h DECIMAL(20,8),
  change24h DECIMAL(20,8),
  percentage24h DECIMAL(10,4),
  funding_rate DECIMAL(10,6),
  open_interest DECIMAL(20,8),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Create index for efficient queries on tickers
CREATE INDEX IF NOT EXISTS idx_tickers_symbol_exchange_time 
ON tickers (symbol, exchange, created_at DESC);

-- 3. Create markets table for storing market information
CREATE TABLE IF NOT EXISTS markets (
  id VARCHAR(100) PRIMARY KEY,
  symbol VARCHAR(50) NOT NULL,
  base VARCHAR(20) NOT NULL,
  quote VARCHAR(20) NOT NULL,
  type VARCHAR(10) NOT NULL CHECK (type IN ('spot', 'perp')),
  active BOOLEAN DEFAULT true,
  exchange VARCHAR(20) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(symbol, exchange, type)
);

-- 4. Create price_alerts table for user alerts
CREATE TABLE IF NOT EXISTS price_alerts (
  id BIGSERIAL PRIMARY KEY,
  symbol VARCHAR(50) NOT NULL,
  exchange VARCHAR(20) NOT NULL,
  price_target DECIMAL(20,8) NOT NULL,
  condition VARCHAR(10) NOT NULL CHECK (condition IN ('above', 'below')),
  active BOOLEAN DEFAULT true,
  triggered_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Create arbitrage_opportunities table
CREATE TABLE IF NOT EXISTS arbitrage_opportunities (
  id BIGSERIAL PRIMARY KEY,
  symbol VARCHAR(50) NOT NULL,
  buy_exchange VARCHAR(20) NOT NULL,
  sell_exchange VARCHAR(20) NOT NULL,
  buy_price DECIMAL(20,8) NOT NULL,
  sell_price DECIMAL(20,8) NOT NULL,
  profit_percentage DECIMAL(10,4) NOT NULL,
  detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- 7. Create triggers for auto-updating timestamps
DROP TRIGGER IF EXISTS update_tickers_updated_at ON tickers;
CREATE TRIGGER update_tickers_updated_at
  BEFORE UPDATE ON tickers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_markets_updated_at ON markets;
CREATE TRIGGER update_markets_updated_at
  BEFORE UPDATE ON markets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_price_alerts_updated_at ON price_alerts;
CREATE TRIGGER update_price_alerts_updated_at
  BEFORE UPDATE ON price_alerts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 8. Enable Row Level Security (RLS) for security
ALTER TABLE tickers ENABLE ROW LEVEL SECURITY;
ALTER TABLE markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE arbitrage_opportunities ENABLE ROW LEVEL SECURITY;

-- 9. Create policies to allow public read access (adjust as needed)
CREATE POLICY "Public read access" ON tickers FOR SELECT USING (true);
CREATE POLICY "Public read access" ON markets FOR SELECT USING (true);
CREATE POLICY "Public read access" ON price_alerts FOR SELECT USING (true);
CREATE POLICY "Public read access" ON arbitrage_opportunities FOR SELECT USING (true);

-- 10. Create policies to allow service role to insert/update
CREATE POLICY "Service role full access" ON tickers FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON markets FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON price_alerts FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON arbitrage_opportunities FOR ALL USING (auth.role() = 'service_role');

-- 11. Create a view for latest tickers (optional, for easier queries)
CREATE OR REPLACE VIEW latest_tickers AS
SELECT DISTINCT ON (symbol, exchange, type) 
  *
FROM tickers
ORDER BY symbol, exchange, type, created_at DESC;

-- Setup complete!
-- You can now use the Lazuli API to store and retrieve trading data.