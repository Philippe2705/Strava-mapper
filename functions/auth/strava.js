import { parseCookies } from '../_shared/session.js';

export async function onRequestGet({ request, env }) {
  if (!env.STRAVA_CLIENT_ID || !env.STRAVA_CLIENT_SECRET) {
    return Response.redirect(new URL('/?error=not_configured', request.url).href, 302);
  }

  const state = crypto.randomUUID();
  const origin = new URL(request.url).origin;

  const params = new URLSearchParams({
    client_id: env.STRAVA_CLIENT_ID,
    redirect_uri: `${origin}/auth/callback`,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'read,activity:read_all',
    state
  });

  const headers = new Headers();
  headers.set('Location', `https://www.strava.com/oauth/authorize?${params}`);
  // Store state in a short-lived httpOnly cookie for CSRF validation
  headers.set('Set-Cookie', `oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`);

  return new Response(null, { status: 302, headers });
}
