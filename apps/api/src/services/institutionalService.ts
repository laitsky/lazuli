import type {
  ConfluenceSignal,
  EtfDailyFlow,
  EtfFlowResponse,
  EtfFlowStreak,
  EtfFund,
  EtfFundsResponse,
  FundingRateData,
  InstitutionalAsset,
  InstitutionalConfluenceResponse,
  InstitutionalOverviewResponse,
  InstitutionalProviderStatus,
  InstitutionalRange,
  OptionExpirySummary,
  OptionInstrument,
  OptionsChainResponse,
  OptionsExpiriesResponse,
  OptionsVolatilityResponse,
  OptionStrikeSummary,
  SupportedExchange,
  Ticker,
  VolatilityCandle,
} from '@lazuli/shared';
import type { Env } from '../types';

const FARSIDE_URLS: Record<InstitutionalAsset, string> = {
  BTC: 'https://farside.co.uk/bitcoin-etf-flow-all-data/',
  ETH: 'https://farside.co.uk/eth/',
};

const DERIBIT_BASE_URL = 'https://www.deribit.com/api/v2';
const DAY_MS = 24 * 60 * 60 * 1000;

const ETF_FUNDS: Record<
  InstitutionalAsset,
  Array<Omit<EtfFund, 'cumulativeFlowUsd' | 'latestFlowUsd'>>
> = {
  BTC: [
    {
      ticker: 'IBIT',
      name: 'iShares Bitcoin Trust',
      issuer: 'BlackRock',
      asset: 'BTC',
      category: 'spot',
      firstSeen: '2024-01-11',
    },
    {
      ticker: 'FBTC',
      name: 'Fidelity Wise Origin Bitcoin Fund',
      issuer: 'Fidelity',
      asset: 'BTC',
      category: 'spot',
      firstSeen: '2024-01-11',
    },
    {
      ticker: 'GBTC',
      name: 'Grayscale Bitcoin Trust',
      issuer: 'Grayscale',
      asset: 'BTC',
      category: 'spot',
      firstSeen: '2024-01-11',
    },
    {
      ticker: 'ARKB',
      name: 'ARK 21Shares Bitcoin ETF',
      issuer: 'ARK/21Shares',
      asset: 'BTC',
      category: 'spot',
      firstSeen: '2024-01-11',
    },
    {
      ticker: 'BITB',
      name: 'Bitwise Bitcoin ETF',
      issuer: 'Bitwise',
      asset: 'BTC',
      category: 'spot',
      firstSeen: '2024-01-11',
    },
    {
      ticker: 'HODL',
      name: 'VanEck Bitcoin Trust',
      issuer: 'VanEck',
      asset: 'BTC',
      category: 'spot',
      firstSeen: '2024-01-11',
    },
    {
      ticker: 'BTCO',
      name: 'Invesco Galaxy Bitcoin ETF',
      issuer: 'Invesco/Galaxy',
      asset: 'BTC',
      category: 'spot',
      firstSeen: '2024-01-11',
    },
    {
      ticker: 'EZBC',
      name: 'Franklin Bitcoin ETF',
      issuer: 'Franklin Templeton',
      asset: 'BTC',
      category: 'spot',
      firstSeen: '2024-01-11',
    },
  ],
  ETH: [
    {
      ticker: 'ETHA',
      name: 'iShares Ethereum Trust ETF',
      issuer: 'BlackRock',
      asset: 'ETH',
      category: 'spot',
      firstSeen: '2024-07-23',
    },
    {
      ticker: 'FETH',
      name: 'Fidelity Ethereum Fund',
      issuer: 'Fidelity',
      asset: 'ETH',
      category: 'spot',
      firstSeen: '2024-07-23',
    },
    {
      ticker: 'ETHE',
      name: 'Grayscale Ethereum Trust',
      issuer: 'Grayscale',
      asset: 'ETH',
      category: 'spot',
      firstSeen: '2024-07-23',
    },
    {
      ticker: 'ETH',
      name: 'Grayscale Ethereum Mini Trust',
      issuer: 'Grayscale',
      asset: 'ETH',
      category: 'spot',
      firstSeen: '2024-07-23',
    },
    {
      ticker: 'ETHW',
      name: 'Bitwise Ethereum ETF',
      issuer: 'Bitwise',
      asset: 'ETH',
      category: 'spot',
      firstSeen: '2024-07-23',
    },
    {
      ticker: 'CETH',
      name: '21Shares Core Ethereum ETF',
      issuer: '21Shares',
      asset: 'ETH',
      category: 'spot',
      firstSeen: '2024-07-23',
    },
    {
      ticker: 'ETHV',
      name: 'VanEck Ethereum ETF',
      issuer: 'VanEck',
      asset: 'ETH',
      category: 'spot',
      firstSeen: '2024-07-23',
    },
  ],
};

interface DeribitBookSummary {
  instrument_name?: string;
  open_interest?: number;
  volume?: number;
  volume_usd?: number;
  bid_price?: number | null;
  ask_price?: number | null;
  mark_price?: number | null;
  underlying_price?: number | null;
  mark_iv?: number | null;
  underlying_index?: string;
}

interface CachedInstitutional<T> {
  data: T;
  updatedAt: number;
}

const memoryCache = new Map<string, CachedInstitutional<unknown>>();

/**
 * Loads ETF flows from a public Farside-style HTML table and falls back to a
 * deterministic sample series when the source is unavailable. The response
 * shape stays stable so the UI can degrade panel-by-panel.
 */
