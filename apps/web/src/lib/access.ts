interface AccessClaims {
  aud?: string | string[];
  email?: string;
  exp?: number;
  nbf?: number;
  iss?: string;
}

interface AccessHeader {
  alg?: string;
  kid?: string;
}

interface AccessJwk extends JsonWebKey {
  kid?: string;
}

interface JwksResponse {
  keys?: AccessJwk[];
}

const jwksCache = new Map<string, { expiresAt: number; keys: AccessJwk[] }>();

export interface AccessConfiguration {
  teamDomain: string;
  audience: string;
  ownerEmail: string;
}

export async function verifyCloudflareAccessJwt(
  token: string,
  configuration: AccessConfiguration,
  fetchImplementation: typeof fetch = fetch,
  nowSeconds = Math.floor(Date.now() / 1_000)
): Promise<boolean> {
  try {
    const [encodedHeader, encodedPayload, encodedSignature, extra] = token.split('.');
    if (!encodedHeader || !encodedPayload || !encodedSignature || extra) return false;
    const header = JSON.parse(decodeBase64Url(encodedHeader)) as AccessHeader;
    const claims = JSON.parse(decodeBase64Url(encodedPayload)) as AccessClaims;
    if (header.alg !== 'RS256' || !header.kid) return false;
    if (!claims.exp || claims.exp <= nowSeconds || (claims.nbf && claims.nbf > nowSeconds)) {
      return false;
    }
    const issuer = `https://${configuration.teamDomain.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
    if (claims.iss?.replace(/\/$/, '') !== issuer) return false;
    const audiences = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
    if (!audiences.includes(configuration.audience)) return false;
    if (claims.email?.trim().toLowerCase() !== configuration.ownerEmail.trim().toLowerCase()) {
      return false;
    }
    const keys = await loadJwks(configuration.teamDomain, fetchImplementation);
    const jwk = keys.find((candidate) => candidate.kid === header.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const signature = Uint8Array.from(decodeBase64UrlBytes(encodedSignature)).buffer;
    return crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      signature,
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
    );
  } catch {
    return false;
  }
}

async function loadJwks(
  teamDomain: string,
  fetchImplementation: typeof fetch
): Promise<AccessJwk[]> {
  const domain = teamDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const cached = jwksCache.get(domain);
  if (cached && cached.expiresAt > Date.now()) return cached.keys;
  const response = await fetchImplementation(`https://${domain}/cdn-cgi/access/certs`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Access JWKS returned ${response.status}`);
  const payload = (await response.json()) as JwksResponse;
  const keys = Array.isArray(payload.keys) ? payload.keys : [];
  if (keys.length === 0) throw new Error('Access JWKS is empty');
  jwksCache.set(domain, { keys, expiresAt: Date.now() + 60 * 60_000 });
  return keys;
}

function decodeBase64Url(value: string): string {
  return new TextDecoder().decode(decodeBase64UrlBytes(value));
}

function decodeBase64UrlBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}
