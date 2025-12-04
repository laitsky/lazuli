/**
 * Redis-based cache service for distributed caching
 *
 * This service provides a Redis-backed caching layer that:
 * - Supports TTL (Time To Live) for automatic expiration
 * - Enables distributed caching across multiple API instances
 * - Provides pattern-based key invalidation
 * - Tracks cache statistics (hits/misses)
 *
 * Benefits over in-memory caching:
 * - Cache persists across API restarts
 * - Shared cache between multiple API instances (horizontal scaling)
 * - Better memory management (Redis handles eviction)
 * - Built-in data structure support for complex caching patterns
 */

import Redis from 'ioredis';
import { createServiceLogger } from '../utils/logger';

// Create logger for Redis cache service
const log = createServiceLogger('redis');

/**
 * Statistics tracking for cache performance monitoring
 */
interface CacheStats {
  hits: number;
  misses: number;
  connected: boolean;
}

/**
 * Redis connection configuration options
 */
export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
  connectTimeout?: number;
  maxRetriesPerRequest?: number;
}

/**
 * Default configuration values for Redis connection
 */
const DEFAULT_CONFIG: RedisConfig = {
  host: 'localhost',
  port: 6379,
  db: 0,
  keyPrefix: 'lazuli:',
  connectTimeout: 5000,
  maxRetriesPerRequest: 3,
};

/**
 * Redis cache service class
 * Implements the same interface as the in-memory CacheService for easy swapping
 */
