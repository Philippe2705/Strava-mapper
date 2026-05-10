'use strict';

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-to-a-random-string-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // set true if serving over HTTPS
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000 // 1 week
  }
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function getBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

/**
 * Refresh the Strava access token if it is about to expire (< 5 min left).
 * Mutates req.session in place and returns the valid access token.
 */
async function ensureValidToken(req) {
  const now = Math.floor(Date.now() / 1000);
  if (!req.session.expires_at || now > req.session.expires_at - 300) {
    const response = await axios.post('https://www.strava.com/oauth/token', {
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      refresh_token: req.session.refresh_token,
      grant_type: 'refresh_token'
    });
    req.session.access_token = response.data.access_token;
    req.session.refresh_token = response.data.refresh_token;
    req.session.expires_at = response.data.expires_at;
  }
  return req.session.access_token;
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Landing / setup page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Protected map page — redirect to home if not authenticated
app.get('/map', (req, res) => {
  if (!req.session.access_token) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'map.html'));
});

// Returns app configuration and auth state to the frontend
app.get('/api/config', (req, res) => {
  res.json({
    configured: !!(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET),
    authenticated: !!(req.session.access_token),
    athlete: req.session.athlete || null
  });
});

// Initiate Strava OAuth — generates a random state value for CSRF protection
app.get('/auth/strava', (req, res) => {
  if (!process.env.STRAVA_CLIENT_ID || !process.env.STRAVA_CLIENT_SECRET) {
    return res.redirect('/?error=not_configured');
  }

  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauth_state = state;

  const params = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID,
    redirect_uri: `${getBaseUrl(req)}/auth/callback`,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'read,activity:read_all',
    state
  });

  res.redirect(`https://www.strava.com/oauth/authorize?${params}`);
});

// OAuth callback
app.get('/auth/callback', async (req, res) => {
  const { code, error, state } = req.query;

  if (error) {
    return res.redirect('/?error=access_denied');
  }

  // Validate CSRF state
  if (!state || state !== req.session.oauth_state) {
    return res.redirect('/?error=invalid_state');
  }
  delete req.session.oauth_state;

  if (!code) {
    return res.redirect('/?error=missing_code');
  }

  try {
    const response = await axios.post('https://www.strava.com/oauth/token', {
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code'
    });

    req.session.access_token = response.data.access_token;
    req.session.refresh_token = response.data.refresh_token;
    req.session.expires_at = response.data.expires_at;
    req.session.athlete = {
      id: response.data.athlete.id,
      firstname: response.data.athlete.firstname,
      lastname: response.data.athlete.lastname,
      profile_medium: response.data.athlete.profile_medium
    };

    res.redirect('/map');
  } catch (err) {
    console.error('OAuth token exchange failed:', err.response?.data || err.message);
    res.redirect('/?error=auth_failed');
  }
});

// Fetch altitude + distance streams for a single activity
app.get('/api/activity/:id/streams', async (req, res) => {
  if (!req.session.access_token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid activity id' });

  try {
    const token = await ensureValidToken(req);
    const response = await axios.get(
      `https://www.strava.com/api/v3/activities/${id}/streams`,
      {
        headers: { Authorization: `Bearer ${token}` },
        params: { keys: 'altitude,distance', key_by_type: true }
      }
    );
    res.json(response.data);
  } catch (err) {
    if (err.response?.status === 429) {
      const retryAfter = err.response.headers['x-ratelimit-reset'] || 60;
      return res.status(429).json({ error: 'Rate limit exceeded', retryAfter });
    }
    console.error('Streams fetch failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch streams' });
  }
});

// Fetch a single page of activities (paginated calls driven by the frontend)
app.get('/api/activities', async (req, res) => {
  if (!req.session.access_token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const token = await ensureValidToken(req);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = Math.min(Math.max(1, parseInt(req.query.per_page, 10) || 100), 200);

    const response = await axios.get('https://www.strava.com/api/v3/athlete/activities', {
      headers: { Authorization: `Bearer ${token}` },
      params: { page, per_page: perPage }
    });

    res.json(response.data);
  } catch (err) {
    if (err.response?.status === 429) {
      const retryAfter = err.response.headers['x-ratelimit-reset'] || 60;
      return res.status(429).json({ error: 'Rate limit exceeded', retryAfter });
    }
    console.error('Activities fetch failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch activities' });
  }
});

// Logout — destroy session
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Strava Mapper is running → http://localhost:${PORT}`);
  if (!process.env.STRAVA_CLIENT_ID || !process.env.STRAVA_CLIENT_SECRET) {
    console.warn('\n⚠  STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET are not set.');
    console.warn('   Copy .env.example to .env and fill in your credentials.\n');
  }
});
