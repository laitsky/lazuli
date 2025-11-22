/**
 * Simple in-memory cache service for ticker data
 * Implements TTL (Time To Live) to ensure data freshness
 * Includes LRU eviction and max size limits
 *
 * This provides significant performance improvements by:
 * - Reducing repeated API calls to exchanges
 * - Minimizing network latency
 * - Lowering load on exchange APIs (avoiding rate limits)
 *
 * IMPORTANT: For production, consider using Redis for distributed caching
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
  lastAccessed: number; // For LRU tracking
}

interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  maxSize: number;
}

export class CacheService {
  private cache: Map<string, CacheEntry<any>>;
  private readonly DEFAULT_TTL = 30000; // 30 seconds default for crypto data
  private readonly MAX_CACHE_SIZE = 1000; // Prevent unbounded memory growth
  private cleanupInterval?: NodeJS.Timeout;
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    size: 0,
    maxSize: this.MAX_CACHE_SIZE,
  };

  constructor() {
    this.cache = new Map();
    // Clean up expired entries every minute
    this.startCleanupInterval();
  }

  /**
   * Store data in cache with TTL
   * Implements LRU eviction if cache is full
   * @param key - Cache key
   * @param data - Data to cache
   * @param ttl - Time to live in milliseconds (optional, defaults to 30s)
   */
  set<T>(key: string, data: T, ttl?: number): void {
    // If cache is full, evict least recently used entry
    if (this.cache.size >= this.MAX_CACHE_SIZE && !this.cache.has(key)) {
      this.evictLRU();
    }

    const now = Date.now();
    this.cache.set(key, {
      data,
      timestamp: now,
      lastAccessed: now,
      ttl: ttl || this.DEFAULT_TTL,
    });

    this.stats.size = this.cache.size;
  }

  /**
   * Retrieve data from cache if not expired
   * Updates last accessed time for LRU
   * @param key - Cache key
   * @returns Cached data or null if expired/not found
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Check if entry has expired
    const now = Date.now();
    const age = now - entry.timestamp;

    if (age > entry.ttl) {
      // Entry expired, remove it
      this.cache.delete(key);
      this.stats.size = this.cache.size;
      this.stats.misses++;
      return null;
    }

    // Update last accessed time for LRU
    entry.lastAccessed = now;
    this.stats.hits++;

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
   * Invalidate a specific cache entry
   * @param key - Cache key to invalidate
   */
  invalidate(key: string): void {
    this.cache.delete(key);
    this.stats.size = this.cache.size;
  }

  /**
   * Invalidate all cache entries matching a pattern
   * @param pattern - String pattern to match (e.g., 'tickers:binance:')
   */
  invalidatePattern(pattern: string): void {
    const keysToDelete: string[] = [];

    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach((key) => this.cache.delete(key));
    this.stats.size = this.cache.size;
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    this.stats.size = 0;
  }

  /**
   * Get cache statistics including hit/miss ratio
   * @returns Object with cache stats
   */
  getStats(): CacheStats & { hitRatio: number; keys: string[] } {
    const total = this.stats.hits + this.stats.misses;
    const hitRatio = total > 0 ? this.stats.hits / total : 0;

    return {
      ...this.stats,
      hitRatio: Math.round(hitRatio * 100) / 100,
      keys: Array.from(this.cache.keys()),
    };
  }

  /**
   * Evict the least recently used cache entry
   * Called when cache size reaches MAX_CACHE_SIZE
   */
  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    // Find the least recently used entry
    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      console.log(`Cache: Evicted LRU entry "${oldestKey}"`);
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

      for (const [key, entry] of this.cache.entries()) {
        const age = now - entry.timestamp;
        if (age > entry.ttl) {
          keysToDelete.push(key);
        }
      }

      keysToDelete.forEach((key) => this.cache.delete(key));

      if (keysToDelete.length > 0) {
        this.stats.size = this.cache.size;
        console.log(`Cache cleanup: removed ${keysToDelete.length} expired entries`);
      }
    }, 60000); // Run every minute
  }

  /**
   * Gracefully shut down the cache service
   * Clears the cleanup interval to prevent memory leaks
   */
  public destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    this.clear();
    console.log('Cache service destroyed');
  }
}

// Export singleton instance
export const cacheService = new CacheService();
