/**
 * Simple in-memory cache service for ticker data
 * Implements TTL (Time To Live) to ensure data freshness
 *
 * This provides significant performance improvements by:
 * - Reducing repeated API calls to exchanges
 * - Minimizing network latency
 * - Lowering load on exchange APIs (avoiding rate limits)
 */

interface CacheEntry<T> {
  data: T
  timestamp: number
  ttl: number // Time to live in milliseconds
}

export class CacheService {
  private cache: Map<string, CacheEntry<any>>
  private readonly DEFAULT_TTL = 30000 // 30 seconds default for crypto data

  constructor() {
    this.cache = new Map()
    // Clean up expired entries every minute
    this.startCleanupInterval()
  }

  /**
   * Store data in cache with TTL
   * @param key - Cache key
   * @param data - Data to cache
   * @param ttl - Time to live in milliseconds (optional, defaults to 30s)
   */
  set<T>(key: string, data: T, ttl?: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttl || this.DEFAULT_TTL,
    })
  }

  /**
   * Retrieve data from cache if not expired
   * @param key - Cache key
   * @returns Cached data or null if expired/not found
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key)

    if (!entry) {
      return null
    }

    // Check if entry has expired
    const now = Date.now()
    const age = now - entry.timestamp

    if (age > entry.ttl) {
      // Entry expired, remove it
      this.cache.delete(key)
      return null
    }

    return entry.data as T
  }

  /**
   * Check if a key exists and is not expired
   * @param key - Cache key
   * @returns true if key exists and not expired
   */
  has(key: string): boolean {
    return this.get(key) !== null
  }

  /**
   * Invalidate a specific cache entry
   * @param key - Cache key to invalidate
   */
  invalidate(key: string): void {
    this.cache.delete(key)
  }

  /**
   * Invalidate all cache entries matching a pattern
   * @param pattern - String pattern to match (e.g., 'tickers:binance:')
   */
  invalidatePattern(pattern: string): void {
    const keysToDelete: string[] = []

    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        keysToDelete.push(key)
      }
    }

    keysToDelete.forEach(key => this.cache.delete(key))
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Get cache statistics
   * @returns Object with cache stats
   */
  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    }
  }

  /**
   * Clean up expired entries periodically
   * Runs every minute to prevent memory leaks
   */
  private startCleanupInterval(): void {
    setInterval(() => {
      const now = Date.now()
      const keysToDelete: string[] = []

      for (const [key, entry] of this.cache.entries()) {
        const age = now - entry.timestamp
        if (age > entry.ttl) {
          keysToDelete.push(key)
        }
      }

      keysToDelete.forEach(key => this.cache.delete(key))

      if (keysToDelete.length > 0) {
        console.log(`Cache cleanup: removed ${keysToDelete.length} expired entries`)
      }
    }, 60000) // Run every minute
  }
}

// Export singleton instance
export const cacheService = new CacheService()
