/**
 * Request Coalescing Service
 *
 * Deduplicates simultaneous requests to the same resource.
 * When multiple clients request the same data at the same time,
 * only one actual API call is made and all waiting clients receive
 * the same result.
 *
 * Benefits:
 * - Reduces load on exchange APIs
 * - Better rate limit utilization
 * - Faster response times for subsequent requests
 * - Prevents thundering herd problems
 *
 * Example:
 * - 100 clients request BTC/USDT ticker simultaneously
 * - Without coalescing: 100 API calls to exchange
 * - With coalescing: 1 API call to exchange, result shared with all 100 clients
 */

interface PendingRequest<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: any) => void;
  timestamp: number;
  waiters: number; // Count of how many requests are waiting
}

/**
 * RequestCoalescingService
 * Manages in-flight requests and coalesces duplicates
 */
export class RequestCoalescingService {
  private pendingRequests: Map<string, PendingRequest<any>>;
  private stats: {
    totalRequests: number;
    coalescedRequests: number;
    uniqueRequests: number;
    averageWaiters: number;
  };

  constructor() {
    this.pendingRequests = new Map();
    this.stats = {
      totalRequests: 0,
      coalescedRequests: 0,
      uniqueRequests: 0,
      averageWaiters: 0,
    };
  }

  /**
   * Wrap a function with request coalescing
   * If the same key is requested while a previous request is pending,
   * return the pending request instead of making a new one
   *
   * @param key - Unique identifier for this request
   * @param fn - Function to execute if no pending request exists
   * @returns Promise that resolves with the result
   */
  async coalesce<T>(key: string, fn: () => Promise<T>): Promise<T> {
    this.stats.totalRequests++;

    // Check if there's already a pending request for this key
    const pending = this.pendingRequests.get(key);

    if (pending) {
      // Request is already in flight, wait for it
      this.stats.coalescedRequests++;
      pending.waiters++;

      console.log(`🔄 [Coalescing] Request coalesced for "${key}" (${pending.waiters} waiters)`);

      return pending.promise;
    }

    // No pending request, create a new one
    this.stats.uniqueRequests++;

    let resolveFunc: (value: T) => void;
    let rejectFunc: (error: any) => void;

    // Create a promise that we can resolve/reject externally
    const promise = new Promise<T>((resolve, reject) => {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    // Store the pending request
    const pendingRequest: PendingRequest<T> = {
      promise,
      resolve: resolveFunc!,
      reject: rejectFunc!,
      timestamp: Date.now(),
      waiters: 1, // Initial request counts as 1 waiter
    };

    this.pendingRequests.set(key, pendingRequest);

    // Execute the function
    try {
      const result = await fn();

      // Resolve all waiting requests
      pendingRequest.resolve(result);

      // Update stats
      const duration = Date.now() - pendingRequest.timestamp;
      this.updateAverageWaiters(pendingRequest.waiters);

      console.log(
        `✅ [Coalescing] Request completed for "${key}" ` +
        `(${pendingRequest.waiters} waiters served, ${duration}ms)`
      );

      return result;
    } catch (error) {
      // Reject all waiting requests
      pendingRequest.reject(error);

      console.error(`❌ [Coalescing] Request failed for "${key}":`, error);

      throw error;
    } finally {
      // Clean up the pending request
      this.pendingRequests.delete(key);
    }
  }

  /**
   * Update average waiters statistic
   */
  private updateAverageWaiters(waiters: number): void {
    const total = this.stats.averageWaiters * (this.stats.uniqueRequests - 1) + waiters;
    this.stats.averageWaiters = total / this.stats.uniqueRequests;
  }

  /**
   * Get coalescing statistics
   */
  getStats() {
    return {
      ...this.stats,
      currentPendingRequests: this.pendingRequests.size,
      coalescingRate: this.stats.totalRequests > 0
        ? this.stats.coalescedRequests / this.stats.totalRequests
        : 0,
      savingsRatio: this.stats.totalRequests > 0
        ? 1 - (this.stats.uniqueRequests / this.stats.totalRequests)
        : 0,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalRequests: 0,
      coalescedRequests: 0,
      uniqueRequests: 0,
      averageWaiters: 0,
    };
  }

  /**
   * Clear all pending requests (use with caution!)
   */
  clear(): void {
    this.pendingRequests.clear();
  }

  /**
   * Get count of currently pending requests
   */
  getPendingCount(): number {
    return this.pendingRequests.size;
  }

  /**
   * Check if a specific key has a pending request
   */
  hasPending(key: string): boolean {
    return this.pendingRequests.has(key);
  }
}

// Export singleton instance
export const requestCoalescingService = new RequestCoalescingService();