export class RedisCacheService {
  private client: Redis | null = null;
  private readonly config: RedisConfig;
  private readonly DEFAULT_TTL = 30000; // 30 seconds default TTL (in milliseconds)
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    connected: false,
  };

  constructor(config?: Partial<RedisConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize Redis connection
   * Sets up event handlers for connection management
   * @returns Promise<boolean> - true if connection successful, false otherwise
   */
  async connect(): Promise<boolean> {
    try {
      this.client = new Redis({
        host: this.config.host,
        port: this.config.port,
        password: this.config.password,
        db: this.config.db,
        keyPrefix: this.config.keyPrefix,
        connectTimeout: this.config.connectTimeout,
        maxRetriesPerRequest: this.config.maxRetriesPerRequest,
        retryStrategy: (times: number) => {
          // Exponential backoff with max 30 seconds
          const delay = Math.min(times * 1000, 30000);
          log.warn(`Retry attempt ${times}, waiting ${delay}ms`, { attempt: times, delay });
          return delay;
        },
        lazyConnect: false,
      });

      // Set up event handlers for connection monitoring
      this.client.on('connect', () => {
        log.info('Connected successfully');
        this.stats.connected = true;
      });

      this.client.on('ready', () => {
        log.info('Ready to accept commands');
      });

      this.client.on('error', (err: Error) => {
        log.error('Connection error', err);
        this.stats.connected = false;
      });

      this.client.on('close', () => {
        log.warn('Connection closed');
        this.stats.connected = false;
      });

      this.client.on('reconnecting', () => {
        log.info('Attempting to reconnect...');
      });

      // Test the connection with a ping
      await this.client.ping();
      this.stats.connected = true;
      log.info('Cache service initialized', { host: this.config.host, port: this.config.port });
      return true;
    } catch (error) {
      log.error('Failed to connect', error);
      this.stats.connected = false;
      return false;
    }
  }

  /**
   * Check if Redis is currently connected
   * @returns boolean - true if connected
   */
  isConnected(): boolean {
    return this.stats.connected && this.client !== null;
  }

  /**
   * Store data in Redis cache with TTL
   * @param key - Cache key (will be prefixed with keyPrefix)
   * @param data - Data to cache (will be JSON serialized)
   * @param ttl - Time to live in milliseconds (optional, defaults to 30s)
   */
  async set<T>(key: string, data: T, ttl?: number): Promise<void> {
    if (!this.client || !this.stats.connected) {
      log.warn('Cannot set cache - not connected', { key });
      return;
    }

    try {
      // Convert TTL from milliseconds to seconds for Redis SETEX
      const ttlSeconds = Math.ceil((ttl || this.DEFAULT_TTL) / 1000);

      // Serialize data to JSON string for storage
      const serialized = JSON.stringify(data);

      // Use SETEX for atomic set with expiration
      await this.client.setex(key, ttlSeconds, serialized);
    } catch (error) {
      log.error(`Error setting key "${key}"`, error, { key });
    }
  }

  /**
   * Retrieve data from Redis cache
   * @param key - Cache key
   * @returns Cached data or null if not found/expired
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this.client || !this.stats.connected) {
      this.stats.misses++;
      return null;
    }

    try {
      const data = await this.client.get(key);

      if (!data) {
        this.stats.misses++;
        return null;
      }

      this.stats.hits++;
      // Deserialize JSON string back to object
      return JSON.parse(data) as T;
    } catch (error) {
      log.error(`Error getting key "${key}"`, error, { key });
      this.stats.misses++;
      return null;
    }
  }

  /**
   * Check if a key exists in the cache
   * Note: This doesn't update any LRU tracking as Redis handles TTL natively
   * @param key - Cache key
   * @returns true if key exists
   */
  async has(key: string): Promise<boolean> {
    if (!this.client || !this.stats.connected) {
      return false;
    }

    try {
      const exists = await this.client.exists(key);
      return exists === 1;
    } catch (error) {
      log.error(`Error checking key "${key}"`, error, { key });
      return false;
    }
  }

  /**
   * Delete a specific cache entry
   * @param key - Cache key to invalidate
   */
  async invalidate(key: string): Promise<void> {
    if (!this.client || !this.stats.connected) {
      return;
    }

    try {
      await this.client.del(key);
    } catch (error) {
      log.error(`Error invalidating key "${key}"`, error, { key });
    }
  }

  /**
   * Delete all cache entries matching a pattern
   * Uses Redis SCAN for memory-efficient iteration over large key sets
   * @param pattern - Pattern to match (e.g., 'tickers:binance:*')
   */
  async invalidatePattern(pattern: string): Promise<void> {
    if (!this.client || !this.stats.connected) {
      return;
    }

    try {
      // Use SCAN to find matching keys (memory efficient for large datasets)
      // The scanStream handles pagination automatically
      const stream = this.client.scanStream({
        match: `${this.config.keyPrefix}${pattern}*`,
        count: 100,
      });

      const keysToDelete: string[] = [];

      stream.on('data', (keys: string[]) => {
        // Remove prefix from keys since del() will add it again
        const unprefixedKeys = keys.map((k) => k.replace(this.config.keyPrefix || '', ''));
        keysToDelete.push(...unprefixedKeys);
      });

      await new Promise<void>((resolve, reject) => {
        stream.on('end', async () => {
          if (keysToDelete.length > 0) {
            try {
              await this.client!.del(...keysToDelete);
              log.info(`Invalidated keys matching pattern`, {
                pattern,
                count: keysToDelete.length,
              });
            } catch (err) {
              reject(err);
            }
          }
          resolve();
        });
        stream.on('error', reject);
      });
    } catch (error) {
      log.error(`Error invalidating pattern "${pattern}"`, error, { pattern });
    }
  }

  /**
   * Clear all cache entries (within the key prefix namespace)
   * Uses SCAN + DEL for memory efficiency
   */
  async clear(): Promise<void> {
    await this.invalidatePattern('*');
    log.info('Cache cleared');
  }

  /**
   * Get cache statistics including hit/miss ratio
   * @returns Object with cache stats
   */
  async getStats(): Promise<CacheStats & { hitRatio: number; keyCount: number }> {
    const total = this.stats.hits + this.stats.misses;
    const hitRatio = total > 0 ? this.stats.hits / total : 0;

    let keyCount = 0;
    if (this.client && this.stats.connected) {
      try {
        // Count keys matching our prefix
        const stream = this.client.scanStream({
          match: `${this.config.keyPrefix}*`,
          count: 100,
        });

        await new Promise<void>((resolve) => {
          stream.on('data', (keys: string[]) => {
            keyCount += keys.length;
          });
          stream.on('end', resolve);
        });
      } catch (error) {
        log.error('Error getting key count', error);
      }
    }

    return {
      ...this.stats,
      hitRatio: Math.round(hitRatio * 100) / 100,
      keyCount,
    };
  }

  /**
   * Get detailed Redis server information
   * Useful for monitoring and debugging
   * @returns Redis INFO output or null if not connected
   */
  async getServerInfo(): Promise<string | null> {
    if (!this.client || !this.stats.connected) {
      return null;
    }

    try {
      return await this.client.info();
    } catch (error) {
      log.error('Error getting server info', error);
      return null;
    }
  }

  /**
   * Gracefully disconnect from Redis
   * Should be called during application shutdown
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.stats.connected = false;
      log.info('Disconnected');
    }
  }

  /**
   * Get remaining TTL for a key in seconds
   * @param key - Cache key
   * @returns TTL in seconds, -2 if key doesn't exist, -1 if no expiry
   */
  async getTTL(key: string): Promise<number> {
    if (!this.client || !this.stats.connected) {
      return -2;
    }

    try {
      return await this.client.ttl(key);
    } catch (error) {
      log.error(`Error getting TTL for "${key}"`, error, { key });
      return -2;
    }
  }

  /**
   * Extend the TTL of an existing key
   * Useful for cache warming or refreshing frequently accessed data
   * @param key - Cache key
   * @param ttl - New TTL in milliseconds
   * @returns true if TTL was updated, false if key doesn't exist
   */
  async extendTTL(key: string, ttl: number): Promise<boolean> {
    if (!this.client || !this.stats.connected) {
      return false;
    }

    try {
      const ttlSeconds = Math.ceil(ttl / 1000);
      const result = await this.client.expire(key, ttlSeconds);
      return result === 1;
    } catch (error) {
      log.error(`Error extending TTL for "${key}"`, error, { key, ttl });
      return false;
    }
  }
}

// Export singleton instance
// Will be initialized with environment configuration in the main cacheService
export const redisCacheService = new RedisCacheService();
