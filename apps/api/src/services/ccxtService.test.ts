import { describe, expect, test } from 'bun:test';
import { ErrorCode, ExchangeError, ValidationError } from '../errors';
import { isTransientExchangeError } from './ccxtService';

describe('exchange transient error classification', () => {
  test('treats timeout, rate limit, unavailable, and network exchange errors as transient', () => {
    expect(
      isTransientExchangeError(new ExchangeError(ErrorCode.EXCHANGE_TIMEOUT, 'timeout', 'bybit'))
    ).toBe(true);
    expect(
      isTransientExchangeError(
        new ExchangeError(ErrorCode.EXCHANGE_RATE_LIMIT, 'rate limit', 'bybit')
      )
    ).toBe(true);
    expect(
      isTransientExchangeError(
        new ExchangeError(ErrorCode.EXCHANGE_UNAVAILABLE, 'maintenance', 'bybit')
      )
    ).toBe(true);
    expect(
      isTransientExchangeError(
        new ExchangeError(ErrorCode.EXCHANGE_NETWORK_ERROR, 'network', 'bybit')
      )
    ).toBe(true);
  });

  test('does not retry validation, auth, unsupported, or generic API errors', () => {
    expect(
      isTransientExchangeError(
        new ValidationError(ErrorCode.VALIDATION_INVALID_SYMBOL, 'bad symbol', 'symbol')
      )
    ).toBe(false);
    expect(
      isTransientExchangeError(
        new ExchangeError(ErrorCode.EXCHANGE_AUTHENTICATION_ERROR, 'auth failed', 'bybit')
      )
    ).toBe(false);
    expect(
      isTransientExchangeError(
        new ExchangeError(ErrorCode.EXCHANGE_NOT_SUPPORTED, 'unsupported', 'unknown')
      )
    ).toBe(false);
    expect(
      isTransientExchangeError(
        new ExchangeError(ErrorCode.EXCHANGE_API_ERROR, 'bad request', 'bybit')
      )
    ).toBe(false);
  });

  test('classifies common raw network and rate-limit messages case-insensitively', () => {
    expect(isTransientExchangeError(new Error('Network connection reset'))).toBe(true);
    expect(isTransientExchangeError(new Error('TOO MANY REQUESTS 429'))).toBe(true);
    expect(isTransientExchangeError(new Error('symbol not found'))).toBe(false);
  });
});
