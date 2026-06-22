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

    const response = await env.ASSETS.fetch(request);
    return withSecurityHeaders(response);
  },
} satisfies ExportedHandler<WebEnv>;

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')
  );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
