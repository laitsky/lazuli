export type MemoryCacheState = 'hit' | 'miss' | 'stale';

export interface MemoryCacheResult<T> {
  value: T;
  state: MemoryCacheState;
  ageMs: number;
  stored: boolean;
  refreshError?: string;
}

export interface MemoryCachePolicy {
  ttlMs: number;
  staleTtlMs: number;
}

export interface BoundedMemoryCacheOptions {
  maxEntries: number;
  maxBytes: number;
  maxEntryBytes: number;
  now?: () => number;
  sizeOf?: (value: unknown) => number;
}

interface MemoryCacheEntry<T> {
  value: T;
  updatedAt: number;
  expiresAt: number;
  staleUntil: number;
  sizeBytes: number;
}

interface CacheRead<T> {
  entry: MemoryCacheEntry<T>;
  stale: boolean;
}

const encoder = new TextEncoder();

export class BoundedMemoryCache {
  private readonly entries = new Map<string, MemoryCacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<MemoryCacheResult<unknown>>>();
  private readonly now: () => number;
  private readonly sizeOf: (value: unknown) => number;
  private totalBytes = 0;

  constructor(private readonly options: BoundedMemoryCacheOptions) {
    this.now = options.now ?? Date.now;
    this.sizeOf = options.sizeOf ?? jsonSizeBytes;
  }

  get entryCount(): number {
    return this.entries.size;
  }

  get byteCount(): number {
    return this.totalBytes;
  }

  async getOrLoad<T>(
    key: string,
    policy: MemoryCachePolicy,
    loader: () => Promise<T>
  ): Promise<MemoryCacheResult<T>> {
    const cached = this.read<T>(key);
    if (cached && !cached.stale) {
      return {
        value: cached.entry.value,
        state: 'hit',
        ageMs: Math.max(0, this.now() - cached.entry.updatedAt),
        stored: true,
      };
    }

    const existing = this.inFlight.get(key) as Promise<MemoryCacheResult<T>> | undefined;
    if (existing) {
      return existing;
    }

    const pending = this.load(key, policy, loader, cached?.entry);
    this.inFlight.set(key, pending as Promise<MemoryCacheResult<unknown>>);
    try {
      return await pending;
    } finally {
      if (this.inFlight.get(key) === pending) {
        this.inFlight.delete(key);
      }
    }
  }

  private async load<T>(
    key: string,
    policy: MemoryCachePolicy,
    loader: () => Promise<T>,
    staleEntry?: MemoryCacheEntry<T>
  ): Promise<MemoryCacheResult<T>> {
    try {
      const value = await loader();
      const stored = this.remember(key, value, policy);
      return { value, state: 'miss', ageMs: 0, stored };
    } catch (error) {
      if (!staleEntry) {
        throw error;
      }

      return {
        value: staleEntry.value,
        state: 'stale',
        ageMs: Math.max(0, this.now() - staleEntry.updatedAt),
        stored: true,
        refreshError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private read<T>(key: string): CacheRead<T> | null {
    const entry = this.entries.get(key) as MemoryCacheEntry<T> | undefined;
    if (!entry) return null;

    const now = this.now();
    if (now > entry.staleUntil) {
      this.remove(key, entry);
      return null;
    }

    this.entries.delete(key);
    this.entries.set(key, entry as MemoryCacheEntry<unknown>);
    return { entry, stale: now > entry.expiresAt };
  }

  private remember<T>(key: string, value: T, policy: MemoryCachePolicy): boolean {
    const sizeBytes = this.sizeOf(value);
    if (sizeBytes > this.options.maxEntryBytes || sizeBytes > this.options.maxBytes) {
      return false;
    }

    const existing = this.entries.get(key);
    if (existing) {
      this.remove(key, existing);
    }

    const now = this.now();
    const entry: MemoryCacheEntry<T> = {
      value,
      updatedAt: now,
      expiresAt: now + Math.max(0, policy.ttlMs),
      staleUntil: now + Math.max(policy.ttlMs, policy.staleTtlMs),
      sizeBytes,
    };
    this.entries.set(key, entry as MemoryCacheEntry<unknown>);
    this.totalBytes += sizeBytes;
    this.evictToLimits();
    return this.entries.has(key);
  }

  private evictToLimits(): void {
    while (this.entries.size > this.options.maxEntries || this.totalBytes > this.options.maxBytes) {
      const oldest = this.entries.entries().next().value as
        | [string, MemoryCacheEntry<unknown>]
        | undefined;
      if (!oldest) return;
      this.remove(oldest[0], oldest[1]);
    }
  }

  private remove(key: string, entry: MemoryCacheEntry<unknown>): void {
    if (!this.entries.delete(key)) return;
    this.totalBytes = Math.max(0, this.totalBytes - entry.sizeBytes);
  }
}

function jsonSizeBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength;
}