export async function getEtfFlows(
  asset: InstitutionalAsset,
  range: InstitutionalRange,
  env?: Env
): Promise<EtfFlowResponse> {
  const cacheKey = `etf:${asset}:${range}`;
  const cached = getCached<EtfFlowResponse>(cacheKey, 30 * 60 * 1000);
  if (cached) return cached;

  const snapshotKey = `institutional/etf/${asset}.json`;
  const providerBase = { provider: 'Farside Investors', updatedAt: Date.now() };
  let provider: InstitutionalProviderStatus;
  let flows: EtfDailyFlow[];

  try {
    const html = await fetchText(FARSIDE_URLS[asset], 12_000);
    flows = parseFarsideTable(asset, html);
    if (flows.length < 2) throw new Error('No parseable ETF flow table found');
    provider = { ...providerBase, source: 'live', ok: true, stale: false };
    await writeSnapshot(env, snapshotKey, flows);
  } catch (error) {
    const snapshot = await readSnapshot<EtfDailyFlow[]>(env, snapshotKey);
    if (snapshot?.length) {
      flows = snapshot;
      provider = {
        ...providerBase,
        source: 'snapshot',
        ok: true,
        stale: true,
        message: error instanceof Error ? error.message : String(error),
      };
    } else {
      flows = buildFallbackEtfFlows(asset);
      provider = {
        ...providerBase,
        source: 'fallback',
        ok: false,
        stale: true,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const filtered = filterFlowsByRange(flows, range);
  const funds = buildEtfFunds(asset, filtered);
  const response: EtfFlowResponse = {
    asset,
    range,
    flows: filtered,
    funds,
    latest: filtered[filtered.length - 1] ?? null,
    streak: buildFlowStreak(filtered),
    totals: buildFlowTotals(filtered),
    provider,
    timestamp: Date.now(),
  };
  setCached(cacheKey, response);
  return response;
}

/**
 * Returns ETF fund-level metadata and aggregate flow leadership.
 */
export async function getEtfFunds(asset: InstitutionalAsset, env?: Env): Promise<EtfFundsResponse> {
  const flows = await getEtfFlows(asset, 'all', env);
  return {
    asset,
    funds: flows.funds,
    provider: flows.provider,
    timestamp: Date.now(),
  };
}

/**
 * Loads normalized Deribit options data and aggregates it into expiries.
 */
export async function getOptionsExpiries(
  asset: InstitutionalAsset
): Promise<OptionsExpiriesResponse> {
  const options = await getOptionsDataset(asset);
  return {
    asset,
    expiries: options.expiries,
    provider: options.provider,
    timestamp: Date.now(),
  };
}

/**
 * Returns the option chain for a selected expiry, defaulting to the nearest
 * liquid expiry when none is supplied.
 */
export async function getOptionsChain(
  asset: InstitutionalAsset,
  expiry?: string
): Promise<OptionsChainResponse> {
  const options = await getOptionsDataset(asset);
  const selectedExpiry = expiry ?? options.expiries[0]?.expiry ?? null;
  const chain = selectedExpiry
    ? options.chain.filter((instrument) => instrument.expiry === selectedExpiry)
    : options.chain;

  return {
    asset,
    expiry: selectedExpiry,
    expiries: options.expiries,
    chain,
    strikes: buildStrikeSummaries(chain),
    provider: options.provider,
    timestamp: Date.now(),
  };
}

/**
 * Loads Deribit volatility index candles for BTC or ETH.
 */
export async function getOptionsVolatility(
  asset: InstitutionalAsset,
  range: InstitutionalRange
): Promise<OptionsVolatilityResponse> {
  const cacheKey = `volatility:${asset}:${range}`;
  const cached = getCached<OptionsVolatilityResponse>(cacheKey, 60 * 1000);
  if (cached) return cached;

  const providerBase = { provider: 'Deribit', updatedAt: Date.now() };
  let provider: InstitutionalProviderStatus;
  let candles: VolatilityCandle[];

  try {
    const now = Date.now();
    const start = rangeStartTimestamp(range, now);
    const resolution = range === '30d' ? '60' : '1D';
    const payload = await deribitFetchWithRetry<unknown>(
      '/public/get_volatility_index_data',
      {
        currency: asset,
        start_timestamp: String(start),
        end_timestamp: String(now),
        resolution,
      },
      {
        currency: asset,
        start_timestamp: String(start),
        end_timestamp: String(now),
        vix_resolution: resolution,
      }
    );
    candles = parseVolatilityCandles(payload);
    if (candles.length === 0) throw new Error('No volatility candles returned');
    provider = { ...providerBase, source: 'live', ok: true, stale: false };
  } catch (error) {
    candles = buildFallbackVolatility(asset, range);
    provider = {
      ...providerBase,
      source: 'fallback',
      ok: false,
      stale: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const closes = candles.map((candle) => candle.close);
  const current = closes[closes.length - 1] ?? null;
  const response: OptionsVolatilityResponse = {
    asset,
    range,
    candles,
    current,
    rank: current === null ? null : percentileRank(closes, current),
    provider,
    timestamp: Date.now(),
  };
  setCached(cacheKey, response);
  return response;
}

/**
 * Combines ETF, options, funding, and spot trend into transparent regime
 * signals. Each score is intentionally simple and explainable.
 */
export async function getInstitutionalConfluence(params: {
  asset: InstitutionalAsset;
  etf?: EtfFlowResponse;
  options?: OptionsExpiriesResponse;
  volatility?: OptionsVolatilityResponse;
  fundingRates?: FundingRateData[];
  spotTicker?: Ticker | null;
}): Promise<InstitutionalConfluenceResponse> {
  const [etf, options, volatility] = await Promise.all([
    params.etf ?? getEtfFlows(params.asset, '30d'),
    params.options ?? getOptionsExpiries(params.asset),
    params.volatility ?? getOptionsVolatility(params.asset, '90d'),
  ]);
  const fundingRates = params.fundingRates ?? [];
  const spotTicker = params.spotTicker ?? null;
  const nearest = options.expiries[0] ?? null;
  const totalOi = fundingRates.reduce((sum, item) => sum + (item.openInterest ?? 0), 0);
  const avgFunding = average(fundingRates.map((item) => item.fundingRatePercent));
  const signals: ConfluenceSignal[] = [
    buildEtfSignal(etf),
    buildOptionsSkewSignal(nearest, volatility),
    buildPerpLeverageSignal(avgFunding, totalOi),
    buildBasisStressSignal(fundingRates),
    buildSpotTrendSignal(spotTicker),
    buildLiquidityRiskSignal(nearest, spotTicker),
  ];
  const score = clamp(Math.round(average(signals.map((signal) => signal.score)) ?? 50), 0, 100);
  const regime = classifyRegime(signals, score);
  const response: InstitutionalConfluenceResponse = {
    asset: params.asset,
    regime,
    regimeScore: score,
    confidence: Math.round(
      (signals.filter((signal) => signal.fresh).length / signals.length) * 100
    ),
    summary: summarizeRegime(params.asset, regime, score),
    signals,
    providers: [etf.provider, options.provider, volatility.provider],
    timestamp: Date.now(),
  };
  return response;
}

/**
 * Builds the Flow & Vol Radar overview response.
 */
export async function getInstitutionalOverview(params: {
  asset: InstitutionalAsset;
  env?: Env;
  fundingRates?: FundingRateData[];
  spotTicker?: Ticker | null;
  sourceExchange?: SupportedExchange;
}): Promise<InstitutionalOverviewResponse> {
  const sourceExchange = params.sourceExchange ?? 'bybit';
  const [etf, options, volatility] = await Promise.all([
    getEtfFlows(params.asset, '30d', params.env),
    getOptionsExpiries(params.asset),
    getOptionsVolatility(params.asset, '90d'),
  ]);
  const confluence = await getInstitutionalConfluence({
    asset: params.asset,
    etf,
    options,
    volatility,
    fundingRates: params.fundingRates ?? [],
    spotTicker: params.spotTicker ?? null,
  });
  const nearest = options.expiries[0] ?? null;
  const largestExpiryWall =
    nearest && nearest.largestCallWall && nearest.largestPutWall
      ? nearest.largestCallWall.totalOpenInterest >= nearest.largestPutWall.totalOpenInterest
        ? nearest.largestCallWall
        : nearest.largestPutWall
      : (nearest?.largestCallWall ?? nearest?.largestPutWall ?? null);
  const avgFundingRate = average(
    (params.fundingRates ?? []).map((item) => item.fundingRatePercent)
  );
  const totalOpenInterestUsd = (params.fundingRates ?? []).reduce(
    (sum, item) => sum + (item.openInterest ?? 0),
    0
  );

  return {
    asset: params.asset,
    price: {
      spot: params.spotTicker?.last ?? null,
      change24h: params.spotTicker?.percentage24h ?? null,
      sourceExchange,
    },
    etf: {
      latestFlowUsd: etf.latest?.totalNetFlowUsd ?? null,
      cumulativeFlowUsd: etf.latest?.cumulativeNetFlowUsd ?? null,
      streak: etf.streak,
    },
    options: {
      currentIv: volatility.current,
      ivRank: volatility.rank,
      skew25Delta: nearest?.skew25Delta ?? null,
      nearestExpiry: nearest,
      largestExpiryWall,
    },
    derivatives: {
      avgFundingRate,
      totalOpenInterestUsd,
      fundingPressure:
        Math.abs(avgFundingRate ?? 0) < 0.002
          ? 'neutral'
          : (avgFundingRate ?? 0) > 0
            ? 'longs-pay'
            : 'shorts-pay',
    },
    confluence,
    providers: confluence.providers,
    timestamp: Date.now(),
  };
}

async function getOptionsDataset(asset: InstitutionalAsset): Promise<{
  chain: OptionInstrument[];
  expiries: OptionExpirySummary[];
  provider: InstitutionalProviderStatus;
}> {
  const cacheKey = `options:${asset}`;
  const cached = getCached<{
    chain: OptionInstrument[];
    expiries: OptionExpirySummary[];
    provider: InstitutionalProviderStatus;
  }>(cacheKey, 60 * 1000);
  if (cached) return cached;

  const providerBase = { provider: 'Deribit', updatedAt: Date.now() };
  let chain: OptionInstrument[];
  let provider: InstitutionalProviderStatus;

  try {
    const summaries = await deribitFetch<DeribitBookSummary[]>(
      '/public/get_book_summary_by_currency',
      {
        currency: asset,
        kind: 'option',
      }
    );
    chain = summaries.flatMap((summary) => normalizeOptionSummary(asset, summary));
    if (chain.length === 0) throw new Error('No options returned by Deribit');
    provider = { ...providerBase, source: 'live', ok: true, stale: false };
  } catch (error) {
    chain = buildFallbackOptions(asset);
    provider = {
      ...providerBase,
      source: 'fallback',
      ok: false,
      stale: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const expiries = buildExpirySummaries(chain);
  const result = { chain, expiries, provider };
  setCached(cacheKey, result);
  return result;
}

async function deribitFetch<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${DERIBIT_BASE_URL}${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetchWithTimeout(url.toString(), 12_000);
  if (!response.ok) throw new Error(`Deribit ${response.status}`);
  const payload = (await response.json()) as { result?: T; error?: { message?: string } };
  if (payload.error) throw new Error(payload.error.message ?? 'Deribit API error');
  if (payload.result === undefined) throw new Error('Deribit response missing result');
  return payload.result;
}

async function deribitFetchWithRetry<T>(
  path: string,
  primaryParams: Record<string, string>,
  fallbackParams: Record<string, string>
): Promise<T> {
  try {
    return await deribitFetch<T>(path, primaryParams);
  } catch (primaryError) {
    try {
      return await deribitFetch<T>(path, fallbackParams);
    } catch (fallbackError) {
      throw new Error(
        `${primaryError instanceof Error ? primaryError.message : String(primaryError)}; retry failed: ${
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        }`
      );
    }
  }
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const response = await fetchWithTimeout(url, timeoutMs);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
        'user-agent': 'LazuliInstitutionalIntelligence/1.0',
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function parseFarsideTable(asset: InstitutionalAsset, html: string): EtfDailyFlow[] {
  const rowMatches = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  const rows = rowMatches
    .map((row) =>
      (row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []).map((cell) =>
        decodeHtml(stripTags(cell)).trim()
      )
    )
    .filter((cells) => cells.length >= 3);
  const header = rows.find((cells) => cells.some((cell) => /^date$/i.test(cell)));
  if (!header) return [];
  const headerIndex = rows.indexOf(header);
  const tickers = header
    .slice(1)
    .map((cell) => cell.replace(/\s+/g, ' ').trim())
    .filter((cell) => cell && !/total|price|assets|flow/i.test(cell));

  const rawFlows = rows
    .slice(headerIndex + 1)
    .flatMap((cells): Array<Omit<EtfDailyFlow, 'cumulativeNetFlowUsd' | 'anomaly'>> => {
      const date = normalizeDate(cells[0] ?? '');
      if (!date) return [];
      const fundFlows: Record<string, number | null> = {};
      tickers.forEach((ticker, index) => {
        fundFlows[ticker] = parseMoneyMillions(cells[index + 1] ?? '');
      });
      const fundValues = Object.values(fundFlows).filter(
        (value): value is number => value !== null
      );
      if (fundValues.length === 0) return [];
      const explicitTotal = cells
        .map((cell, index) => ({ cell, index }))
        .find((item) => /total/i.test(header[item.index] ?? ''));
      const totalNetFlowUsd =
        parseMoneyMillions(explicitTotal?.cell ?? '') ??
        fundValues.reduce((sum, value) => sum + value, 0);
      const entries = Object.entries(fundFlows).filter(
        (entry): entry is [string, number] => entry[1] !== null
      );
      const leaderTicker = entries.sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const laggardTicker = entries.sort((a, b) => a[1] - b[1])[0]?.[0] ?? null;
      return [
        {
          date,
          asset,
          totalNetFlowUsd,
          fundFlows,
          leaderTicker,
          laggardTicker,
        },
      ];
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  let cumulative = 0;
  return rawFlows.map((flow, index, all) => {
    cumulative += flow.totalNetFlowUsd;
    return {
      ...flow,
      cumulativeNetFlowUsd: cumulative,
      anomaly: isFlowAnomaly(
        flow.totalNetFlowUsd,
        all.slice(0, index + 1).map((item) => item.totalNetFlowUsd)
      ),
    };
  });
}

function normalizeOptionSummary(
  asset: InstitutionalAsset,
  summary: DeribitBookSummary
): OptionInstrument[] {
  const instrumentName = summary.instrument_name;
  if (!instrumentName) return [];
  const parsed = parseDeribitOptionName(instrumentName);
  if (!parsed || parsed.asset !== asset) return [];
  const greeks = calculateBlackScholesGreeks({
    spot: finiteOrNull(summary.underlying_price),
    strike: parsed.strike,
    expiryTimestamp: parsed.expiryTimestamp,
    optionType: parsed.optionType,
    impliedVolatility: finiteOrNull(summary.mark_iv),
  });
  return [
    {
      instrumentName,
      asset,
      expiry: parsed.expiry,
      expiryTimestamp: parsed.expiryTimestamp,
      strike: parsed.strike,
      optionType: parsed.optionType,
      bid: finiteOrNull(summary.bid_price),
      ask: finiteOrNull(summary.ask_price),
      markPrice: finiteOrNull(summary.mark_price),
      underlyingPrice: finiteOrNull(summary.underlying_price),
      openInterest: finiteOrZero(summary.open_interest),
      volume24h: finiteOrZero(summary.volume_usd ?? summary.volume),
      impliedVolatility: finiteOrNull(summary.mark_iv),
      delta: greeks.delta,
      gamma: greeks.gamma,
      theta: greeks.theta,
      vega: greeks.vega,
    },
  ];
}

export function parseDeribitOptionName(name: string): {
  asset: InstitutionalAsset;
  expiry: string;
  expiryTimestamp: number;
  strike: number;
  optionType: 'call' | 'put';
} | null {
  const match = name.match(/^(BTC|ETH)-(\d{1,2}[A-Z]{3}\d{2})-(\d+(?:\.\d+)?)-([CP])$/);
  if (!match) return null;
  const asset = match[1] as InstitutionalAsset;
  const expiryTimestamp = parseDeribitExpiry(match[2]!);
  if (!expiryTimestamp) return null;
  return {
    asset,
    expiry: new Date(expiryTimestamp).toISOString().slice(0, 10),
    expiryTimestamp,
    strike: Number(match[3]),
    optionType: match[4] === 'C' ? 'call' : 'put',
  };
}

function parseDeribitExpiry(value: string): number | null {
  const match = value.match(/^(\d{1,2})([A-Z]{3})(\d{2})$/);
  if (!match) return null;
  const month = [
    'JAN',
    'FEB',
    'MAR',
    'APR',
    'MAY',
    'JUN',
    'JUL',
    'AUG',
    'SEP',
    'OCT',
    'NOV',
    'DEC',
  ].indexOf(match[2]!);
  if (month < 0) return null;
  return Date.UTC(2000 + Number(match[3]), month, Number(match[1]), 8, 0, 0);
}

function buildExpirySummaries(chain: OptionInstrument[]): OptionExpirySummary[] {
  const byExpiry = groupBy(chain, (instrument) => instrument.expiry);
  return Object.entries(byExpiry)
    .map(([expiry, instruments]) => {
      const strikes = buildStrikeSummaries(instruments);
      const callOpenInterest = instruments
        .filter((instrument) => instrument.optionType === 'call')
        .reduce((sum, item) => sum + item.openInterest, 0);
      const putOpenInterest = instruments
        .filter((instrument) => instrument.optionType === 'put')
        .reduce((sum, item) => sum + item.openInterest, 0);
      const totalOpenInterest = callOpenInterest + putOpenInterest;
      const spot = median(
        instruments.map((instrument) => instrument.underlyingPrice).filter(isNumber)
      );
      return {
        expiry,
        expiryTimestamp: instruments[0]?.expiryTimestamp ?? Date.parse(expiry),
        daysToExpiry: Math.max(
          0,
          Math.ceil(((instruments[0]?.expiryTimestamp ?? Date.now()) - Date.now()) / DAY_MS)
        ),
        instrumentCount: instruments.length,
        totalOpenInterest,
        totalVolume24h: instruments.reduce((sum, item) => sum + item.volume24h, 0),
        callOpenInterest,
        putOpenInterest,
        putCallRatio: callOpenInterest > 0 ? putOpenInterest / callOpenInterest : 0,
        maxPainStrike: estimateMaxPain(strikes, spot),
        largestCallWall: maxBy(strikes, (strike) => strike.callOpenInterest),
        largestPutWall: maxBy(strikes, (strike) => strike.putOpenInterest),
        atmImpliedVolatility: estimateAtmIv(instruments, spot),
        skew25Delta: estimateSkew(instruments, spot),
      };
    })
    .sort((a, b) => a.expiryTimestamp - b.expiryTimestamp);
}

function buildStrikeSummaries(chain: OptionInstrument[]): OptionStrikeSummary[] {
  const byStrike = groupBy(chain, (instrument) => String(instrument.strike));
  return Object.entries(byStrike)
    .map(([strike, instruments]) => {
      const calls = instruments.filter((instrument) => instrument.optionType === 'call');
      const puts = instruments.filter((instrument) => instrument.optionType === 'put');
      const callOpenInterest = calls.reduce((sum, item) => sum + item.openInterest, 0);
      const putOpenInterest = puts.reduce((sum, item) => sum + item.openInterest, 0);
      return {
        strike: Number(strike),
        callOpenInterest,
        putOpenInterest,
        totalOpenInterest: callOpenInterest + putOpenInterest,
        callVolume24h: calls.reduce((sum, item) => sum + item.volume24h, 0),
        putVolume24h: puts.reduce((sum, item) => sum + item.volume24h, 0),
        netCallPutOpenInterest: callOpenInterest - putOpenInterest,
      };
    })
    .sort((a, b) => a.strike - b.strike);
}

export function parseVolatilityCandles(payload: unknown): VolatilityCandle[] {
  const source =
    typeof payload === 'object' && payload !== null && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload;
  const rows = Array.isArray(source) ? source : [];
  return rows.flatMap((row): VolatilityCandle[] => {
    if (Array.isArray(row) && row.length >= 5) {
      return [
        {
          timestamp: Number(row[0]),
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
        },
      ];
    }
    if (typeof row === 'object' && row !== null) {
      const item = row as Record<string, unknown>;
      return [
        {
          timestamp: Number(item.timestamp ?? item.time ?? item.ticks),
          open: Number(item.open),
          high: Number(item.high),
          low: Number(item.low),
          close: Number(item.close),
        },
      ].filter((candle) => Object.values(candle).every(Number.isFinite));
    }
    return [];
  });
}

function buildEtfFunds(asset: InstitutionalAsset, flows: EtfDailyFlow[]): EtfFund[] {
  const known = ETF_FUNDS[asset];
  const tickers = Array.from(
    new Set([
      ...known.map((fund) => fund.ticker),
      ...flows.flatMap((flow) => Object.keys(flow.fundFlows)),
    ])
  );
  return tickers
    .map((ticker) => {
      const base = known.find((fund) => fund.ticker === ticker) ?? {
        ticker,
        name: `${ticker} ${asset} ETF`,
        issuer: 'Unknown',
        asset,
        category: 'spot' as const,
        firstSeen: null,
      };
      const values = flows
        .map((flow) => flow.fundFlows[ticker])
        .filter((value): value is number => value !== null);
      return {
        ...base,
        cumulativeFlowUsd: values.reduce((sum, value) => sum + value, 0),
        latestFlowUsd: values[values.length - 1] ?? null,
      };
    })
    .sort((a, b) => Math.abs(b.cumulativeFlowUsd) - Math.abs(a.cumulativeFlowUsd));
}

function filterFlowsByRange(flows: EtfDailyFlow[], range: InstitutionalRange): EtfDailyFlow[] {
  if (range === 'all') return flows;
  const now = new Date();
  const cutoff =
    range === 'ytd'
      ? Date.UTC(now.getUTCFullYear(), 0, 1)
      : Date.now() - (range === '30d' ? 30 : 90) * DAY_MS;
  return flows.filter((flow) => Date.parse(flow.date) >= cutoff);
}

export function buildFlowStreak(flows: EtfDailyFlow[]): EtfFlowStreak {
  const latest = [...flows].reverse();
  const first = latest[0];
  if (!first) return { direction: 'flat', days: 0, totalUsd: 0, averageUsd: 0 };
  const direction =
    first.totalNetFlowUsd > 0 ? 'inflow' : first.totalNetFlowUsd < 0 ? 'outflow' : 'flat';
  const streak: EtfDailyFlow[] = [];
  for (const flow of latest) {
    const matches =
      direction === 'flat'
        ? Math.abs(flow.totalNetFlowUsd) < 1
        : direction === 'inflow'
          ? flow.totalNetFlowUsd > 0
          : flow.totalNetFlowUsd < 0;
    if (!matches) break;
    streak.push(flow);
  }
  const totalUsd = streak.reduce((sum, flow) => sum + flow.totalNetFlowUsd, 0);
  return {
    direction,
    days: streak.length,
    totalUsd,
    averageUsd: streak.length > 0 ? totalUsd / streak.length : 0,
  };
}

function buildFlowTotals(flows: EtfDailyFlow[]): EtfFlowResponse['totals'] {
  const netFlowUsd = flows.reduce((sum, flow) => sum + flow.totalNetFlowUsd, 0);
  return {
    netFlowUsd,
    cumulativeNetFlowUsd: flows[flows.length - 1]?.cumulativeNetFlowUsd ?? 0,
    averageDailyFlowUsd: flows.length > 0 ? netFlowUsd / flows.length : 0,
    positiveDays: flows.filter((flow) => flow.totalNetFlowUsd > 0).length,
    negativeDays: flows.filter((flow) => flow.totalNetFlowUsd < 0).length,
    anomalyDays: flows.filter((flow) => flow.anomaly).length,
  };
}

function buildEtfSignal(etf: EtfFlowResponse): ConfluenceSignal {
  const latest = etf.latest?.totalNetFlowUsd ?? 0;
  const score = clamp(
    50 + latest / 20_000_000 + etf.streak.days * (etf.streak.direction === 'inflow' ? 4 : -4),
    0,
    100
  );
  return {
    id: 'etfDemand',
    label: 'ETF demand',
    score: Math.round(score),
    direction: score > 58 ? 'bullish' : score < 42 ? 'bearish' : 'neutral',
    value: formatUsd(latest),
    explanation: `${etf.streak.days} day ${etf.streak.direction} streak across spot ETF products.`,
    fresh: !etf.provider.stale,
  };
}

function buildOptionsSkewSignal(
  expiry: OptionExpirySummary | null,
  volatility: OptionsVolatilityResponse
): ConfluenceSignal {
  const skew = expiry?.skew25Delta ?? 0;
  const ivRank = volatility.rank ?? 50;
  const score = clamp(50 - skew * 2 + (ivRank - 50) * 0.2, 0, 100);
  return {
    id: 'optionsSkew',
    label: 'Options skew',
    score: Math.round(score),
    direction: skew < -3 ? 'bullish' : skew > 3 ? 'bearish' : 'neutral',
    value: `${skew.toFixed(1)} vol pts`,
    explanation: expiry
      ? `${expiry.expiry} 25-delta-style skew with IV rank ${ivRank.toFixed(0)}.`
      : 'No liquid expiry available.',
    fresh: !volatility.provider.stale,
  };
}

function buildPerpLeverageSignal(avgFunding: number | null, totalOi: number): ConfluenceSignal {
  const funding = avgFunding ?? 0;
  const crowded = Math.abs(funding) > 0.02;
  const score = clamp(50 + funding * 800 - (crowded ? 10 : 0), 0, 100);
  return {
    id: 'perpLeverage',
    label: 'Perp leverage',
    score: Math.round(score),
    direction: crowded
      ? 'risk'
      : funding > 0.005
        ? 'bullish'
        : funding < -0.005
          ? 'bearish'
          : 'neutral',
    value: `${funding.toFixed(4)}% avg`,
    explanation: `${formatUsd(totalOi)} aggregate open interest from available perp funding feeds.`,
    fresh: avgFunding !== null,
  };
}

function buildBasisStressSignal(fundingRates: FundingRateData[]): ConfluenceSignal {
  const rates = fundingRates.map((item) => item.fundingRatePercent);
  const dispersion = rates.length ? Math.max(...rates) - Math.min(...rates) : 0;
  const score = clamp(70 - dispersion * 500, 0, 100);
  return {
    id: 'basisStress',
    label: 'Basis stress',
    score: Math.round(score),
    direction: dispersion > 0.05 ? 'risk' : 'neutral',
    value: `${dispersion.toFixed(4)}% spread`,
    explanation: 'Cross-venue funding dispersion proxies basis and borrow stress.',
    fresh: fundingRates.length > 0,
  };
}

function buildSpotTrendSignal(ticker: Ticker | null): ConfluenceSignal {
  const change = ticker?.percentage24h ?? 0;
  const score = clamp(50 + change * 2, 0, 100);
  return {
    id: 'spotTrend',
    label: 'Spot trend',
    score: Math.round(score),
    direction: change > 1 ? 'bullish' : change < -1 ? 'bearish' : 'neutral',
    value: `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`,
    explanation: '24h spot move from the selected Lazuli exchange feed.',
    fresh: !!ticker,
  };
}

function buildLiquidityRiskSignal(
  expiry: OptionExpirySummary | null,
  ticker: Ticker | null
): ConfluenceSignal {
  const volume = ticker?.quoteVolume24h ?? ticker?.volume24h ?? 0;
  const optionOi = expiry?.totalOpenInterest ?? 0;
  const score = clamp(volume > 0 ? 75 - Math.min(35, optionOi / Math.max(volume, 1)) : 45, 0, 100);
  return {
    id: 'liquidityRisk',
    label: 'Liquidity risk',
    score: Math.round(score),
    direction: score < 45 ? 'risk' : 'neutral',
    value: formatUsd(volume),
    explanation: 'Compares available spot turnover with nearby options concentration.',
    fresh: !!ticker && !!expiry,
  };
}

function classifyRegime(
  signals: ConfluenceSignal[],
  score: number
): InstitutionalConfluenceResponse['regime'] {
  const byId = Object.fromEntries(signals.map((signal) => [signal.id, signal]));
  if (
    (byId.liquidityRisk?.direction === 'risk' || byId.basisStress?.direction === 'risk') &&
    score < 55
  )
    return 'fragile';
  if ((byId.etfDemand?.score ?? 0) >= 65 && score >= 55) return 'etf-led';
  if (
    ((byId.optionsSkew?.score ?? 0) >= 65 || (byId.optionsSkew?.score ?? 100) <= 35) &&
    score >= 48
  )
    return 'options-led';
  if (
    (byId.perpLeverage?.direction === 'risk' || (byId.perpLeverage?.score ?? 0) >= 68) &&
    (byId.etfDemand?.score ?? 50) < 60
  )
    return 'leverage-led';
  if ((byId.spotTrend?.score ?? 0) >= 60) return 'spot-led';
  return 'mixed';
}

function summarizeRegime(
  asset: InstitutionalAsset,
  regime: InstitutionalConfluenceResponse['regime'],
  score: number
): string {
  const names: Record<InstitutionalConfluenceResponse['regime'], string> = {
    'spot-led': 'spot momentum is carrying the tape',
    'etf-led': 'regulated spot demand is the dominant support',
    'options-led': 'options positioning is steering near-term risk',
    'leverage-led': 'perp leverage is doing more work than spot demand',
    fragile: 'signals are brittle and liquidity risk is elevated',
    mixed: 'signals are split across flows, options, and spot',
  };
  return `${asset} regime score ${score}: ${names[regime]}.`;
}

function buildFallbackEtfFlows(asset: InstitutionalAsset): EtfDailyFlow[] {
  const funds = ETF_FUNDS[asset].map((fund) => fund.ticker);
  let cumulative = asset === 'BTC' ? 42_000_000_000 : 7_500_000_000;
  return Array.from({ length: 90 }, (_, index) => {
    const timestamp = Date.now() - (89 - index) * DAY_MS;
    const wave = Math.sin(index / 4) * (asset === 'BTC' ? 180_000_000 : 55_000_000);
    const drift = (index % 9 === 0 ? -1 : 1) * (asset === 'BTC' ? 35_000_000 : 12_000_000);
    const total = Math.round(wave + drift);
    cumulative += total;
    const fundFlows: Record<string, number | null> = {};
    funds.forEach((ticker, fundIndex) => {
      fundFlows[ticker] = Math.round(
        (total / funds.length) * (1 + Math.sin(index + fundIndex) * 0.35)
      );
    });
    const entries = Object.entries(fundFlows).filter(
      (entry): entry is [string, number] => entry[1] !== null
    );
    return {
      date: new Date(timestamp).toISOString().slice(0, 10),
      asset,
      totalNetFlowUsd: total,
      cumulativeNetFlowUsd: cumulative,
      fundFlows,
      leaderTicker: maxBy(entries, (entry) => entry[1])?.[0] ?? null,
      laggardTicker: maxBy(entries, (entry) => -entry[1])?.[0] ?? null,
      anomaly: Math.abs(total) > (asset === 'BTC' ? 250_000_000 : 80_000_000),
    };
  });
}

function buildFallbackOptions(asset: InstitutionalAsset): OptionInstrument[] {
  const spot = asset === 'BTC' ? 103_000 : 3_650;
  const step = asset === 'BTC' ? 5_000 : 200;
  const expiries = [14, 35, 63, 91].map((days) => Date.now() + days * DAY_MS);
  return expiries.flatMap((expiryTimestamp, expiryIndex) => {
    const expiry = new Date(expiryTimestamp).toISOString().slice(0, 10);
    return Array.from({ length: 13 }, (_, index) => spot + (index - 6) * step).flatMap((strike) =>
      (['call', 'put'] as const).map((optionType) => {
        const moneyness = Math.abs(strike / spot - 1);
        const openInterest = Math.round((1 / (0.08 + moneyness)) * (expiryIndex + 1) * 25);
        const impliedVolatility =
          48 + expiryIndex * 2 + moneyness * 60 + (optionType === 'put' ? 2 : 0);
        const greeks = calculateBlackScholesGreeks({
          spot,
          strike,
          expiryTimestamp,
          optionType,
          impliedVolatility,
        });
        return {
          instrumentName: `${asset}-${expiry}-${strike}-${optionType === 'call' ? 'C' : 'P'}`,
          asset,
          expiry,
          expiryTimestamp,
          strike,
          optionType,
          bid: null,
          ask: null,
          markPrice: null,
          underlyingPrice: spot,
          openInterest,
          volume24h: openInterest * spot * 0.04,
          impliedVolatility,
          delta: greeks.delta,
          gamma: greeks.gamma,
          theta: greeks.theta,
          vega: greeks.vega,
        };
      })
    );
  });
}

function buildFallbackVolatility(
  asset: InstitutionalAsset,
  range: InstitutionalRange
): VolatilityCandle[] {
  const count = range === '30d' ? 30 : range === '90d' ? 90 : 180;
  const base = asset === 'BTC' ? 48 : 58;
  return Array.from({ length: count }, (_, index) => {
    const timestamp = Date.now() - (count - index - 1) * DAY_MS;
    const close = base + Math.sin(index / 8) * 8 + Math.cos(index / 17) * 4;
    return {
      timestamp,
      open: close - 1,
      high: close + 2,
      low: close - 2,
      close,
    };
  });
}

function estimateMaxPain(strikes: OptionStrikeSummary[], spot: number | null): number | null {
  if (!spot || strikes.length === 0)
    return maxBy(strikes, (strike) => strike.totalOpenInterest)?.strike ?? null;
  return (
    strikes
      .map((candidate) => ({
        strike: candidate.strike,
        payout: strikes.reduce(
          (sum, strike) =>
            sum +
            Math.max(0, candidate.strike - strike.strike) * strike.callOpenInterest +
            Math.max(0, strike.strike - candidate.strike) * strike.putOpenInterest,
          0
        ),
      }))
      .sort((a, b) => a.payout - b.payout)[0]?.strike ?? null
  );
}

function estimateAtmIv(instruments: OptionInstrument[], spot: number | null): number | null {
  if (!spot)
    return median(instruments.map((instrument) => instrument.impliedVolatility).filter(isNumber));
  const sorted = instruments
    .filter((instrument) => instrument.impliedVolatility !== null)
    .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot));
  return average(
    sorted
      .slice(0, 4)
      .map((instrument) => instrument.impliedVolatility)
      .filter(isNumber)
  );
}

function estimateSkew(instruments: OptionInstrument[], spot: number | null): number | null {
  if (!spot) return null;
  const puts = instruments
    .filter(
      (instrument) =>
        instrument.optionType === 'put' &&
        instrument.strike < spot &&
        instrument.impliedVolatility !== null
    )
    .sort((a, b) => Math.abs(a.strike / spot - 0.9) - Math.abs(b.strike / spot - 0.9));
  const calls = instruments
    .filter(
      (instrument) =>
        instrument.optionType === 'call' &&
        instrument.strike > spot &&
        instrument.impliedVolatility !== null
    )
    .sort((a, b) => Math.abs(a.strike / spot - 1.1) - Math.abs(b.strike / spot - 1.1));
  const putIv = average(
    puts
      .slice(0, 3)
      .map((instrument) => instrument.impliedVolatility)
      .filter(isNumber)
  );
  const callIv = average(
    calls
      .slice(0, 3)
      .map((instrument) => instrument.impliedVolatility)
      .filter(isNumber)
  );
  if (putIv === null || callIv === null) return null;
  return putIv - callIv;
}

async function writeSnapshot(env: Env | undefined, key: string, data: unknown): Promise<void> {
  try {
    await env?.OHLCV_ARCHIVE?.put(key, JSON.stringify({ data, updatedAt: Date.now() }), {
      httpMetadata: { contentType: 'application/json' },
    });
    await env?.DB?.prepare(
      `INSERT INTO institutional_provider_status (provider, source, ok, updated_at, message)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(provider) DO UPDATE SET
         source = excluded.source,
         ok = excluded.ok,
         updated_at = excluded.updated_at,
         message = excluded.message
       WHERE institutional_provider_status.source <> excluded.source
          OR institutional_provider_status.ok <> excluded.ok
          OR COALESCE(institutional_provider_status.message, '') <> COALESCE(excluded.message, '')
          OR institutional_provider_status.updated_at <= excluded.updated_at - 21600000`
    )
      .bind('Farside Investors', 'live', 1, Date.now(), null)
      .run();
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        module: 'institutional',
        msg: 'snapshot write failed',
        key,
        error: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

async function readSnapshot<T>(env: Env | undefined, key: string): Promise<T | null> {
  try {
    const object = await env?.OHLCV_ARCHIVE?.get(key);
    if (!object) return null;
    const payload = (await object.json()) as { data?: T };
    return payload.data ?? null;
  } catch {
    return null;
  }
}

function setCached<T>(key: string, data: T): void {
  memoryCache.set(key, { data, updatedAt: Date.now() });
  while (memoryCache.size > 50) {
    const oldest = memoryCache.keys().next().value;
    if (!oldest) break;
    memoryCache.delete(oldest);
  }
}

function getCached<T>(key: string, ttlMs: number): T | null {
  const cached = memoryCache.get(key) as CachedInstitutional<T> | undefined;
  if (!cached || Date.now() - cached.updatedAt > ttlMs) return null;
  return cached.data;
}

function normalizeDate(value: string): string | null {
  const parsed = Date.parse(value.replace(/\./g, '-'));
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

function parseMoneyMillions(value: string): number | null {
  const clean = value.replace(/\$/g, '').replace(/,/g, '').replace(/\s+/g, '').trim();
  if (!clean || /^[-–—]$/.test(clean)) return null;
  const negative = /^\(.+\)$/.test(clean) || clean.startsWith('-');
  const numeric = Number(clean.replace(/[()]/g, ''));
  if (!Number.isFinite(numeric)) return null;
  return (negative ? -Math.abs(numeric) : numeric) * 1_000_000;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, ' ');
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8211;|&ndash;/g, '-')
    .replace(/&#8212;|&mdash;/g, '-');
}

function isFlowAnomaly(value: number, history: number[]): boolean {
  if (history.length < 10) return false;
  const abs = history.map((item) => Math.abs(item));
  const avg = average(abs) ?? 0;
  return Math.abs(value) > avg * 2.5;
}

function rangeStartTimestamp(range: InstitutionalRange, now: number): number {
  if (range === 'all') return now - 365 * DAY_MS;
  if (range === 'ytd') return Date.UTC(new Date(now).getUTCFullYear(), 0, 1);
  return now - (range === '30d' ? 30 : 90) * DAY_MS;
}

function groupBy<T>(items: T[], getKey: (item: T) => string): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((groups, item) => {
    const key = getKey(item);
    groups[key] = [...(groups[key] ?? []), item];
    return groups;
  }, {});
}

function maxBy<T>(items: T[], score: (item: T) => number): T | null {
  return items.reduce<T | null>(
    (best, item) => (best === null || score(item) > score(best) ? item : best),
    null
  );
}

function average(values: number[]): number | null {
  const clean = values.filter(Number.isFinite);
  if (clean.length === 0) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function calculateBlackScholesGreeks(params: {
  spot: number | null;
  strike: number;
  expiryTimestamp: number;
  optionType: 'call' | 'put';
  impliedVolatility: number | null;
}): Pick<OptionInstrument, 'delta' | 'gamma' | 'theta' | 'vega'> {
  const { spot, strike, expiryTimestamp, optionType } = params;
  const rawIv = params.impliedVolatility;
  if (
    spot === null ||
    rawIv === null ||
    spot <= 0 ||
    strike <= 0 ||
    expiryTimestamp <= Date.now()
  ) {
    return nullGreeks();
  }

  const sigma = rawIv > 3 ? rawIv / 100 : rawIv;
  const timeYears = Math.max((expiryTimestamp - Date.now()) / (365 * DAY_MS), 1 / 365);
  const riskFreeRate = 0.04;
  if (!Number.isFinite(sigma) || sigma <= 0 || sigma > 5) {
    return nullGreeks();
  }

  const sqrtTime = Math.sqrt(timeYears);
  const d1 =
    (Math.log(spot / strike) + (riskFreeRate + 0.5 * sigma * sigma) * timeYears) /
    (sigma * sqrtTime);
  const d2 = d1 - sigma * sqrtTime;
  const pdfD1 = standardNormalPdf(d1);
  const callDelta = standardNormalCdf(d1);
  const delta = optionType === 'call' ? callDelta : callDelta - 1;
  const gamma = pdfD1 / (spot * sigma * sqrtTime);
  const thetaCall =
    (-(spot * pdfD1 * sigma) / (2 * sqrtTime) -
      riskFreeRate * strike * Math.exp(-riskFreeRate * timeYears) * standardNormalCdf(d2)) /
    365;
  const thetaPut =
    (-(spot * pdfD1 * sigma) / (2 * sqrtTime) +
      riskFreeRate * strike * Math.exp(-riskFreeRate * timeYears) * standardNormalCdf(-d2)) /
    365;
  const vega = (spot * pdfD1 * sqrtTime) / 100;

  return {
    delta: roundGreek(delta),
    gamma: roundGreek(gamma),
    theta: roundGreek(optionType === 'call' ? thetaCall : thetaPut),
    vega: roundGreek(vega),
  };
}

function nullGreeks(): Pick<OptionInstrument, 'delta' | 'gamma' | 'theta' | 'vega'> {
  return { delta: null, gamma: null, theta: null, vega: null };
}

function standardNormalPdf(value: number): number {
  return Math.exp(-0.5 * value * value) / Math.sqrt(2 * Math.PI);
}

function standardNormalCdf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

function roundGreek(value: number): number | null {
  return Number.isFinite(value) ? Math.round(value * 1_000_000) / 1_000_000 : null;
}

function median(values: number[]): number | null {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle]! : (clean[middle - 1]! + clean[middle]!) / 2;
}

function percentileRank(values: number[], value: number): number {
  const clean = values.filter(Number.isFinite);
  if (clean.length === 0) return 50;
  return Math.round((clean.filter((item) => item <= value).length / clean.length) * 100);
}

function finiteOrNull(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function finiteOrZero(value: unknown): number {
  return finiteOrNull(value) ?? 0;
}

function isNumber(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatUsd(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  return `${sign}$${Math.round(abs).toLocaleString('en-US')}`;
}
