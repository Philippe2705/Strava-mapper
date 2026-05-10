'use strict';

// ── Activity type → color ─────────────────────────────────────────────────────
const TYPE_COLORS = {
  Run: '#FC4C02', VirtualRun: '#FC4C02', TrailRun: '#D4380D',
  Ride: '#1677FF', VirtualRide: '#1677FF', EBikeRide: '#4096FF',
  MountainBikeRide: '#0958D9', GravelRide: '#2F54EB',
  Swim: '#13C2C2', Hike: '#52C41A', Walk: '#73D13D',
  AlpineSki: '#722ED1', BackcountrySki: '#9254DE', NordicSki: '#ADC6FF',
  Snowboard: '#B37FEB', IceSkate: '#91CAFF',
  Kayaking: '#FA8C16', Rowing: '#FFA940', StandUpPaddling: '#FFD591', Surfing: '#FFC53D',
  Workout: '#F5222D', WeightTraining: '#CF1322', Yoga: '#EB2F96',
  default: '#8C8C8C'
};
const colorFor = t => TYPE_COLORS[t] || TYPE_COLORS.default;

// ── Polyline decoder (Google encoded) ────────────────────────────────────────
function decodePolyline(encoded) {
  const coords = [];
  let i = 0, lat = 0, lng = 0;
  while (i < encoded.length) {
    let shift = 0, result = 0, byte;
    do { byte = encoded.charCodeAt(i++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { byte = encoded.charCodeAt(i++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    coords.push([lat / 1e5, lng / 1e5]);
  }
  return coords;
}

// ── Formatters ────────────────────────────────────────────────────────────────
const fmtDist  = m => m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
const fmtElev  = m => `${Math.round(m).toLocaleString()} m`;
const fmtTime  = s => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h > 0 ? `${h}h ${m}m` : `${m}m`; };
const fmtDate  = d => new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const humanType = t => t.replace(/([A-Z])/g, ' $1').trim();
const escHtml  = s => { const d = document.createElement('div'); d.appendChild(document.createTextNode(s)); return d.innerHTML; };

// ── State ─────────────────────────────────────────────────────────────────────
let map, heatLayer;
let allActivities = [];          // all fetched
let filtered = [];               // after date + type + search filters
const polylinesByActivity = {};  // activityId → L.Polyline
const layersByType = {};         // type → [L.Polyline]
const typeVisible = {};
let currentView = 'routes';      // 'routes' | 'heatmap'
let activePreset = 'all';
let searchQuery = '';
let elevationChart = null, monthlyChart = null;

// ── Map init ──────────────────────────────────────────────────────────────────
function initMap() {
  map = L.map('map', { zoomControl: true }).setView([20, 0], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
}

// ── Add one activity polyline ─────────────────────────────────────────────────
function addActivityPolyline(activity) {
  const encoded = activity.map?.summary_polyline;
  if (!encoded) return;
  const coords = decodePolyline(encoded);
  if (!coords.length) return;

  const type = activity.type || 'default';
  const color = colorFor(type);

  const pl = L.polyline(coords, { color, weight: 2.5, opacity: 0.7 });
  pl.on('mouseover', () => pl.setStyle({ weight: 4, opacity: 1 }));
  pl.on('mouseout', () => {
    const isHighlighted = pl.options._highlighted;
    pl.setStyle({ weight: isHighlighted ? 4 : 2.5, opacity: isHighlighted ? 1 : 0.7 });
  });
  pl.on('click', () => openElevationPanel(activity, coords, color));
  pl.bindPopup(() => buildPopup(activity, color), { maxWidth: 260 });

  pl.addTo(map);
  polylinesByActivity[activity.id] = pl;
  if (!layersByType[type]) layersByType[type] = [];
  layersByType[type].push(pl);
  if (!(type in typeVisible)) typeVisible[type] = true;
}

function buildPopup(activity, color) {
  const el = document.createElement('div');
  el.className = 'activity-popup';
  el.innerHTML = `
    <h3 style="border-left:3px solid ${color};padding-left:8px;">${escHtml(activity.name)}</h3>
    <div class="popup-date">${fmtDate(activity.start_date)} · ${humanType(activity.type)}</div>
    <div class="popup-stats">
      ${activity.distance     ? `<div class="popup-stat"><span>Distance</span><span>${fmtDist(activity.distance)}</span></div>` : ''}
      ${activity.total_elevation_gain ? `<div class="popup-stat"><span>Elevation</span><span>${fmtElev(activity.total_elevation_gain)}</span></div>` : ''}
      ${activity.moving_time  ? `<div class="popup-stat"><span>Time</span><span>${fmtTime(activity.moving_time)}</span></div>` : ''}
      ${activity.average_speed ? `<div class="popup-stat"><span>Avg speed</span><span>${(activity.average_speed * 3.6).toFixed(1)} km/h</span></div>` : ''}
    </div>`;
  return el;
}

// ── Elevation panel ───────────────────────────────────────────────────────────
function renderElevationChart(activity, distData, altData, color) {
  const isDark = document.documentElement.dataset.theme === 'dark';
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const textColor = isDark ? '#999' : '#666';

  // Downsample to max 200 points so the chart stays fast
  const maxPts = 200;
  const step = Math.max(1, Math.floor(altData.length / maxPts));
  const labels = [], data = [];
  for (let i = 0; i < altData.length; i += step) {
    labels.push(fmtDist(distData[i]));
    data.push(Math.round(altData[i]));
  }

  const ctx = document.getElementById('chart-elevation').getContext('2d');
  if (elevationChart) elevationChart.destroy();

  elevationChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: color,
        backgroundColor: color + '22',
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false }, tooltip: {
        callbacks: { label: c => `${c.parsed.y} m` }
      }},
      scales: {
        x: { display: false },
        y: { grid: { color: gridColor }, ticks: { color: textColor, font: { size: 10 }, maxTicksLimit: 4, callback: v => `${v}m` } }
      }
    }
  });
}

