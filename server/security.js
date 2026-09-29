import crypto from 'node:crypto';

export function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  next();
}

/** Tiny fixed-window, per-IP rate limiter (single process, in memory). */
export function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs).unref();

  return (req, res, next) => {
    const now = Date.now();
    let entry = hits.get(req.ip);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(req.ip, entry);
    }
    if (++entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
      return res.status(429).json({ error: 'too_many_requests' });
    }
    next();
  };
}

const COOKIE = 'admin_session';
const SESSION_MS = 12 * 60 * 60 * 1000;

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest();
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function createAdminAuth({ password, secret, secureCookies }) {
  const key = secret || crypto.randomBytes(32).toString('hex');
  const sign = (payload) => crypto.createHmac('sha256', key).update(payload).digest('base64url');

  function issue(res) {
    const exp = String(Date.now() + SESSION_MS);
    res.cookie(COOKIE, `${exp}.${sign(exp)}`, {
      httpOnly: true,
      sameSite: 'strict',
      secure: secureCookies,
      maxAge: SESSION_MS,
      path: '/',
    });
  }

  function isValid(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return false;
    const [exp, sig] = token.split('.');
    if (!exp || !sig || Number(exp) < Date.now()) return false;
    const expected = Buffer.from(sign(exp));
    const given = Buffer.from(sig);
    return expected.length === given.length && crypto.timingSafeEqual(expected, given);
  }

  return {
    enabled: Boolean(password),
    checkPassword: (given) => Boolean(password) && crypto.timingSafeEqual(sha256(given), sha256(password)),
    login: issue,
    logout: (res) => res.clearCookie(COOKIE, { path: '/' }),
    isValid,
    require(req, res, next) {
      if (!isValid(req)) return res.status(401).json({ error: 'unauthorized' });
      // Mutations must be JSON: blocks cross-site HTML form posts (CSRF) on top of SameSite.
      if (req.method !== 'GET' && !req.is('application/json')) {
        return res.status(415).json({ error: 'json_required' });
      }
      next();
    },
  };
}
