import { describe, expect, test } from 'bun:test';

import {
  PUBLIC_REALTIME_FANOUT_SHARDS,
  realtimeFanoutNameForConnection,
  realtimeFanoutNames,
  realtimeHubNameForConnection,
  realtimeHubNames,
  realtimeSequencerName,
} from './realtimeFanout';
import { boundedCheckpointEvictions } from './realtimeCheckpoint';

describe('realtime public fan-out sharding', () => {
  test('uses one canonical sequencer and four v3 leaves per public topic', () => {
    const topic = 'ticker:bybit:btcusdt.p';
    expect(realtimeSequencerName(topic)).toBe(`${topic}:sequencer:v1`);
    expect(realtimeFanoutNames(topic)).toHaveLength(PUBLIC_REALTIME_FANOUT_SHARDS);
    expect(new Set(realtimeFanoutNames(topic)).size).toBe(PUBLIC_REALTIME_FANOUT_SHARDS);
    expect(realtimeFanoutNames(topic).every((name) => name.includes(':fanout:v3:'))).toBe(true);
  });

  test('assigns v3 connection leaves deterministically', () => {
    const topic = 'ticker:bybit:btcusdt.p';
    const assignments = Array.from({ length: 100 }, (_, index) =>
      realtimeFanoutNameForConnection(topic, `websocket-key-${index}`)
    );
    expect(realtimeFanoutNameForConnection(topic, 'stable-key')).toBe(
      realtimeFanoutNameForConnection(topic, 'stable-key')
    );
    expect(new Set(assignments)).toEqual(new Set(realtimeFanoutNames(topic)));
  });

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

  test('evicts only the oldest persisted dedupe ids at the configured bound', () => {
    expect(boundedCheckpointEvictions(new Set(['oldest', 'middle']), ['newest'], 2)).toEqual([
      'oldest',
    ]);
    expect(boundedCheckpointEvictions(new Set(['oldest', 'middle']), ['oldest'], 2)).toEqual([]);
    expect(boundedCheckpointEvictions(new Set(['a']), ['b', 'c', 'd'], 2)).toEqual(['a', 'b']);
    let rejectedInvalidCapacity = false;
    try {
      boundedCheckpointEvictions(new Set(), ['a'], 0);
    } catch (error) {
      rejectedInvalidCapacity =
        error instanceof Error && error.message === 'Realtime checkpoint capacity must be positive';
    }
    expect(rejectedInvalidCapacity).toBe(true);
  });
});
