/**
 * User preferences — persisted UI state
 *
 * Stored in localStorage as a single JSON blob under LAZULI_PREFS.
 * Read once on init, written on every change. Cheap and synchronous.
 *
 * Preferences object is intentionally small — only things the user
 * explicitly chooses. Application state (current symbol, filters)
 * lives in URL via nuqs, not here.
 */

import { useEffect, useSyncExternalStore } from 'react';

export type AccentVariant = 'lapis' | 'amber' | 'emerald' | 'magenta';
export type DensityMode = 'comfortable' | 'compact';
export type RefreshInterval = 0 | 10_000 | 30_000 | 60_000;

export interface Preferences {
  /** Accent color variant — drives [data-accent] on <html> */
  accent: AccentVariant;
  /** Layout density — drives [data-density] on <html> */
  density: DensityMode;
  /** Default exchange for new sessions (when URL has no exchange param) */
  defaultExchange: string;
  /** Auto-refresh interval for live data. 0 = manual only. */
  refreshInterval: RefreshInterval;
  /** User's starred symbols, in order. Stored as `EXCHANGE:SYMBOL` strings. */
  watchlist: string[];
  /** Recently viewed symbols (most recent first), max 12 */
  recents: string[];
  /** Custom table view presets, keyed by page */
  viewPresets: Record<string, ViewPreset>;
  /** Has the user dismissed the welcome/intro toast? */
  hasSeenIntro: boolean;
}

export interface ViewPreset {
  /** Column ids that are visible */
  columns: string[];
  /** Sort config */
  sort?: { column: string; direction: 'asc' | 'desc' };
}

const STORAGE_KEY = 'lazuli.prefs.v1';
const RECENTS_MAX = 12;
const WATCHLIST_MAX = 100;

const DEFAULTS: Preferences = {
  accent: 'lapis',
  density: 'comfortable',
  defaultExchange: 'bybit',
  refreshInterval: 10_000,
  watchlist: [],
  recents: [],
  viewPresets: {},
  hasSeenIntro: false,
};

/* ============================================================
   External store — single source of truth, subscription-based.
   useSyncExternalStore gives us concurrent-safe reads.
   ============================================================ */

let currentPrefs: Preferences = loadPrefs();
const subscribers = new Set<() => void>();

function loadPrefs(): Preferences {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    // Merge with defaults so new fields don't break old saved state
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

function persist(next: Preferences): void {
  currentPrefs = next;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // QuotaExceededError — silently drop, not user-facing
    }
  }
  subscribers.forEach((cb) => cb());
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

function getSnapshot(): Preferences {
  return currentPrefs;
}

/* ============================================================
   Public hook — read + actions
   ============================================================ */

export function usePreferences(): Preferences & PreferenceActions {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { ...prefs, ...actions };
}

export interface PreferenceActions {
  setAccent: (accent: AccentVariant) => void;
  setDensity: (density: DensityMode) => void;
  setDefaultExchange: (exchange: string) => void;
  setRefreshInterval: (interval: RefreshInterval) => void;
  toggleWatchlist: (key: string) => void;
  replaceWatchlist: (items: string[]) => void;
  isWatched: (key: string) => boolean;
  addRecent: (key: string) => void;
  clearRecents: () => void;
  saveViewPreset: (page: string, preset: ViewPreset) => void;
  dismissIntro: () => void;
  reset: () => void;
}

const actions: PreferenceActions = {
  setAccent: (accent) => persist({ ...currentPrefs, accent }),
  setDensity: (density) => persist({ ...currentPrefs, density }),
  setDefaultExchange: (defaultExchange) => persist({ ...currentPrefs, defaultExchange }),
  setRefreshInterval: (refreshInterval) => persist({ ...currentPrefs, refreshInterval }),
  toggleWatchlist: (key) => {
    const next = currentPrefs.watchlist.includes(key)
      ? currentPrefs.watchlist.filter((w) => w !== key)
      : [key, ...currentPrefs.watchlist].slice(0, WATCHLIST_MAX);
    persist({ ...currentPrefs, watchlist: next });
  },
  replaceWatchlist: (items) =>
    persist({
      ...currentPrefs,
      watchlist: Array.from(new Set(items.map((item) => item.trim()).filter(Boolean))).slice(
        0,
        WATCHLIST_MAX
      ),
    }),
  isWatched: (key) => currentPrefs.watchlist.includes(key),
  addRecent: (key) => {
    const next = [key, ...currentPrefs.recents.filter((r) => r !== key)].slice(0, RECENTS_MAX);
    persist({ ...currentPrefs, recents: next });
  },
  clearRecents: () => persist({ ...currentPrefs, recents: [] }),
  saveViewPreset: (page, preset) =>
    persist({ ...currentPrefs, viewPresets: { ...currentPrefs.viewPresets, [page]: preset } }),
  dismissIntro: () => persist({ ...currentPrefs, hasSeenIntro: true }),
  reset: () => persist({ ...DEFAULTS }),
};

/* ============================================================
   Preference application hook — syncs prefs to <html> attributes.
   Mount once in AppFrame.
   ============================================================ */

export function useApplyPreferences(): void {
  const { accent, density } = usePreferences();
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.accent = accent;
    document.documentElement.dataset.density = density;
  }, [accent, density]);
}

/** Build the watchlist key for an exchange:symbol pair */
export function watchlistKey(exchange: string, symbol: string): string {
  return `${exchange}:${symbol}`;
}

/** Parse a watchlist key into [exchange, symbol] */
export function parseWatchlistKey(key: string): [string, string] {
  const idx = key.indexOf(':');
  if (idx === -1) return ['', key];
  return [key.slice(0, idx), key.slice(idx + 1)];
}
