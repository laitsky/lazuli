/**
 * Lazuli Web Worker
 *
 * Serves the Vite SPA through Workers Static Assets and proxies same-origin
 * /api/* requests to the API Worker through a Cloudflare Service Binding.
 */

import { verifyCloudflareAccessJwt } from '../src/lib/access';

interface WebEnv {
  ASSETS: Fetcher;
  API_SERVICE: Fetcher;
  METRICS_INGEST_SECRET?: string;
  METRICS_INGEST_SECRET_ID?: string;
  ENVIRONMENT?: 'local' | 'staging' | 'production';
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  OPERATIONAL_OWNER_EMAIL?: string;
  OPS_READ_SECRET?: string;
}

export default {
  async fetch(request: Request, env: WebEnv, executionCtx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/ops' || url.pathname.startsWith('/ops/')) {
      if (!(await authorizeOpsRequest(request, env))) {
        return withSecurityHeaders(
          new Response('Operational access is required.', {
            status: 403,
            headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
          })
        );
      }
      if (url.pathname === '/ops/api/dashboard') {
        if (!env.OPS_READ_SECRET) {
          return Response.json(
            { error: 'Operational data binding is unavailable' },
            { status: 503 }
          );
        }
        const minutes = url.searchParams.get('minutes') ?? '90';
        const response = await env.API_SERVICE.fetch(
          `https://api/internal/ops/dashboard?minutes=${encodeURIComponent(minutes)}`,
          { headers: { 'X-Ops-Read-Secret': env.OPS_READ_SECRET } }
        );
        const headers = new Headers(response.headers);
        headers.set('Cache-Control', 'no-store');
        return withSecurityHeaders(
          new Response(response.body, { status: response.status, headers })
        );
      }
    }

    if (url.pathname.startsWith('/api/')) {
      return env.API_SERVICE.fetch(request);
    }

    if (url.pathname === '/robots.txt') {
      return new Response(
        `User-agent: *\nAllow: /\nDisallow: /ops\nSitemap: ${url.origin}/sitemap.xml\n`,
        {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
          },
        }
      );
    }

    if (url.pathname === '/sitemap.xml') {
      return xmlResponse(
        `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[
          'static',
          'markets',
          'signals',
        ]
          .map((name) => `<sitemap><loc>${url.origin}/sitemaps/${name}.xml</loc></sitemap>`)
          .join('')}</sitemapindex>`,
        3600
      );
    }

    if (url.pathname.startsWith('/sitemaps/')) {
      return buildSitemap(url, env);
    }

    const response = await env.ASSETS.fetch(request);
    if (!isSeoPath(url.pathname) || !response.headers.get('Content-Type')?.includes('text/html')) {
      return withSecurityHeaders(response);
    }

    const metadata = await loadSeoMetadata(url, env);
    if (!metadata) {
      return withSecurityHeaders(
        new Response('Not found', {
          status: 404,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        })
      );
    }
    if (env.METRICS_INGEST_SECRET) {
      const timestamp = Date.now();
      const body = JSON.stringify({
        metric: 'seo_landings',
        value: 1,
        dimensions: { route: seoRouteClass(url.pathname) },
      });
      executionCtx.waitUntil(
        signInternalMetric(env.METRICS_INGEST_SECRET, timestamp, body).then((signature) =>
          env.API_SERVICE.fetch('https://api/internal/metrics/event', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Lazuli-Key-Id': env.METRICS_INGEST_SECRET_ID?.trim() || 'metrics-current',
              'X-Lazuli-Timestamp': String(timestamp),
              'X-Lazuli-Signature': signature,
            },
            body,
          })
        )
      );
    }
    const transformed = new HTMLRewriter()
      .on('title', { element: (element) => element.setInnerContent(metadata.title) })
      .on('meta[name="description"]', {
        element: (element) => element.setAttribute('content', metadata.description),
      })
      .on('meta[property="og:title"]', {
        element: (element) => element.setAttribute('content', metadata.title),
      })
      .on('meta[property="og:description"]', {
        element: (element) => element.setAttribute('content', metadata.description),
      })
      .on('meta[property="og:image"]', {
        element: (element) => element.setAttribute('content', metadata.image),
      })
      .on('meta[name="twitter:title"]', {
        element: (element) => element.setAttribute('content', metadata.title),
      })
      .on('meta[name="twitter:description"]', {
        element: (element) => element.setAttribute('content', metadata.description),
      })
      .on('meta[name="twitter:image"]', {
        element: (element) => element.setAttribute('content', metadata.image),
      })
      .on('head', {
        element: (element) => {
          element.append(`<link rel="canonical" href="${escapeHtml(metadata.canonical)}">`, {
            html: true,
          });
          element.append(
            `<meta property="og:url" content="${escapeHtml(metadata.canonical)}"><script type="application/ld+json">${safeJson(metadata.jsonLd)}</script>`,
            { html: true }
          );
        },
      })
      .transform(response);
    return withSecurityHeaders(
      metadata.httpStatus
        ? new Response(transformed.body, {
            status: metadata.httpStatus,
            headers: transformed.headers,
          })
        : transformed
    );
  },
} satisfies ExportedHandler<WebEnv>;

