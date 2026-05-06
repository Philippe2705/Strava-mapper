'use strict';

// ── Activity type → color mapping ─────────────────────────────────────────────
const TYPE_COLORS = {
  Run:              '#FC4C02',
  VirtualRun:       '#FC4C02',
  TrailRun:         '#D4380D',
  Ride:             '#1677FF',
  VirtualRide:      '#1677FF',
  EBikeRide:        '#4096FF',
  MountainBikeRide: '#0958D9',
  GravelRide:       '#2F54EB',
  Swim:             '#13C2C2',
  Hike:             '#52C41A',
  Walk:             '#73D13D',
  AlpineSki:        '#722ED1',
  BackcountrySki:   '#9254DE',
  NordicSki:        '#ADC6FF',
  Snowboard:        '#B37FEB',
  IceSkate:         '#91CAFF',
  Kayaking:         '#FA8C16',
  Rowing:           '#FFA940',
  StandUpPaddling:  '#FFD591',
  Surfing:          '#FFC53D',
  Workout:          '#F5222D',
  WeightTraining:   '#CF1322',
  Yoga:             '#EB2F96',
  default:          '#8C8C8C'
};

function colorFor(type) {
  return TYPE_COLORS[type] || TYPE_COLORS.default;
}

// ── Google Encoded Polyline decoder ───────────────────────────────────────────
// Implements the algorithm described at:
// https://developers.google.com/maps/documentation/utilities/polylinealgorithm
function decodePolyline(encoded) {
  const coords = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    shift = 0;
    result = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);

    coords.push([lat / 1e5, lng / 1e5]);
  }

  return coords;
}

