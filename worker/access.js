// Who may open the admin panel: Cloudflare Access.
//
// Access sits in front of /admin and /api/admin/* (set up in the Cloudflare dashboard, see
// worker/README.md). Before a request gets through, Cloudflare asks for a one-time code sent
// by email, then passes a signed token (a JWT) along with the request. There's no password
// to guess or steal.
//
// The Worker checks that token itself on every admin request: Cloudflare's signature, that
// it was issued for this site's Access application, that it hasn't expired, and that the
// email in it is one of ADMIN_EMAILS. So the data stays closed even if the Access settings
// in the dashboard are ever changed by mistake.

const utf8 = new TextEncoder();
const CACHE_MS = 60 * 60 * 1000; // Cloudflare rotates its signing keys every few weeks
const LEEWAY_S = 30; // clock differences between Cloudflare's machines

/** The Access settings from the Worker's secrets, or null while they aren't all set. */
export function accessSettings(env) {
  const team = String(env.ACCESS_TEAM_DOMAIN || '').trim().replace(/\/+$/, '');
  const aud = String(env.ACCESS_AUD || '').trim();
  const emails = String(env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!team || !aud || !emails.length) return null;
  const issuer = /^https?:\/\//.test(team) ? team : `https://${team}`;
  // Cloudflare's keys only ever come over HTTPS (plain http only for a test server on this machine).
  if (!/^https:\/\//.test(issuer) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(issuer)) return null;
  return { issuer, certsUrl: `${issuer}/cdn-cgi/access/certs`, aud, emails };
}

function bytes(base64url) {
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const part = (s) => JSON.parse(new TextDecoder().decode(bytes(s)));

function cookie(request, name) {
  for (const pair of (request.headers.get('Cookie') || '').split(';')) {
    const i = pair.indexOf('=');
    if (i > 0 && pair.slice(0, i).trim() === name) return pair.slice(i + 1).trim();
  }
  return '';
}

let keyCache = { url: '', at: 0, keys: [] };

async function signingKeys(url, fetchImpl, fresh) {
  if (!fresh && keyCache.url === url && Date.now() - keyCache.at < CACHE_MS) return keyCache.keys;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Access keys: HTTP ${res.status}`);
  const { keys } = await res.json();
  keyCache = { url, at: Date.now(), keys: Array.isArray(keys) ? keys : [] };
  return keyCache.keys;
}

/**
 * The signed-in admin ({ email }) when the request carries a valid Access token for these
 * settings, otherwise null.
 */
export async function verifyAccess(request, settings, { fetch: fetchImpl = fetch, now = Date.now() } = {}) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion') || cookie(request, 'CF_Authorization');
  const pieces = token.split('.');
  if (pieces.length !== 3) return null;

  let header, claims;
  try {
    header = part(pieces[0]);
    claims = part(pieces[1]);
  } catch {
    return null;
  }
  if (header?.alg !== 'RS256' || typeof header.kid !== 'string' || !claims || typeof claims !== 'object') return null;

  let jwk = (await signingKeys(settings.certsUrl, fetchImpl, false)).find((k) => k.kid === header.kid);
  // A key we haven't seen: Cloudflare may have just rotated them.
  jwk ??= (await signingKeys(settings.certsUrl, fetchImpl, true)).find((k) => k.kid === header.kid);
  if (!jwk || jwk.kty !== 'RSA') return null;

  let valid = false;
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, bytes(pieces[2]), utf8.encode(`${pieces[0]}.${pieces[1]}`));
  } catch {
    return null;
  }
  if (!valid) return null;

  const t = Math.floor(now / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(settings.aud)) return null;
  if (claims.iss !== settings.issuer) return null;
  if (typeof claims.exp !== 'number' || claims.exp + LEEWAY_S < t) return null;
  if (typeof claims.nbf === 'number' && claims.nbf - LEEWAY_S > t) return null;

  const email = String(claims.email || '').toLowerCase();
  if (!settings.emails.includes(email)) return null;
  return { email };
}
