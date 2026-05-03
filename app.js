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
const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRRh6LTKUeoHXTefmZt-QvTF4r-X7YUp_j_i2nzeU0Chh1o2v3FRVt50EpIFcagGGBX_O-mTAgpJy20/pub?gid=1904084294&single=true&output=csv';

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

  // Assign a unique internal key to each trip — `id` may legitimately
  // repeat (same place visited twice), and date can repeat too, so we
  // can't rely on either for Map keys / DOM lookups.
  trips.forEach((t, i) => { t._key = `${t.id || 'stop'}-${i}`; });

  renderRoute(trips);
  renderMarkers(trips);
  renderTimeline(trips);
  updateStats(trips);
  fitToTrips(trips, { padding: [60, 60], animate: false });

  // Belt-and-suspenders: if the map container's size wasn't fully
  // resolved when Leaflet initialised (can happen if fonts/layout
  // shift after first paint), force it to remeasure now.
  map.invalidateSize();
  window.addEventListener('resize', () => map.invalidateSize());

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

  // Detect coordinate collisions and assign a small angular offset
  // to each marker that shares a spot with an earlier one. Without
  // this, repeat visits stack on top of each other and only the top
  // marker is clickable.
  const seenAt = new Map(); // "lat,lng" rounded -> array of indices
  list.forEach((trip, idx) => {
    const k = `${trip.lat.toFixed(4)},${trip.lng.toFixed(4)}`;
    if (!seenAt.has(k)) seenAt.set(k, []);
    seenAt.get(k).push(idx);
  });

  list.forEach((trip, idx) => {
    const isCurrent = idx === lastIdx;

    // Compute display position: nudge into a small ring if this
    // coordinate is shared by 2+ stops. ~1.5km radius is enough to
    // separate them visibly without lying about the location.
    const cluster = seenAt.get(`${trip.lat.toFixed(4)},${trip.lng.toFixed(4)}`);
    let lat = trip.lat, lng = trip.lng;
    if (cluster && cluster.length > 1) {
      const pos = cluster.indexOf(idx);
      const angle = (2 * Math.PI * pos) / cluster.length;
      const radius = 0.0135; // ~1.5km
      lat = trip.lat + radius * Math.cos(angle);
      lng = trip.lng + radius * Math.sin(angle) / Math.cos(trip.lat * Math.PI / 180);
    }

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

    const marker = L.marker([lat, lng], {
      icon,
      riseOnHover: true,
      title: `${trip.place}${trip.country ? ', ' + trip.country : ''} · ${formatDate(trip.date)}`
    }).addTo(map);

    marker.bindPopup(buildPopupHtml(trip, isCurrent), {
      closeButton: true,
      autoPan: true,
      maxWidth: 300,
      minWidth: 290,
      offset: [0, -4]
    });

    marker.on('popupopen', () => highlightEntry(trip._key, false));
    marker.on('click', () => highlightEntry(trip._key, false));

    markersById.set(trip._key, marker);
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
// Timeline (oldest left → current right)
// ------------------------------------------------------------
function renderTimeline(list) {
  const tl = document.getElementById('timeline');
  tl.innerHTML = '';
  const lastIdx = list.length - 1;

  // oldest first — current location ends up on the right edge
  list.forEach((trip, idx) => {
    const isCurrent = idx === lastIdx;
    const el = document.createElement('div');
    el.className = 'entry' + (isCurrent ? ' current' : '');
    el.dataset.id = trip._key;
    el.innerHTML = `
      <div class="e-date">${formatDate(trip.date)}</div>
      <div class="e-place">${escapeHtml(trip.place)}${isCurrent ? '<span class="e-badge">now</span>' : ''}</div>
      <div class="e-country">${escapeHtml(trip.country || '')}</div>
    `;
    el.addEventListener('click', () => focusTrip(trip._key));
    tl.appendChild(el);
    entriesById.set(trip._key, el);
  });

  // Scroll the strip to the far right so the current location is
  // what the visitor sees first. Use rAF so layout has settled.
  requestAnimationFrame(() => {
    tl.scrollLeft = tl.scrollWidth;
  });
}

function highlightEntry(key, scroll = true) {
  entriesById.forEach((el, k) => {
    el.classList.toggle('active', k === key);
  });
  if (scroll) {
    const el = entriesById.get(key);
    if (el) el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }
}

function focusTrip(key) {
  const trip = trips.find(t => t._key === key);
  const marker = markersById.get(key);
  if (!trip || !marker) return;

  highlightEntry(key, true);
  const target = marker.getLatLng();
  map.flyTo(target, Math.max(map.getZoom(), 5), { duration: 0.5 });
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

// ------------------------------------------------------------
// Contact form
// ------------------------------------------------------------
// No backend — submitting opens the user's mail client with the
// message pre-filled. Easy upgrade path: replace the body of
// `sendContactMessage` with a fetch() to Formspree / Web3Forms /
// Netlify Forms / your own endpoint. Everything else (validation,
// honeypot, status messages, button states) stays the same.

const CONTACT_TO = 'hello@example.com'; // ← change this to your real address

initContactForm();

function initContactForm() {
  const form = document.getElementById('contact-form');
  if (!form) return;

  const status = document.getElementById('cf-status');
  const submit = form.querySelector('.cf-submit');

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    setStatus('');

    const data = {
      name:    form.name.value.trim(),
      email:   form.email.value.trim(),
      subject: form.subject.value.trim(),
      message: form.message.value.trim(),
      website: form.website.value.trim() // honeypot
    };

    // Honeypot: bots fill hidden fields. Silently accept-and-drop.
    if (data.website) {
      setStatus('Thanks — message sent.', 'success');
      form.reset();
      return;
    }

    // Validation
    if (!data.name)  return setStatus('Please tell us your name.', 'error');
    if (!isEmail(data.email)) return setStatus('That email looks off — mind checking it?', 'error');
    if (!data.message || data.message.length < 5) {
      return setStatus('Message is a bit short — say a little more?', 'error');
    }

    submit.disabled = true;
    setStatus('Opening your mail app…');

    try {
      await sendContactMessage(data);
      setStatus('Your mail app should now be open. Hit send to deliver it.', 'success');
      form.reset();
    } catch (err) {
      console.error(err);
      setStatus('Something went wrong. You can also email us directly.', 'error');
    } finally {
      submit.disabled = false;
    }
  });

  function setStatus(text, kind = '') {
    status.textContent = text;
    status.classList.remove('success', 'error');
    if (kind) status.classList.add(kind);
  }
}

async function sendContactMessage({ name, email, subject, message }) {
  // mailto fallback — works on every platform, requires no server
  const subj = subject || `Hello from ${name}`;
  const body = `${message}\n\n— ${name}\n${email}`;
  const href = `mailto:${CONTACT_TO}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`;
  window.location.href = href;
}

function isEmail(s) {
  // pragmatic, not RFC-perfect — catches the everyday typos
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

// ------------------------------------------------------------
// Scroll-to-top button — fades in once user moves past the hero
// ------------------------------------------------------------
initScrollTopBtn();

function initScrollTopBtn() {
  const btn = document.getElementById('scroll-top-btn');
  if (!btn) return;

  // Show the button once we've scrolled meaningfully past the start.
  // Threshold = 25% of viewport height — small enough that you don't
  // have to dig for it, large enough that it isn't visible at rest.
  const threshold = () => Math.max(160, window.innerHeight * 0.25);

  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY || document.documentElement.scrollTop;
      btn.classList.toggle('is-visible', y > threshold());
      ticking = false;
    });
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  // Run once on load in case the page starts already scrolled (anchor link, refresh)
  onScroll();

  btn.addEventListener('click', () => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({
      top: 0,
      behavior: reduceMotion ? 'auto' : 'smooth'
    });
  });
}