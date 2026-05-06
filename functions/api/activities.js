import { getSession, makeSessionCookie } from '../_shared/session.js';

async function refreshIfNeeded(session, env) {
  const now = Math.floor(Date.now() / 1000);
  if (session.expires_at && now < session.expires_at - 300) {
    return { session, refreshed: false };
  }

  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
      refresh_token: session.refresh_token,
      grant_type: 'refresh_token'
    })
  });

  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);

  const data = await res.json();
  return {
    session: { ...session, access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at },
    refreshed: true
  };
}

export async function onRequestGet({ request, env }) {
  const session = await getSession(request, env.SESSION_SECRET);
  if (!session?.access_token) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let current, refreshed;
  try {
    ({ session: current, refreshed } = await refreshIfNeeded(session, env));
  } catch {
    return Response.json({ error: 'Token refresh failed' }, { status: 401 });
  }

  const reqUrl = new URL(request.url);
  const page = Math.max(1, parseInt(reqUrl.searchParams.get('page') || '1', 10));
  const perPage = Math.min(Math.max(1, parseInt(reqUrl.searchParams.get('per_page') || '100', 10)), 200);

  const stravaUrl = new URL('https://www.strava.com/api/v3/athlete/activities');
  stravaUrl.searchParams.set('page', String(page));
  stravaUrl.searchParams.set('per_page', String(perPage));

  const stravaRes = await fetch(stravaUrl.href, {
    headers: { Authorization: `Bearer ${current.access_token}` }
  });

  if (stravaRes.status === 429) {
    const retryAfter = stravaRes.headers.get('x-ratelimit-reset') || '60';
    return Response.json(
      { error: 'Rate limit exceeded', retryAfter: parseInt(retryAfter, 10) },
      { status: 429 }
    );
  }

  if (!stravaRes.ok) {
    return Response.json({ error: 'Failed to fetch activities' }, { status: 500 });
  }

  const activities = await stravaRes.json();

  const headers = new Headers({ 'Content-Type': 'application/json' });
  // If the token was refreshed, send the updated session cookie back
  if (refreshed) {
    headers.set('Set-Cookie', await makeSessionCookie(current, env.SESSION_SECRET));
  }

  return new Response(JSON.stringify(activities), { status: 200, headers });
}
