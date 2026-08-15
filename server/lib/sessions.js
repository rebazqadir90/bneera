import { randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'sid';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, sliding
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export function generateSessionId() {
  return randomBytes(32).toString('base64url');
}

export function generateResetToken() {
  return randomBytes(32).toString('base64url');
}

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

export function serializeCookie(name, value, { maxAgeMs, httpOnly = true, sameSite = 'Lax', secure = false, path = '/' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`];
  if (maxAgeMs != null) parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  if (httpOnly) parts.push('HttpOnly');
  if (sameSite) parts.push(`SameSite=${sameSite}`);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie(name, opts = {}) {
  return serializeCookie(name, '', { ...opts, maxAgeMs: 0 });
}
