import { getSession } from '../_shared/session.js';

export async function onRequestGet({ request, env }) {
  const configured = !!(env.STRAVA_CLIENT_ID && env.STRAVA_CLIENT_SECRET);
  const session = await getSession(request, env.SESSION_SECRET);

  return Response.json({
    configured,
    authenticated: !!(session?.access_token),
    athlete: session?.athlete || null
  });
}