async function openElevationPanel(activity, coords, color) {
  document.getElementById('elevation-title').textContent = activity.name;
  document.getElementById('elevation-panel').classList.remove('hidden');

  // Show stats immediately (available from summary)
  document.getElementById('elevation-stats').innerHTML = [
    activity.distance            ? `<span>Distance <strong>${fmtDist(activity.distance)}</strong></span>` : '',
    activity.total_elevation_gain ? `<span>Gain <strong>${fmtElev(activity.total_elevation_gain)}</strong></span>` : '',
    activity.moving_time         ? `<span>Time <strong>${fmtTime(activity.moving_time)}</strong></span>` : '',
    activity.average_speed       ? `<span>Avg <strong>${(activity.average_speed * 3.6).toFixed(1)} km/h</strong></span>` : '',
  ].join('');

  // Show a loading placeholder in the chart canvas
  const ctx = document.getElementById('chart-elevation').getContext('2d');
  if (elevationChart) { elevationChart.destroy(); elevationChart = null; }
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = document.documentElement.dataset.theme === 'dark' ? '#999' : '#aaa';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Loading elevation…', ctx.canvas.width / 2, ctx.canvas.height / 2);

  try {
    const res = await fetch(`/api/activity/${activity.id}/streams`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const streams = await res.json();

    const altData  = streams.altitude?.data;
    const distData = streams.distance?.data;

    if (!altData || !distData || altData.length < 2) {
      // No altitude data (e.g. indoor activity) — show message
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.fillText('No elevation data available', ctx.canvas.width / 2, ctx.canvas.height / 2);
      return;
    }

    renderElevationChart(activity, distData, altData, color);
  } catch (err) {
    console.warn('Elevation stream fetch failed:', err.message);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.fillText('Could not load elevation data', ctx.canvas.width / 2, ctx.canvas.height / 2);
  }
}

// ── Heatmap ───────────────────────────────────────────────────────────────────
function buildHeatmap() {
  const points = [];
  filtered.forEach(a => {
    const encoded = a.map?.summary_polyline;
    if (!encoded) return;
    decodePolyline(encoded).forEach(([lat, lng]) => points.push([lat, lng, 0.5]));
  });

  if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }
  if (points.length) {
    heatLayer = L.heatLayer(points, { radius: 18, blur: 12, maxZoom: 17, minOpacity: 0.5, gradient: { 0.0: '#000080', 0.25: '#0000ff', 0.5: '#FC4C02', 0.75: '#ffaa00', 1.0: '#ffffff' } });
    heatLayer.addTo(map);
  }
}

