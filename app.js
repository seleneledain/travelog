/* ============================================================
   Our Sailing Adventure — app.js
   Loads trip data (Google Sheet → falls back to trips.json),
   renders map + route + markers + timeline.
   ============================================================ */

// ------------------------------------------------------------
// DATA SOURCE
// ------------------------------------------------------------
// Paste your "Publish to web → CSV" URL here. It looks like:
//   https://docs.google.com/spreadsheets/d/e/2PACX-.../pub?output=csv
// Leave as empty string to use trips.json only.
const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRRh6LTKUeoHXTefmZt-QvTF4r-X7YUp_j_i2nzeU0Chh1o2v3FRVt50EpIFcagGGBX_O-mTAgpJy20/pubhtml';

// How long to trust a cached copy of the sheet, in minutes.
// Google caches the published CSV for ~5min anyway, so 5 is a sensible default.
const CACHE_MINUTES = 5;

const MAP_TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const MAP_ATTRIB = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const PLATFORM_LABELS = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  twitter: 'X',
  blog: 'Read'
};

let map, routeLine;
const markersById = new Map();
const entriesById = new Map();
let trips = [];

// ------------------------------------------------------------
// Boot
// ------------------------------------------------------------
init();

async function init() {
  setupMap();
  setupAbout();

  try {
    trips = await loadTrips();
  } catch (err) {
    console.error(err);
    showError('Could not load trip data');
    return;
  }

  if (!trips.length) {
    showError('No trips yet — add some to the sheet or trips.json');
    return;
  }

  renderRoute(trips);
  renderMarkers(trips);
  renderTimeline(trips);
  updateStats(trips);
  fitToTrips(trips, { padding: [60, 60], animate: false });

  document.getElementById('reset-btn').addEventListener('click', () => {
    fitToTrips(trips, { padding: [60, 60] });
  });
}

