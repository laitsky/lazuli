import { describe, expect, test } from 'bun:test';

import {
  PUBLIC_REALTIME_FANOUT_SHARDS,
  realtimeHubNameForConnection,
  realtimeHubNames,
} from './realtimeFanout';

describe('realtime public fan-out sharding', () => {
  test('replicates public topics across a fixed bounded shard set', () => {
    const names = realtimeHubNames('ticker:bybit:btcusdt.p');
    expect(names).toHaveLength(PUBLIC_REALTIME_FANOUT_SHARDS);
    expect(new Set(names).size).toBe(PUBLIC_REALTIME_FANOUT_SHARDS);
    expect(names.every((name) => name.startsWith('ticker:bybit:btcusdt.p:fanout:'))).toBe(true);
  });

  test('keeps private user topics on one authorization boundary', () => {
    expect(realtimeHubNames('alerts:user:user-123')).toEqual(['alerts:user:user-123']);
  });

  test('assigns connection seeds deterministically across every shard', () => {
    const topic = 'ticker:bybit:btcusdt.p';
    const assignments = Array.from({ length: 100 }, (_, index) =>
      realtimeHubNameForConnection(topic, `websocket-key-${index}`)
    );
    expect(realtimeHubNameForConnection(topic, 'stable-key')).toBe(
      realtimeHubNameForConnection(topic, 'stable-key')
    );
    expect(new Set(assignments)).toEqual(new Set(realtimeHubNames(topic)));
  });
});
