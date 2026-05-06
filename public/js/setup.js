'use strict';

const ERROR_MESSAGES = {
  access_denied: 'You declined the Strava authorization. Click "Connect with Strava" to try again.',
  auth_failed: 'Authentication failed. Make sure your Client ID and Client Secret are correct in your .env file.',
  not_configured: 'Strava API credentials are not configured. Follow the setup steps below.',
  invalid_state: 'Authorization request was tampered with. Please try connecting again.',
  missing_code: 'No authorization code was received from Strava. Please try again.'
};

async function init() {
  showErrorFromUrl();

  try {
    const res = await fetch('/api/config');
    const config = await res.json();

    if (config.authenticated) {
      // Already logged in — go straight to the map
      window.location.href = '/map';
      return;
    }

    if (config.configured) {
      document.getElementById('section-connect').classList.remove('hidden');
    } else {
      document.getElementById('section-setup').classList.remove('hidden');
    }
  } catch {
    showError('Could not reach the server. Make sure it is running on this port.');
  }
}

function showErrorFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const errorKey = params.get('error');
  if (!errorKey) return;

  const banner = document.getElementById('error-banner');
  banner.textContent = ERROR_MESSAGES[errorKey] || 'An unexpected error occurred. Please try again.';
  banner.classList.remove('hidden');

  // Clean the URL without reloading
  window.history.replaceState({}, '', window.location.pathname);
}

function showError(msg) {
  const banner = document.getElementById('error-banner');
  banner.textContent = msg;
  banner.classList.remove('hidden');
}

init();
