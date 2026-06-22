import { z } from 'zod';
import type { SupportedExchange, Timeframe } from '@lazuli/shared';
import { invalidParameter } from '../errors';

export const supportedExchangeSchema = z.enum(['binance', 'bybit', 'okx', 'hyperliquid', 'upbit']);

export const timeframeSchema = z.enum(['1m', '5m', '15m', '1h', '4h', '1d', '3d', '1w']);

export const marketTypeSchema = z.enum(['spot', 'perp']);

export const symbolSchema = z
  .string()
  .trim()
  .min(3)
  .max(40)
  .regex(
    /^([A-Z0-9]{1,20}-[A-Z0-9]{1,20}|[A-Z0-9]{2,30}\.P)$/i,
    'Symbol must use Lazuli notation such as BTC-USDT or BTCUSDT.P'
  )
  .transform((value) => value.toUpperCase());

const finiteTimestampSchema = z.coerce.number().int().finite().min(0).max(8_640_000_000_000);

export const ohlcvQuerySchema = z
  .object({
    timeframe: timeframeSchema.default('1h'),
    type: marketTypeSchema.optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(100),
    since: finiteTimestampSchema.optional(),
    until: finiteTimestampSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.since !== undefined && value.until !== undefined && value.since >= value.until) {
      ctx.addIssue({
        code: 'custom',
        path: ['since'],
        message: 'since must be before until',
      });
    }

    if (
      value.since !== undefined &&
      value.until !== undefined &&
      value.until - value.since > 366 * 24 * 60 * 60 * 1000
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['until'],
        message: 'date range cannot exceed 366 days',
      });
    }
  });

export const multiTimeframeQuerySchema = z.object({
  timeframes: z
    .string()
    .default('1h')
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    )
    .pipe(z.array(timeframeSchema).min(1).max(8)),
  type: marketTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

export const customIndexSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    exchange: supportedExchangeSchema,
    timeframe: timeframeSchema,
    limit: z.coerce.number().int().min(1).max(1000).default(100),
    assets: z
      .array(
        z.object({
          symbol: symbolSchema,
          weight: z.number().finite().positive().max(100),
        })
      )
      .min(1)
      .max(20),
  })
  .superRefine((value, ctx) => {
    const weightTotal = value.assets.reduce((sum, asset) => sum + asset.weight, 0);
    if (weightTotal <= 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['assets'],
        message: 'total asset weight must be positive',
      });
    }
  });

export const ohlcvBatchSchema = z.object({
  symbols: z.array(symbolSchema).min(1).max(50).default([]),
  period: z.enum(['1h', '4h', '24h', '7d', '30d']).default('24h'),
});

export type ParsedOhlcvQuery = z.infer<typeof ohlcvQuerySchema> & {
  timeframe: Timeframe;
  type?: 'spot' | 'perp';
};

export type ParsedMultiTimeframeQuery = z.infer<typeof multiTimeframeQuerySchema> & {
  timeframes: Timeframe[];
};

export type ParsedCustomIndexRequest = z.infer<typeof customIndexSchema> & {
  exchange: SupportedExchange;
  timeframe: Timeframe;
};

export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, field: string): T {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }

  const message = result.error.issues
    .map((issue) => `${issue.path.join('.') || field}: ${issue.message}`)
    .join('; ');
  throw invalidParameter(field, message);
}
