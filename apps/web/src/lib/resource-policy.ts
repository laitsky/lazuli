export const RESOURCE_POLICY = {
  topbarPollMs: 30_000,
  healthPollMs: 5 * 60_000,
  alphaFeedPollMs: 2 * 60_000,
  visibleOrderBookPollMs: 5_000,
  topbarMediaQuery: '(min-width: 768px)',
  defaultWorkspaceLayers: '',
} as const;
