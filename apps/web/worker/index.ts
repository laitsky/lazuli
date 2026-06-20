/**
 * Lazuli Web Worker
 *
 * Serves the Vite SPA through Workers Static Assets and proxies same-origin
 * /api/* requests to the API Worker through a Cloudflare Service Binding.
 */

interface WebEnv {
  ASSETS: Fetcher;
  API_SERVICE: Fetcher;
}

export default {
  async fetch(request: Request, env: WebEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      return env.API_SERVICE.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<WebEnv>;