async function authorizeOpsRequest(request: Request, env: WebEnv): Promise<boolean> {
  if (!env.ENVIRONMENT || env.ENVIRONMENT === 'local') return true;
  if (!env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD || !env.OPERATIONAL_OWNER_EMAIL) {
    return false;
  }
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return false;
  return verifyCloudflareAccessJwt(token, {
    teamDomain: env.CF_ACCESS_TEAM_DOMAIN,
    audience: env.CF_ACCESS_AUD,
    ownerEmail: env.OPERATIONAL_OWNER_EMAIL,
  });
}

async function signInternalMetric(
  secret: string,
  timestamp: number,
  body: string
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const bytes = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${body}`)
  );
  const hex = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  );
  return `sha256=${hex}`;
}

interface SeoMetadata {
  title: string;
  description: string;
  canonical: string;
  image: string;
  jsonLd: Record<string, unknown>;
  httpStatus?: 410;
}

const STATIC_ROUTES = [
  '/',
  '/markets',
  '/screener',
  '/exchanges',
  '/alpha-feed',
  '/institutional',
  '/etf-flows',
  '/options',
  '/funding',
  '/funding-arbitrage',
  '/price-arbitrage',
  '/signal-lab',
];

function isSeoPath(pathname: string): boolean {
  return (
    /^\/markets\/[^/]+\/[^/]+$/.test(pathname) ||
    /^\/exchanges\/[^/]+$/.test(pathname) ||
    /^\/signals\/[^/]+$/.test(pathname)
  );
}

function seoRouteClass(pathname: string): string {
  if (pathname.startsWith('/markets/')) return 'market';
  if (pathname.startsWith('/exchanges/')) return 'exchange';
  return 'signal';
}

async function loadSeoMetadata(url: URL, env: WebEnv): Promise<SeoMetadata | null> {
  const market = url.pathname.match(/^\/markets\/([^/]+)\/([^/]+)$/);
  if (market) {
    const exchange = decodeURIComponent(market[1]!).toLowerCase();
    const symbol = decodeURIComponent(market[2]!);
    const response = await env.API_SERVICE.fetch(
      `https://api/api/v1/tickers/${encodeURIComponent(exchange)}/${encodeURIComponent(symbol)}`
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      data?: { last?: number | null; percentage24h?: number | null };
    };
    const price = payload.data?.last;
    const change = payload.data?.percentage24h;
    const title = `${symbol} on ${exchange.toUpperCase()} — Live Market Intelligence | Lazuli`;
    const description = `${symbol} live price${typeof price === 'number' ? ` ${price}` : ''}${typeof change === 'number' ? `, ${change >= 0 ? '+' : ''}${change.toFixed(2)}% over 24h` : ''}, derivatives, liquidity, and transparent signals.`;
    return {
      title,
      description,
      canonical: `${url.origin}${url.pathname}`,
      image: `${url.origin}/api/v1/snapshots/market/${encodeURIComponent(exchange)}/${encodeURIComponent(symbol)}/og.png`,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'Dataset',
        name: `${symbol} market data on ${exchange}`,
        description,
        url: `${url.origin}${url.pathname}`,
        isAccessibleForFree: true,
        creator: { '@type': 'Organization', name: 'Lazuli' },
      },
    };
  }

  const exchangeMatch = url.pathname.match(/^\/exchanges\/([^/]+)$/);
  if (exchangeMatch) {
    const exchangeSlug = decodeURIComponent(exchangeMatch[1]!).toLowerCase();
    if (!['binance', 'bybit', 'okx', 'hyperliquid', 'upbit'].includes(exchangeSlug)) {
      return null;
    }
    const exchange = exchangeSlug.toUpperCase();
    const description = `Live ${exchange} spot and derivatives markets, volume, funding, liquidity, and transparent market intelligence.`;
    return {
      title: `${exchange} Markets and Intelligence | Lazuli`,
      description,
      canonical: `${url.origin}${url.pathname}`,
      image: `${url.origin}/og-image.svg`,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: `${exchange} markets`,
        description,
        url: `${url.origin}${url.pathname}`,
        isAccessibleForFree: true,
      },
    };
  }

  const signal = url.pathname.match(/^\/signals\/([^/]+)$/);
  if (signal) {
    const id = decodeURIComponent(signal[1]!);
    const response = await env.API_SERVICE.fetch(
      `https://api/api/v1/alpha-feed/${encodeURIComponent(id)}`
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      data?: { title?: string; summary?: string; expired?: boolean };
    };
    const title = `${payload.data?.title ?? 'Market Signal'} | Lazuli Alpha Feed`;
    const description = payload.data?.summary ?? 'Transparent public market signal from Lazuli.';
    return {
      title,
      description,
      canonical: `${url.origin}${url.pathname}`,
      image: `${url.origin}/api/v1/snapshots/signal/${encodeURIComponent(id)}/og.png`,
      ...(payload.data?.expired ? { httpStatus: 410 as const } : {}),
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: payload.data?.title ?? 'Market Signal',
        description,
        url: `${url.origin}${url.pathname}`,
        isAccessibleForFree: true,
        publisher: { '@type': 'Organization', name: 'Lazuli' },
      },
    };
  }
  return null;
}

