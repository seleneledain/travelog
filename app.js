/* ============================================================
   Our Sailing Adventure — app.js
   Loads trips.json, renders map + route + markers + timeline.
   ============================================================ */

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
    const res = await fetch('trips.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load trips.json (${res.status})`);
    const data = await res.json();
    trips = (data.trips || []).slice().sort(byDateAsc);
  } catch (err) {
    console.error(err);
    showError('Could not load trips.json');
    return;
  }

  if (!trips.length) {
    showError('No trips yet — add some to trips.json');
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
// Map setup
// ------------------------------------------------------------
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
