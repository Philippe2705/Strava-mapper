/**
 * AES-GCM encrypted cookie sessions using the Web Crypto API.
 * Works in both Cloudflare Workers and modern browsers.
 */

const COOKIE_NAME = 'sm_sess';
const SALT = new TextEncoder().encode('strava-mapper-v1');

async function deriveKey(secret) {
  const raw = new TextEncoder().encode(secret);
  const imported = await crypto.subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: SALT, iterations: 100_000, hash: 'SHA-256' },
    imported,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function toBase64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function fromBase64url(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

async function encryptSession(data, secret) {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  const payload = JSON.stringify({ iv: toBase64url(iv), ct: toBase64url(ciphertext) });
  return toBase64url(new TextEncoder().encode(payload));
}

async function decryptSession(token, secret) {
  try {
    const json = new TextDecoder().decode(fromBase64url(token));
    const { iv, ct } = JSON.parse(json);
    const key = await deriveKey(secret);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64url(iv) },
      key,
      fromBase64url(ct)
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    return null;
  }
}

export function parseCookies(header) {
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').map(c => {
      const idx = c.indexOf('=');
      if (idx < 0) return [c.trim(), ''];
      return [c.slice(0, idx).trim(), decodeURIComponent(c.slice(idx + 1).trim())];
    })
  );
}

export async function getSession(request, secret) {
  if (!secret) return null;
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  return decryptSession(token, secret);
}

export async function makeSessionCookie(session, secret) {
  const token = await encryptSession(session, secret);
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 3600}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}
