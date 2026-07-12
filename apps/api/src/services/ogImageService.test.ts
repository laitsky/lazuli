import { describe, expect, test } from 'bun:test';
import { renderMarketOgPng } from './ogImageService';

describe('dynamic OG PNG', () => {
  test('renders a valid 1200x630 PNG signature and IHDR', async () => {
    const png = await renderMarketOgPng({
      symbol: 'BTCUSDT',
      exchange: 'BYBIT',
      price: 123_456.78,
      changePercent: 3.42,
    });
    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect(view.getUint32(16)).toBe(1200);
    expect(view.getUint32(20)).toBe(630);
    expect(png.length > 1_000).toBe(true);
  });
});