async function buildSitemap(url: URL, env: WebEnv): Promise<Response> {
  if (url.pathname === '/sitemaps/static.xml') {
    return urlSetResponse(url.origin, STATIC_ROUTES, 3600);
  }
  if (url.pathname === '/sitemaps/markets.xml') {
    const exchanges = ['binance', 'bybit', 'okx', 'hyperliquid', 'upbit'];
    const paths: string[] = [];
    await Promise.all(
      exchanges.map(async (exchange) => {
        const response = await env.API_SERVICE.fetch(
          `https://api/api/v1/tickers/${exchange}?limit=500&sortBy=volume&sortOrder=desc`
        );
        if (!response.ok) return;
        const payload = (await response.json()) as {
          data?: { tickers?: Array<{ symbol: string }> };
        };
        for (const ticker of payload.data?.tickers ?? []) {
          paths.push(`/markets/${exchange}/${encodeURIComponent(ticker.symbol)}`);
        }
      })
    );
    return urlSetResponse(url.origin, paths.sort(), 900);
  }
  if (url.pathname === '/sitemaps/signals.xml') {
    const response = await env.API_SERVICE.fetch('https://api/api/v1/alpha-feed?limit=50');
    if (!response.ok) return urlSetResponse(url.origin, [], 300);
    const payload = (await response.json()) as { data?: { items?: Array<{ id: string }> } };
    return urlSetResponse(
      url.origin,
      (payload.data?.items ?? []).map((item) => `/signals/${encodeURIComponent(item.id)}`),
      300
    );
  }
  return new Response('Not found', { status: 404 });
}

function urlSetResponse(origin: string, paths: string[], maxAge: number): Response {
  return xmlResponse(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths
      .map((path) => `<url><loc>${escapeHtml(`${origin}${path}`)}</loc></url>`)
      .join('')}</urlset>`,
    maxAge
  );
}

function xmlResponse(body: string, maxAge: number): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': `public, max-age=${maxAge}, stale-while-revalidate=${maxAge}`,
    },
  });
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data:",
      "font-src 'self' https://fonts.gstatic.com",
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
