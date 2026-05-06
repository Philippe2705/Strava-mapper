import { clearSessionCookie } from './_shared/session.js';

export async function onRequestGet({ request }) {
  const headers = new Headers();
  headers.set('Location', new URL('/', request.url).href);
  headers.set('Set-Cookie', clearSessionCookie());
  return new Response(null, { status: 302, headers });
}