// ── Formatters ────────────────────────────────────────────────────────────────
function formatDistance(meters) {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} km`;
  }
  return `${Math.round(meters)} m`;
}

function formatElevation(meters) {
  return `${Math.round(meters).toLocaleString()} m`;
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric'
  });
}

function humanType(type) {
  // Insert spaces before capital letters: "MountainBikeRide" → "Mountain Bike Ride"
  return type.replace(/([A-Z])/g, ' $1').trim();
}

// ── State ─────────────────────────────────────────────────────────────────────
let map;
const allActivities = [];              // raw activity objects
const layersByType = {};               // { type: [L.Polyline, ...] }
const typeVisible = {};                // { type: true|false }

// ── Map initialisation ────────────────────────────────────────────────────────
function initMap() {
  map = L.map('map', { zoomControl: true }).setView([20, 0], 2);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
}

// ── Add a single activity to the map ─────────────────────────────────────────
function addActivityToMap(activity) {
  const encoded = activity.map?.summary_polyline;
  if (!encoded) return; // indoor / no GPS

  const coords = decodePolyline(encoded);
  if (coords.length === 0) return;

  const type = activity.type || 'default';
  const color = colorFor(type);

  const polyline = L.polyline(coords, {
    color,
    weight: 2.5,
    opacity: 0.75
  });

  polyline.on('mouseover', () => polyline.setStyle({ weight: 4, opacity: 1 }));
  polyline.on('mouseout', () => polyline.setStyle({ weight: 2.5, opacity: 0.75 }));

  polyline.bindPopup(() => buildPopup(activity, color), { maxWidth: 260 });

  polyline.addTo(map);

  if (!layersByType[type]) layersByType[type] = [];
  layersByType[type].push(polyline);

  if (!(type in typeVisible)) typeVisible[type] = true;
}

function buildPopup(activity, color) {
  const el = document.createElement('div');
  el.className = 'activity-popup';
  el.innerHTML = `
    <h3 style="border-left: 3px solid ${color}; padding-left: 8px;">${escapeHtml(activity.name)}</h3>
    <div class="popup-date">${formatDate(activity.start_date)} · ${humanType(activity.type)}</div>
    <div class="popup-stats">
      ${activity.distance ? `<div class="popup-stat"><span>Distance</span><span>${formatDistance(activity.distance)}</span></div>` : ''}
      ${activity.total_elevation_gain ? `<div class="popup-stat"><span>Elevation</span><span>${formatElevation(activity.total_elevation_gain)}</span></div>` : ''}
      ${activity.moving_time ? `<div class="popup-stat"><span>Moving time</span><span>${formatTime(activity.moving_time)}</span></div>` : ''}
      ${activity.average_speed ? `<div class="popup-stat"><span>Avg speed</span><span>${(activity.average_speed * 3.6).toFixed(1)} km/h</span></div>` : ''}
    </div>
  `;
  return el;
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str));
  return d.innerHTML;
}

// ── Stats calculation ─────────────────────────────────────────────────────────
function updateStats() {
  const count = allActivities.length;
  const totalDist = allActivities.reduce((s, a) => s + (a.distance || 0), 0);
  const totalElev = allActivities.reduce((s, a) => s + (a.total_elevation_gain || 0), 0);
  const totalTime = allActivities.reduce((s, a) => s + (a.moving_time || 0), 0);

  const longest = allActivities.reduce((best, a) =>
    (a.distance || 0) > (best?.distance || 0) ? a : best, null);
  const highest = allActivities.reduce((best, a) =>
    (a.total_elevation_gain || 0) > (best?.total_elevation_gain || 0) ? a : best, null);

  document.getElementById('stat-count').textContent = count.toLocaleString();
  document.getElementById('stat-distance').textContent = formatDistance(totalDist);
  document.getElementById('stat-elevation').textContent = formatElevation(totalElev);
  document.getElementById('stat-time').textContent = formatTime(totalTime);
  document.getElementById('stat-longest').textContent = longest ? formatDistance(longest.distance) : '—';
  document.getElementById('stat-highest').textContent = highest ? formatElevation(highest.total_elevation_gain) : '—';

  buildTypeBreakdown();
}

function buildTypeBreakdown() {
  const counts = {};
  allActivities.forEach(a => {
    const t = a.type || 'Other';
    counts[t] = (counts[t] || 0) + 1;
  });

  const wrap = document.getElementById('type-breakdown');
  wrap.innerHTML = '';

  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, cnt]) => {
      const color = colorFor(type);
      const chip = document.createElement('span');
      chip.className = 'type-chip';
      chip.style.borderColor = color;
      chip.style.color = color;
      chip.innerHTML = `
        <span class="type-chip-dot" style="background:${color}"></span>
        ${humanType(type)} <strong>${cnt}</strong>
      `;
      wrap.appendChild(chip);
    });
}

// ── Legend ────────────────────────────────────────────────────────────────────
function buildLegend() {
  const list = document.getElementById('legend-list');
  list.innerHTML = '';

  const counts = {};
  allActivities.forEach(a => { counts[a.type || 'Other'] = (counts[a.type || 'Other'] || 0) + 1; });

  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type]) => {
      const color = colorFor(type);
      const li = document.createElement('li');
      li.className = 'legend-item';
      li.dataset.type = type;
      li.innerHTML = `
        <span class="legend-swatch" style="background:${color}"></span>
        <span class="legend-label">${humanType(type)}</span>
        <span class="legend-count">${counts[type]}</span>
      `;
      li.addEventListener('click', () => toggleType(type, li));
      list.appendChild(li);
    });

  document.getElementById('legend').classList.remove('hidden');

  document.getElementById('legend-toggle-all').addEventListener('click', toggleAll);
}

function toggleType(type, li) {
  typeVisible[type] = !typeVisible[type];
  li.classList.toggle('inactive', !typeVisible[type]);
  (layersByType[type] || []).forEach(layer => {
    if (typeVisible[type]) map.addLayer(layer);
    else map.removeLayer(layer);
  });
}

let allVisible = true;
function toggleAll() {
  allVisible = !allVisible;
  document.getElementById('legend-toggle-all').textContent = allVisible ? 'Hide all' : 'Show all';

  document.querySelectorAll('.legend-item').forEach(li => {
    const type = li.dataset.type;
    typeVisible[type] = allVisible;
    li.classList.toggle('inactive', !allVisible);
    (layersByType[type] || []).forEach(layer => {
      if (allVisible) map.addLayer(layer);
      else map.removeLayer(layer);
    });
  });
}

// ── Fit bounds ────────────────────────────────────────────────────────────────
function fitAllBounds() {
  const allLayers = Object.values(layersByType).flat();
  if (allLayers.length === 0) return;

  const group = L.featureGroup(allLayers);
  map.fitBounds(group.getBounds(), { padding: [20, 20] });
}

// ── Athlete info ──────────────────────────────────────────────────────────────
// Returns false if the page is navigating away (caller should stop).
async function loadAthleteInfo() {
  let res;
  try {
    res = await fetch('/api/config');
  } catch (err) {
    showLoadingError('Could not reach the server. Is it still running?');
    return false;
  }

  if (!res.ok) {
    showLoadingError(`Server error ${res.status}. Please refresh.`);
    return false;
  }

  const config = await res.json();

  if (!config.authenticated) {
    window.location.href = '/';
    return false; // navigating away — caller should not continue
  }

  if (config.athlete) {
    const { firstname, lastname, profile_medium } = config.athlete;
    const el = document.getElementById('athlete-info');
    el.innerHTML = `
      ${profile_medium ? `<img class="athlete-avatar" src="${escapeHtml(profile_medium)}" alt="Avatar" />` : ''}
      <span>${escapeHtml(firstname)} ${escapeHtml(lastname)}</span>
    `;
  }

  return true;
}

// ── Progressive activity loading ──────────────────────────────────────────────
async function loadActivities() {
  let page = 1;
  const perPage = 100;
  let totalLoaded = 0;

  setLoadingText('Connecting to Strava…');

  while (true) {
    let res;
    try {
      res = await fetch(`/api/activities?page=${page}&per_page=${perPage}`);
    } catch (err) {
      showLoadingError('Network error fetching activities. Please refresh.');
      return;
    }

    if (res.status === 401) {
      window.location.href = '/';
      return;
    }

    if (res.status === 429) {
      const data = await res.json().catch(() => ({}));
      const wait = data.retryAfter || 60;
      setLoadingText(`Rate limit reached. Retrying in ${wait}s…`);
      await sleep(wait * 1000);
      continue; // retry same page
    }

    if (!res.ok) {
      let detail = '';
      try { const d = await res.json(); detail = d.error || ''; } catch (_) {}
      showLoadingError(`Error ${res.status} loading activities${detail ? ': ' + detail : ''}. Please refresh.`);
      return;
    }

    const batch = await res.json();

    if (batch.length === 0) break;

    batch.forEach(activity => {
      allActivities.push(activity);
      addActivityToMap(activity);
    });

    totalLoaded += batch.length;
    const progress = Math.min(95, (totalLoaded / Math.max(totalLoaded, 200)) * 100);
    setLoadingProgress(progress, totalLoaded);

    if (batch.length < perPage) break;
    page++;
  }

  finishLoading(totalLoaded);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function setLoadingText(text) {
  document.getElementById('loading-text').textContent = text;
}

function setLoadingProgress(pct, count) {
  document.getElementById('progress-bar').style.width = `${pct}%`;
  document.getElementById('loading-count').textContent =
    `${count.toLocaleString()} activit${count === 1 ? 'y' : 'ies'} loaded`;
  setLoadingText('Loading your activities…');
}

function finishLoading(total) {
  document.getElementById('progress-bar').style.width = '100%';
  document.getElementById('loading-count').textContent =
    `${total.toLocaleString()} activit${total === 1 ? 'y' : 'ies'} loaded`;
  setLoadingText('Rendering map…');

  // Give the browser a tick to paint routes before hiding the overlay
  setTimeout(() => {
    document.getElementById('loading-overlay').classList.add('hidden');
    document.getElementById('stats-panel').classList.remove('hidden');

    updateStats();
    buildLegend();
    fitAllBounds();
  }, 200);
}

// ── Loading error helper ──────────────────────────────────────────────────────
function showLoadingError(msg) {
  const box = document.querySelector('.loading-box');
  box.innerHTML = `
    <div style="font-size:2rem;margin-bottom:12px;">⚠️</div>
    <p style="color:#c0392b;font-weight:600;margin-bottom:8px;">Something went wrong</p>
    <p style="font-size:0.88rem;color:#555;margin-bottom:20px;">${escapeHtml(msg)}</p>
    <a href="/" style="color:#FC4C02;font-size:0.9rem;">← Back to home</a>
    &nbsp;&nbsp;
    <a href="/map" style="color:#FC4C02;font-size:0.9rem;" onclick="location.reload();return false;">Retry</a>
  `;
}

// ── Boot ──────────────────────────────────────────────────────────────────────
(async function boot() {
  initMap();

  const ok = await loadAthleteInfo();
  if (!ok) return; // navigating away or error already shown

  document.getElementById('btn-fit-bounds').addEventListener('click', fitAllBounds);

  await loadActivities();
})().catch(err => {
  console.error('Boot failed:', err);
  showLoadingError('Unexpected error: ' + err.message);
});