function removeHeatmap() {
  if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }
}

// ── Show / hide route layers ──────────────────────────────────────────────────
function applyRouteVisibility() {
  // Remove all first, then add back only those in filtered + visible type
  const filteredIds = new Set(filtered.map(a => a.id));
  Object.entries(polylinesByActivity).forEach(([id, pl]) => {
    const activity = allActivities.find(a => a.id == id);
    const show = filteredIds.has(Number(id)) && typeVisible[activity?.type];
    if (show) { if (!map.hasLayer(pl)) map.addLayer(pl); }
    else       { if (map.hasLayer(pl)) map.removeLayer(pl); }
  });
}

// ── Fit bounds ────────────────────────────────────────────────────────────────
function fitAllBounds() {
  const layers = filtered
    .map(a => polylinesByActivity[a.id])
    .filter(Boolean)
    .filter(pl => map.hasLayer(pl));
  if (!layers.length) return;
  map.fitBounds(L.featureGroup(layers).getBounds(), { padding: [20, 20] });
}

// ── Date filter ───────────────────────────────────────────────────────────────
function applyPreset(preset) {
  activePreset = preset;
  const now = new Date();
  filtered = allActivities.filter(a => {
    const d = new Date(a.start_date);
    if (preset === 'week') {
      const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7);
      return d >= weekAgo;
    }
    if (preset === 'month') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    if (preset === 'year')  return d.getFullYear() === now.getFullYear();
    return true;
  });
  applySearch();
}

// ── Search filter ─────────────────────────────────────────────────────────────
function applySearch() {
  const q = searchQuery.toLowerCase();
  if (q) filtered = filtered.filter(a => a.name.toLowerCase().includes(q) || humanType(a.type).toLowerCase().includes(q));
  refreshView();
}

// ── Refresh everything after filter change ────────────────────────────────────
function refreshView() {
  if (currentView === 'routes') {
    removeHeatmap();
    applyRouteVisibility();
  } else {
    // Hide all polylines
    Object.values(polylinesByActivity).forEach(pl => { if (map.hasLayer(pl)) map.removeLayer(pl); });
    buildHeatmap();
  }
  updateStats();
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function updateStats() {
  const src = filtered;
  document.getElementById('stat-count').textContent    = src.length.toLocaleString();
  document.getElementById('stat-distance').textContent = fmtDist(src.reduce((s, a) => s + (a.distance || 0), 0));
  document.getElementById('stat-elevation').textContent = fmtElev(src.reduce((s, a) => s + (a.total_elevation_gain || 0), 0));
  document.getElementById('stat-time').textContent     = fmtTime(src.reduce((s, a) => s + (a.moving_time || 0), 0));
  buildTypeBreakdown(src);
}

function buildTypeBreakdown(src) {
  const counts = {};
  src.forEach(a => { const t = a.type || 'Other'; counts[t] = (counts[t] || 0) + 1; });
  const wrap = document.getElementById('type-breakdown');
  wrap.innerHTML = '';
  Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([type, cnt]) => {
    const color = colorFor(type);
    const chip = document.createElement('span');
    chip.className = 'type-chip';
    chip.style.cssText = `border-color:${color};color:${color}`;
    chip.innerHTML = `<span class="type-chip-dot" style="background:${color}"></span>${humanType(type)} <strong>${cnt}</strong>`;
    wrap.appendChild(chip);
  });
}

