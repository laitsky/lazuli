/**
 * Unified cache service with Redis support and in-memory fallback
 *
 * This service provides a caching layer that:
 * - Uses Redis as primary cache when available (for distributed caching)
 * - Falls back to in-memory cache when Redis is unavailable
 * - Maintains the same interface regardless of backend
 *
 * Benefits:
 * - Seamless transition between cache backends
 * - No code changes required in controllers/services
 * - High availability with automatic fallback
 * - Performance monitoring via stats
 *
 * Configuration (environment variables):
 * - REDIS_ENABLED: Set to 'true' to enable Redis (default: false)
 * - REDIS_HOST: Redis server hostname (default: localhost)
 * - REDIS_PORT: Redis server port (default: 6379)
 * - REDIS_PASSWORD: Redis password (optional)
 * - REDIS_DB: Redis database number (default: 0)
 */

import { RedisCacheService } from './redisCacheService';
import { createServiceLogger } from '../utils/logger';

// Create logger for cache service
const log = createServiceLogger('cache');

/**
 * Interface for cache entries in the in-memory store
 */
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
  lastAccessed: number; // For LRU tracking
}

/**
 * Statistics for monitoring cache performance
 */
interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  maxSize: number;
}

/**
 * Extended statistics returned by getStats()
 */
interface CacheStatsExtended extends CacheStats {
  hitRatio: number;
  keys: string[];
  backend: 'redis' | 'memory';
  redisConnected: boolean;
}

/**
 * Configuration for the cache service
 */
interface CacheConfig {
  redisEnabled: boolean;
  redisHost: string;
  redisPort: number;
  redisPassword?: string;
  redisDb: number;
}

/**
 * Load configuration from environment variables
 * @returns CacheConfig object
 */
function loadConfig(): CacheConfig {
  return {
    redisEnabled: process.env.REDIS_ENABLED === 'true',
    redisHost: process.env.REDIS_HOST || 'localhost',
    redisPort: parseInt(process.env.REDIS_PORT || '6379', 10),
    redisPassword: process.env.REDIS_PASSWORD,
    redisDb: parseInt(process.env.REDIS_DB || '0', 10),
  };
}

/**
 * Unified cache service class
 * Provides consistent caching API with Redis or in-memory backend
 */
export class CacheService {
  // In-memory cache storage
  private memoryCache: Map<string, CacheEntry<unknown>>;
  private readonly DEFAULT_TTL = 30000; // 30 seconds default for crypto data
  private readonly MAX_CACHE_SIZE = 1000; // Prevent unbounded memory growth
  private cleanupInterval?: NodeJS.Timeout;

  // In-memory stats
  private memoryStats: CacheStats = {
    hits: 0,
    misses: 0,
    size: 0,
    maxSize: 1000,
  };

  // Redis cache service
  private redisCache: RedisCacheService | null = null;
  private redisEnabled: boolean = false;
  private redisConnected: boolean = false;

  constructor() {
    this.memoryCache = new Map();
    // Start cleanup interval for in-memory cache
    this.startCleanupInterval();
  }

  /**
   * Initialize the cache service
   * Attempts to connect to Redis if enabled, falls back to in-memory
   * @returns Promise<void>
   */
  async initialize(): Promise<void> {
    const config = loadConfig();

    if (config.redisEnabled) {
      log.info('Redis enabled, attempting connection...', {
        host: config.redisHost,
        port: config.redisPort,
      });

      this.redisCache = new RedisCacheService({
        host: config.redisHost,
        port: config.redisPort,
        password: config.redisPassword,
        db: config.redisDb,
        keyPrefix: 'lazuli:',
      });

      const connected = await this.redisCache.connect();

      if (connected) {
        this.redisEnabled = true;
        this.redisConnected = true;
        log.info('Using Redis as primary cache backend');
      } else {
        log.warn('Redis connection failed, falling back to in-memory cache');
        this.redisCache = null;
        this.redisEnabled = false;
        this.redisConnected = false;
      }
    } else {
      log.info('Using in-memory cache (Redis not enabled)');
      log.debug('Set REDIS_ENABLED=true to enable Redis caching');
    }
  }

