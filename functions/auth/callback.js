import { makeSessionCookie, parseCookies } from '../_shared/session.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  const bail = (err) =>
    Response.redirect(new URL(`/?error=${err}`, request.url).href, 302);

  if (error) return bail('access_denied');
  if (!code || !state) return bail('missing_code');

  // CSRF: verify state matches the short-lived cookie
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  if (!cookies.oauth_state || cookies.oauth_state !== state) {
    return bail('invalid_state');
  }

  if (!env.SESSION_SECRET) return bail('not_configured');

  try {
    const tokenRes = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: env.STRAVA_CLIENT_ID,
        client_secret: env.STRAVA_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code'
      })
    });

    if (!tokenRes.ok) {
      console.error('Strava token exchange failed:', await tokenRes.text());
      return bail('auth_failed');
    }

    const data = await tokenRes.json();

    const session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at,
      athlete: {
        id: data.athlete.id,
        firstname: data.athlete.firstname,
        lastname: data.athlete.lastname,
        profile_medium: data.athlete.profile_medium
      }
    };

    const headers = new Headers();
    headers.set('Location', new URL('/map', request.url).href);
    // Set the encrypted session cookie and clear the temporary state cookie
    headers.append('Set-Cookie', await makeSessionCookie(session, env.SESSION_SECRET));
    headers.append('Set-Cookie', 'oauth_state=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');

    return new Response(null, { status: 302, headers });
  } catch (err) {
    console.error('OAuth callback error:', err);
    return bail('auth_failed');
  }
}