// ── Records ───────────────────────────────────────────────────────────────────
function buildRecords() {
  const src = allActivities;
  const records = [
    { medal: '���', title: 'Longest activity',        find: src.reduce((b, a) => (a.distance||0) > (b?.distance||0) ? a : b, null),         fmt: a => fmtDist(a.distance) },
    { medal: '⛰️', title: 'Most elevation gain',      find: src.filter(a => !['AlpineSki','BackcountrySki','NordicSki','Snowboard','IceSkate'].includes(a.type)).reduce((b, a) => (a.total_elevation_gain||0) > (b?.total_elevation_gain||0) ? a : b, null), fmt: a => fmtElev(a.total_elevation_gain) },
    { medal: '⏱️', title: 'Longest duration',         find: src.reduce((b, a) => (a.moving_time||0) > (b?.moving_time||0) ? a : b, null),    fmt: a => fmtTime(a.moving_time) },
    { medal: '⚡', title: 'Fastest average speed',    find: src.filter(a => a.distance > 1000).reduce((b, a) => (a.average_speed||0) > (b?.average_speed||0) ? a : b, null), fmt: a => `${(a.average_speed*3.6).toFixed(1)} km/h` },
    { medal: '���', title: 'Highest calorie burn',     find: src.reduce((b, a) => (a.kilojoules||0) > (b?.kilojoules||0) ? a : b, null),       fmt: a => `${Math.round(a.kilojoules * 0.239)} kcal` },
  ];

  const list = document.getElementById('records-list');
  list.innerHTML = '';
  records.forEach(({ medal, title, find, fmt }) => {
    if (!find) return;
    const card = document.createElement('div');
    card.className = 'record-card';
    card.innerHTML = `
      <div class="record-title"><span class="record-medal">${medal}</span>${title}</div>
      <div class="record-value">${fmt(find)}</div>
      <div class="record-name">${escHtml(find.name)} · ${fmtDate(find.start_date)}</div>`;
    list.appendChild(card);
  });
}