// ------------------------------------------------------------
// Data loading: Google Sheet (preferred) → trips.json (fallback)
// ------------------------------------------------------------
async function loadTrips() {
  // 1. Try the sheet, if configured
  if (SHEET_CSV_URL) {
    try {
      const fromSheet = await loadFromSheet();
      if (fromSheet.length) {
        console.info(`Loaded ${fromSheet.length} entries from Google Sheet`);
        return fromSheet;
      }
      console.warn('Sheet returned no rows — falling back to trips.json');
    } catch (err) {
      console.warn('Sheet load failed, falling back to trips.json:', err);
    }
  }

  // 2. Fallback: local trips.json
  const res = await fetch('trips.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load trips.json (${res.status})`);
  const data = await res.json();
  return (data.trips || []).slice().sort(byDateAsc);
}

async function loadFromSheet() {
  // Try cache first
  const cached = readSheetCache();
  if (cached) return cached;

  const res = await fetch(SHEET_CSV_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Sheet fetch failed (${res.status})`);
  const csv = await res.text();
  const rows = parseCSV(csv);
  const trips = rows.map(rowToTrip).filter(Boolean).sort(byDateAsc);
  writeSheetCache(trips);
  return trips;
}

// Convert one parsed CSV row (object keyed by header name) into a trip entry.
// Headers expected (case/space tolerant): id, date, place, country, lat, lng,
//   note, photo, link1_platform, link1_url, link2_platform, link2_url, ...
// Unknown columns are ignored. Missing required fields → row is skipped.
function rowToTrip(row) {
  const get = (key) => {
    // tolerant lookup: ignore case + spaces + underscores
    const norm = (s) => s.toLowerCase().replace(/[\s_-]/g, '');
    const want = norm(key);
    for (const k of Object.keys(row)) {
      if (norm(k) === want) return (row[k] ?? '').trim();
    }
    return '';
  };

  const lat = parseFloat(get('lat') || get('latitude'));
  const lng = parseFloat(get('lng') || get('lon') || get('longitude'));
  const date = get('date');
  const place = get('place');

  // required fields — skip the row if any are missing
  if (!date || !place || isNaN(lat) || isNaN(lng)) return null;

  // Collect link pairs: link1_platform/link1_url, link2_platform/link2_url, ...
  const links = [];
  for (let i = 1; i <= 6; i++) {
    const platform = get(`link${i}_platform`) || get(`link${i}platform`);
    const url = get(`link${i}_url`) || get(`link${i}url`);
    if (url) links.push({ platform: platform || 'blog', url });
  }
  // Also accept a single "social_url" / "social_type" pair for simpler sheets
  const singleUrl = get('social_url') || get('socialurl');
  const singleType = get('social_type') || get('socialtype') || get('platform');
  if (singleUrl) links.push({ platform: singleType || 'blog', url: singleUrl });

  return {
    id: get('id') || `${place}-${date}`,
    date,
    place,
    country: get('country'),
    lat,
    lng,
    note: get('note'),
    photo: get('photo') || get('photo_url') || get('photourl'),
    links
  };
}

// Tiny but real CSV parser — handles quoted fields, escaped quotes ("")
// and embedded newlines/commas. Returns an array of objects keyed by
// the first row's headers.
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* swallow — \n will close the row */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }

  if (!rows.length) return [];
  const headers = rows.shift().map(h => h.trim());
  return rows
    .filter(r => r.some(cell => cell.trim() !== '')) // drop empty rows
    .map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
}

// ------------------------------------------------------------
// Sheet cache (localStorage) — keeps the site snappy on repeat
// visits and gives us something to show if the network is down.
// ------------------------------------------------------------
const CACHE_KEY = 'sailing.sheet.v1';

function readSheetCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { ts, trips } = JSON.parse(raw);
    const ageMin = (Date.now() - ts) / 60000;
    if (ageMin > CACHE_MINUTES) return null;
    return trips;
  } catch { return null; }
}

function writeSheetCache(trips) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), trips }));
  } catch { /* quota or private mode — ignore */ }
}


function setupMap() {
  map = L.map('map', {
    zoomControl: true,
    worldCopyJump: true,
    attributionControl: true,
    minZoom: 2,
    maxZoom: 18
  }).setView([20, 0], 2);

  L.tileLayer(MAP_TILES, {
    attribution: MAP_ATTRIB,
    maxZoom: 19,
    subdomains: 'abc'
  }).addTo(map);

  // place zoom control bottom-left so it doesn't fight with the about button
  map.zoomControl.setPosition('bottomleft');
}

// ------------------------------------------------------------
// Route line
// ------------------------------------------------------------
function renderRoute(list) {
  const coords = list.map(t => [t.lat, t.lng]);
  if (routeLine) routeLine.remove();
  routeLine = L.polyline(coords, {
    color: '#1a1814',
    weight: 1.4,
    opacity: 0.85,
    lineCap: 'round',
    lineJoin: 'round',
    smoothFactor: 1
  }).addTo(map);

  // Enable smooth CSS fade during map fly animations
  const el = routeLine.getElement();
  if (el) el.style.transition = 'opacity 0.25s ease';
}

// ------------------------------------------------------------
// Markers
// ------------------------------------------------------------
function renderMarkers(list) {
  const lastIdx = list.length - 1;

  list.forEach((trip, idx) => {
    const isCurrent = idx === lastIdx;
    const icon = isCurrent
      ? L.divIcon({
          className: '',
          html: '<div class="marker-current"><div class="ring"></div><div class="dot"></div></div>',
          iconSize: [18, 18],
          iconAnchor: [9, 9]
        })
      : L.divIcon({
          className: '',
          html: '<div class="marker-dot"></div>',
          iconSize: [14, 14],
          iconAnchor: [7, 7]
        });

    const marker = L.marker([trip.lat, trip.lng], {
      icon,
      riseOnHover: true,
      title: `${trip.place}${trip.country ? ', ' + trip.country : ''}`
    }).addTo(map);

    marker.bindPopup(buildPopupHtml(trip, isCurrent), {
      closeButton: true,
      autoPan: true,
      maxWidth: 300,
      minWidth: 290,
      offset: [0, -4]
    });

    marker.on('popupopen', () => highlightEntry(trip.id, false));
    marker.on('click', () => highlightEntry(trip.id, false));

    markersById.set(trip.id, marker);
  });
}

function buildPopupHtml(trip, isCurrent) {
  const date = formatDate(trip.date);
  const country = trip.country ? `<div class="pop-country">${escapeHtml(trip.country)}${isCurrent ? ' · currently here' : ''}</div>` : '';
  const photo = trip.photo
    ? `<img class="pop-photo" src="${escapeAttr(trip.photo)}" alt="${escapeAttr(trip.place)}" onerror="this.style.display='none'" />`
    : '';
  const note = trip.note
    ? `<p class="pop-note">${escapeHtml(trip.note)}</p>`
    : '';

  let links = '';
  if (Array.isArray(trip.links) && trip.links.length) {
    const items = trip.links.map(l => {
      const label = PLATFORM_LABELS[l.platform] || l.label || l.platform || 'Link';
      return `<a class="pop-link" href="${escapeAttr(l.url)}" target="_blank" rel="noopener noreferrer" data-platform="${escapeAttr(l.platform || '')}">→ ${escapeHtml(label)}</a>`;
    }).join('');
    links = `<div class="pop-links">${items}</div>`;
  }

  return `
    <div class="popup">
      <div class="pop-date">${date}</div>
      <h3 class="pop-place">${escapeHtml(trip.place)}</h3>
      ${country}
      ${photo}
      ${note}
      ${links}
    </div>
  `;
}

// ------------------------------------------------------------
// Timeline (newest first in the strip)
// ------------------------------------------------------------
function renderTimeline(list) {
  const tl = document.getElementById('timeline');
  tl.innerHTML = '';
  const lastIdx = list.length - 1;

  // newest first
  const ordered = list.slice().reverse();

  ordered.forEach((trip) => {
    const isCurrent = list.indexOf(trip) === lastIdx;
    const el = document.createElement('div');
    el.className = 'entry' + (isCurrent ? ' current' : '');
    el.dataset.id = trip.id;
    el.innerHTML = `
      <div class="e-date">${formatDate(trip.date)}</div>
      <div class="e-place">${escapeHtml(trip.place)}${isCurrent ? '<span class="e-badge">now</span>' : ''}</div>
      <div class="e-country">${escapeHtml(trip.country || '')}</div>
    `;
    el.addEventListener('click', () => focusTrip(trip.id));
    tl.appendChild(el);
    entriesById.set(trip.id, el);
  });
}

function highlightEntry(id, scroll = true) {
  entriesById.forEach((el, key) => {
    el.classList.toggle('active', key === id);
  });
  if (scroll) {
    const el = entriesById.get(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }
}

function focusTrip(id) {
  const trip = trips.find(t => t.id === id);
  const marker = markersById.get(id);
  if (!trip || !marker) return;

  highlightEntry(id, true);
  map.flyTo([trip.lat, trip.lng], Math.max(map.getZoom(), 5), { duration: 0.5 });
  map.once('moveend', () => {
    marker.openPopup();
  });
}

function setRouteOpacity(val) {
  const el = routeLine?.getElement();
  if (el) el.style.opacity = val;
}

// ------------------------------------------------------------
// Stats / header meta
// ------------------------------------------------------------
function updateStats(list) {
  const countries = new Set(list.map(t => t.country).filter(Boolean));
  const meta = document.getElementById('th-meta');
  const last = list[list.length - 1];
  const where = last ? `currently in ${last.place}` : '';
  meta.textContent = `${list.length} stop${list.length === 1 ? '' : 's'} · ${countries.size} countr${countries.size === 1 ? 'y' : 'ies'} · ${where}`;
}

// ------------------------------------------------------------
// About modal
// ------------------------------------------------------------
function setupAbout() {
  const modal = document.getElementById('about-modal');
  const openBtn = document.getElementById('about-btn');

  const open = () => {
    modal.hidden = false;
    document.addEventListener('keydown', escClose);
  };
  const close = () => {
    modal.hidden = true;
    document.removeEventListener('keydown', escClose);
  };
  const escClose = (e) => { if (e.key === 'Escape') close(); };

  openBtn.addEventListener('click', open);
  modal.addEventListener('click', (e) => {
    if (e.target.matches('[data-close]')) close();
  });
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function fitToTrips(list, opts = {}) {
  if (!list.length) return;
  const bounds = L.latLngBounds(list.map(t => [t.lat, t.lng]));
  if (list.length === 1) {
    map.setView(bounds.getCenter(), 6);
  } else {
    map.fitBounds(bounds, Object.assign({ padding: [60, 60] }, opts));
  }
}

function byDateAsc(a, b) {
  return new Date(a.date) - new Date(b.date);
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  // 14 MAR 2026
  return d.toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric'
  }).toUpperCase();
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function escapeAttr(str = '') {
  return escapeHtml(str).replace(/"/g, '&quot;');
}

function showError(msg) {
  const meta = document.getElementById('th-meta');
  if (meta) meta.textContent = msg;
}