  /**
   * Check if Redis is currently the active backend
   * @returns boolean
   */
  isRedisActive(): boolean {
    return this.redisEnabled && this.redisConnected && this.redisCache !== null;
  }

  /**
   * Store data in cache with TTL
   * Implements write-through caching: stores in both Redis AND memory
   * This ensures instant reads from memory while Redis provides distributed storage
   * @param key - Cache key
   * @param data - Data to cache
   * @param ttl - Time to live in milliseconds (optional, defaults to 30s)
   */
  set<T>(key: string, data: T, ttl?: number): void {
    const effectiveTtl = ttl || this.DEFAULT_TTL;

    // Always store in memory for instant reads (write-through cache pattern)
    this.setInMemory(key, data, effectiveTtl);

    // Also store in Redis if available (async, fire and forget for performance)
    // This enables shared caching across multiple API instances
    if (this.isRedisActive()) {
      this.redisCache!.set(key, data, effectiveTtl).catch((err) => {
        log.error('Redis set error (memory cache still valid)', err, { key });
      });
    }
  }

  /**
   * Store data in the in-memory cache with LRU eviction
   * @param key - Cache key
   * @param data - Data to cache
   * @param ttl - Time to live in milliseconds
   */
  private setInMemory<T>(key: string, data: T, ttl: number): void {
    // If cache is full, evict least recently used entry
    if (this.memoryCache.size >= this.MAX_CACHE_SIZE && !this.memoryCache.has(key)) {
      this.evictLRU();
    }

    const now = Date.now();
    this.memoryCache.set(key, {
      data,
      timestamp: now,
      lastAccessed: now,
      ttl,
    });

    this.memoryStats.size = this.memoryCache.size;
  }

  /**
   * Retrieve data from cache if not expired
   * Tries Redis first if available, then falls back to in-memory
   * @param key - Cache key
   * @returns Cached data or null if expired/not found
   */
  get<T>(key: string): T | null {
    // For synchronous API compatibility, use in-memory cache
    // Redis operations are async, so we can't use them here synchronously
    // This is a design decision to maintain backwards compatibility
    // For async-first code, use getAsync() instead
    return this.getFromMemory<T>(key);
  }

  /**
   * Async version of get() that can utilize Redis
   * Prefers Redis if available, falls back to in-memory
   * @param key - Cache key
   * @returns Promise<Cached data or null>
   */
  async getAsync<T>(key: string): Promise<T | null> {
    // Try Redis first if available
    if (this.isRedisActive()) {
      try {
        const data = await this.redisCache!.get<T>(key);
        if (data !== null) {
          return data;
        }
        // Fall through to memory cache if Redis miss
      } catch (err) {
        log.error('Redis get error, checking memory', err, { key });
      }
    }

    // Fall back to in-memory cache
    return this.getFromMemory<T>(key);
  }

  /**
   * Get data from the in-memory cache
   * @param key - Cache key
   * @returns Cached data or null if expired/not found
   */
  private getFromMemory<T>(key: string): T | null {
    const entry = this.memoryCache.get(key);

    if (!entry) {
      this.memoryStats.misses++;
      return null;
    }

    // Check if entry has expired
    const now = Date.now();
    const age = now - entry.timestamp;

    if (age > entry.ttl) {
      // Entry expired, remove it
      this.memoryCache.delete(key);
      this.memoryStats.size = this.memoryCache.size;
      this.memoryStats.misses++;
      return null;
    }

    // Update last accessed time for LRU
    entry.lastAccessed = now;
    this.memoryStats.hits++;

    return entry.data as T;
  }

  /**
   * Check if a key exists and is not expired
   * @param key - Cache key
   * @returns true if key exists and not expired
   */
  has(key: string): boolean {
    return this.get(key) !== null;
  }

  /**
   * Async version of has() that can utilize Redis
   * @param key - Cache key
   * @returns Promise<boolean>
   */
  async hasAsync(key: string): Promise<boolean> {
    if (this.isRedisActive()) {
      try {
        const exists = await this.redisCache!.has(key);
        if (exists) return true;
      } catch (err) {
        log.error('Redis has error', err, { key });
      }
    }
    return this.has(key);
  }