// ── Monthly chart ─────────────────────────────────────────────────────────────
function buildMonthlyChart(year) {
  const src = allActivities.filter(a => new Date(a.start_date).getFullYear() === year);
  const months = Array.from({ length: 12 }, (_, i) => {
    const dist = src.filter(a => new Date(a.start_date).getMonth() === i).reduce((s, a) => s + (a.distance || 0), 0);
    return +(dist / 1000).toFixed(1);
  });

  const ctx = document.getElementById('chart-monthly').getContext('2d');
  if (monthlyChart) monthlyChart.destroy();

  const isDark = document.documentElement.dataset.theme === 'dark';
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const textColor = isDark ? '#999' : '#666';

  monthlyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
      datasets: [{
        data: months,
        backgroundColor: '#FC4C02cc',
        borderRadius: 4,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.parsed.y} km` } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: textColor, font: { size: 10 } } },
        y: { grid: { color: gridColor }, ticks: { color: textColor, font: { size: 10 }, callback: v => `${v}km` } }
      }
    }
  });
}

function populateYearSelect() {
  const years = [...new Set(allActivities.map(a => new Date(a.start_date).getFullYear()))].sort((a, b) => b - a);
  const sel = document.getElementById('chart-year-select');
  sel.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');
  if (years.length) buildMonthlyChart(years[0]);
  sel.addEventListener('change', () => buildMonthlyChart(+sel.value));
}

// ── Calendar ──────────────────────────────────────────────────────────────────
function buildCalendar() {
  const wrap = document.getElementById('calendar-wrap');

  // Count activities per date string
  const dayCounts = {};
  allActivities.forEach(a => {
    const key = a.start_date.slice(0, 10);
    dayCounts[key] = (dayCounts[key] || 0) + 1;
  });

  const max = Math.max(...Object.values(dayCounts), 1);

  // 52 weeks back from today
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - 364);
  // Align to Sunday
  start.setDate(start.getDate() - start.getDay());

  const grid = document.createElement('div');
  grid.className = 'cal-grid';

  let monthLabels = [];
  let lastMonth = -1;
  let colIndex = 0;

  const cursor = new Date(start);
  while (cursor <= today) {
    const key = cursor.toISOString().slice(0, 10);
    const count = dayCounts[key] || 0;
    const level = count === 0 ? 0 : count >= max * 0.75 ? 4 : count >= max * 0.5 ? 3 : count >= max * 0.25 ? 2 : 1;

    if (cursor.getMonth() !== lastMonth && cursor.getDay() === 0) {
      monthLabels.push({ col: colIndex, label: cursor.toLocaleDateString(undefined, { month: 'short' }) });
      lastMonth = cursor.getMonth();
    }
    if (cursor.getDay() === 0) colIndex++;

    const cell = document.createElement('div');
    cell.className = 'cal-cell';
    if (level) cell.dataset.level = level;
    cell.title = `${key}: ${count} activit${count === 1 ? 'y' : 'ies'}`;
    grid.appendChild(cell);

    cursor.setDate(cursor.getDate() + 1);
  }

  // Month labels row above grid
  const monthRow = document.createElement('div');
  monthRow.className = 'cal-months';
  let lastCol = 0;
  monthLabels.forEach(({ col, label }) => {
    const gap = (col - lastCol) * 13; // cell 11px + gap 2px
    const span = document.createElement('span');
    span.className = 'cal-month-label';
    span.style.marginLeft = `${gap}px`;
    span.textContent = label;
    monthRow.appendChild(span);
    lastCol = col;
  });

  wrap.innerHTML = '';
  wrap.appendChild(monthRow);
  wrap.appendChild(grid);
}

// ── Legend (type filter) ──────────────────────────────────────────────────────
function buildLegend() {
  const counts = {};
  allActivities.forEach(a => { counts[a.type || 'Other'] = (counts[a.type || 'Other'] || 0) + 1; });

  const list = document.getElementById('legend-list');
  list.innerHTML = '';

  Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([type]) => {
    const color = colorFor(type);
    const li = document.createElement('li');
    li.className = 'legend-item';
    li.dataset.type = type;
    li.innerHTML = `
      <span class="legend-swatch" style="background:${color}"></span>
      <span class="legend-label">${humanType(type)}</span>
      <span class="legend-count">${counts[type]}</span>`;
    li.addEventListener('click', () => {
      typeVisible[type] = !typeVisible[type];
      li.classList.toggle('inactive', !typeVisible[type]);
      refreshView();
    });
    list.appendChild(li);
  });

  // Toggle all button
  let allVis = true;
  document.getElementById('legend-toggle-all').addEventListener('click', function () {
    allVis = !allVis;
    this.textContent = allVis ? 'Hide all' : 'Show all';
    Object.keys(typeVisible).forEach(t => typeVisible[t] = allVis);
    document.querySelectorAll('.legend-item').forEach(li => li.classList.toggle('inactive', !allVis));
    refreshView();
  });
}

// ── Athlete info ──────────────────────────────────────────────────────────────
async function loadAthleteInfo() {
  let res;
  try { res = await fetch('/api/config'); } catch {
    showLoadingError('Could not reach the server.'); return false;
  }
  if (!res.ok) { showLoadingError(`Server error ${res.status}.`); return false; }

  const config = await res.json();
  if (!config.authenticated) { window.location.href = '/'; return false; }

  if (config.athlete) {
    const { firstname, lastname, profile_medium } = config.athlete;
    document.getElementById('athlete-info').innerHTML =
      `${profile_medium ? `<img class="athlete-avatar" src="${escHtml(profile_medium)}" alt="Avatar"/>` : ''}
       <span>${escHtml(firstname)} ${escHtml(lastname)}</span>`;
  }
  return true;
}

// ── Progressive activity loading ──────────────────────────────────────────────
async function loadActivities() {
  let page = 1;
  const PER = 100;
  let total = 0;

  while (true) {
    let res;
    try { res = await fetch(`/api/activities?page=${page}&per_page=${PER}`); }
    catch (e) { showLoadingError('Network error. Please refresh.'); return; }

    if (res.status === 401) { window.location.href = '/'; return; }
    if (res.status === 429) {
      const d = await res.json().catch(() => ({}));
      const wait = d.retryAfter || 60;
      setLoadingText(`Rate limit reached. Retrying in ${wait}s…`);
      await new Promise(r => setTimeout(r, wait * 1000));
      continue;
    }
    if (!res.ok) {
      let detail = '';
      try { const d = await res.json(); detail = d.error || ''; } catch (_) {}
      showLoadingError(`Error ${res.status}${detail ? ': ' + detail : ''}. Please refresh.`);
      return;
    }

    const batch = await res.json();
    if (!batch.length) break;

    batch.forEach(a => { allActivities.push(a); addActivityPolyline(a); });
    total += batch.length;
    document.getElementById('progress-bar').style.width = `${Math.min(95, (total / Math.max(total, 200)) * 100)}%`;
    document.getElementById('loading-count').textContent = `${total.toLocaleString()} activit${total === 1 ? 'y' : 'ies'} loaded`;
    setLoadingText('Loading your activities…');

    if (batch.length < PER) break;
    page++;
  }

  finishLoading(total);
}

function setLoadingText(t) { document.getElementById('loading-text').textContent = t; }

function finishLoading(total) {
  document.getElementById('progress-bar').style.width = '100%';
  document.getElementById('loading-count').textContent = `${total.toLocaleString()} activit${total === 1 ? 'y' : 'ies'} loaded`;
  setLoadingText('Rendering…');

  setTimeout(() => {
    document.getElementById('loading-overlay').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');

    // Tell Leaflet the container now has real dimensions
    map.invalidateSize();

    // Init filtered = all
    filtered = [...allActivities];

    buildLegend();
    buildRecords();
    populateYearSelect();
    buildCalendar();
    updateStats();
    applyRouteVisibility();
    fitAllBounds();
  }, 150);
}

function showLoadingError(msg) {
  document.querySelector('.loading-box').innerHTML = `
    <div style="font-size:2rem;margin-bottom:12px;">⚠️</div>
    <p style="color:#c0392b;font-weight:600;margin-bottom:8px;">Something went wrong</p>
    <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:20px;">${escHtml(msg)}</p>
    <a href="/" style="color:var(--orange);">← Back</a> &nbsp;
    <a href="/map" style="color:var(--orange);" onclick="location.reload();return false;">Retry</a>`;
}

// ── Dark mode ─────────────────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('sm-theme') || 'dark';
  setTheme(saved);
  document.getElementById('btn-theme').addEventListener('click', () => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    // Rebuild charts with new colours
    if (monthlyChart) {
      const sel = document.getElementById('chart-year-select');
      buildMonthlyChart(+sel.value);
    }
  });
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('sm-theme', theme);
  document.getElementById('icon-moon').classList.toggle('hidden', theme === 'light');
  document.getElementById('icon-sun').classList.toggle('hidden', theme === 'dark');
}

// ── Sidebar tabs ──────────────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.sidebar-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sidebar-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────────
(async function boot() {
  initTheme();
  initMap();
  initTabs();

  const ok = await loadAthleteInfo();
  if (!ok) return;

  // Toolbar events
  document.getElementById('btn-fit-bounds').addEventListener('click', fitAllBounds);

  document.getElementById('btn-view-routes').addEventListener('click', function () {
    currentView = 'routes';
    this.classList.add('active');
    document.getElementById('btn-view-heatmap').classList.remove('active');
    refreshView();
  });

  document.getElementById('btn-view-heatmap').addEventListener('click', function () {
    currentView = 'heatmap';
    this.classList.add('active');
    document.getElementById('btn-view-routes').classList.remove('active');
    refreshView();
  });

  document.querySelectorAll('.date-preset').forEach(btn => {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.date-preset').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      applyPreset(this.dataset.preset);
    });
  });

  document.getElementById('search-input').addEventListener('input', function () {
    searchQuery = this.value.trim();
    applyPreset(activePreset); // re-apply date filter then search
  });

  document.getElementById('elevation-close').addEventListener('click', () => {
    document.getElementById('elevation-panel').classList.add('hidden');
  });

  await loadActivities();
})().catch(err => {
  console.error('Boot failed:', err);
  showLoadingError('Unexpected error: ' + err.message);
});