  /**
   * Invalidate a specific cache entry
   * Removes from both Redis and in-memory cache
   * @param key - Cache key to invalidate
   */
  invalidate(key: string): void {
    // Invalidate in Redis if available
    if (this.isRedisActive()) {
      this.redisCache!.invalidate(key).catch((err) => {
        log.error('Redis invalidate error', err, { key });
      });
    }

    // Also invalidate in memory
    this.memoryCache.delete(key);
    this.memoryStats.size = this.memoryCache.size;
  }

  /**
   * Invalidate all cache entries matching a pattern
   * @param pattern - String pattern to match (e.g., 'tickers:binance:')
   */
  invalidatePattern(pattern: string): void {
    // Invalidate in Redis if available
    if (this.isRedisActive()) {
      this.redisCache!.invalidatePattern(pattern).catch((err) => {
        log.error('Redis invalidatePattern error', err, { pattern });
      });
    }

    // Invalidate matching keys in memory
    const keysToDelete: string[] = [];
    for (const key of this.memoryCache.keys()) {
      if (key.includes(pattern)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach((key) => this.memoryCache.delete(key));
    this.memoryStats.size = this.memoryCache.size;
  }

  /**
   * Clear all cache entries
   * Clears both Redis and in-memory cache
   */
  clear(): void {
    // Clear Redis if available
    if (this.isRedisActive()) {
      this.redisCache!.clear().catch((err) => {
        log.error('Redis clear error', err);
      });
    }

    // Clear in-memory cache
    this.memoryCache.clear();
    this.memoryStats.size = 0;
  }

  /**
   * Get cache statistics including hit/miss ratio
   * @returns Object with cache stats
   */
  getStats(): CacheStatsExtended {
    const total = this.memoryStats.hits + this.memoryStats.misses;
    const hitRatio = total > 0 ? this.memoryStats.hits / total : 0;

    return {
      ...this.memoryStats,
      hitRatio: Math.round(hitRatio * 100) / 100,
      keys: Array.from(this.memoryCache.keys()),
      backend: this.isRedisActive() ? 'redis' : 'memory',
      redisConnected: this.redisConnected,
    };
  }

  /**
   * Get detailed stats including Redis information
   * @returns Promise with extended cache statistics
   */
  async getDetailedStats(): Promise<CacheStatsExtended & { redisStats?: unknown }> {
    const baseStats = this.getStats();

    if (this.isRedisActive()) {
      try {
        const redisStats = await this.redisCache!.getStats();
        return {
          ...baseStats,
          redisStats,
        };
      } catch (err) {
        log.error('Error getting Redis stats', err);
      }
    }

    return baseStats;
  }

  /**
   * Evict the least recently used cache entry
   * Called when cache size reaches MAX_CACHE_SIZE
   */
  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    // Find the least recently used entry
    for (const [key, entry] of this.memoryCache.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.memoryCache.delete(oldestKey);
      log.debug('Evicted LRU entry', { key: oldestKey });
    }
  }

  /**
   * Clean up expired entries periodically
   * Runs every minute to prevent memory leaks
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const keysToDelete: string[] = [];

      for (const [key, entry] of this.memoryCache.entries()) {
        const age = now - entry.timestamp;
        if (age > entry.ttl) {
          keysToDelete.push(key);
        }
      }

      keysToDelete.forEach((key) => this.memoryCache.delete(key));

      if (keysToDelete.length > 0) {
        this.memoryStats.size = this.memoryCache.size;
        log.debug('Cleanup: removed expired entries', { count: keysToDelete.length });
      }
    }, 60000); // Run every minute
  }

  /**
   * Gracefully shut down the cache service
   * Clears intervals and disconnects from Redis
   */
  public async destroy(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    if (this.redisCache) {
      await this.redisCache.disconnect();
      this.redisCache = null;
    }

    this.clear();
    log.info('Cache service destroyed');
  }
}

// Export singleton instance
export const cacheService = new CacheService();
