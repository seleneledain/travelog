# Our Sailing Adventure

A static travel-journal site: Leaflet map + horizontal timeline of stops.
No build step, no framework, no backend. Just three files and one JSON.

## Files

```
.
├── index.html      — page structure
├── styles.css      — all styling
├── app.js          — map + timeline logic
├── trips.json      — your data (edit this!)
└── photos/         — drop your own photos here (optional)
```

---

## Running it locally

You can't just double-click `index.html` — the browser will refuse to load
`trips.json` from the file system (CORS). Run a tiny local server:

**Option A — VS Code:**
Install the **Live Server** extension, right-click `index.html` →
*"Open with Live Server"*. Done.

**Option B — terminal (Python):**
```bash
cd travel-site
python3 -m http.server 8000
# then open http://localhost:8000
```

**Option C — terminal (Node):**
```bash
npx serve .
```

---

## Editing your trips

Open `trips.json` and add an entry per stop. The newest one (latest date)
is automatically treated as your **current location** — it gets the
pulsing terracotta dot and a "now" badge in the timeline.

Each entry looks like this:

```json
{
  "id":      "unique-string",
  "date":    "2026-04-22",
  "place":   "Shelter Bay",
  "country": "Panama",
  "lat":     9.3700,
  "lng":   -79.9500,
  "note":    "Optional one-liner shown in the popup.",
  "photo":   "https://... or photos/myshot.jpg",
  "links": [
    { "platform": "instagram", "url": "https://instagram.com/p/abc123/" },
    { "platform": "tiktok",    "url": "https://tiktok.com/@you/video/..." },
    { "platform": "youtube",   "url": "https://youtu.be/..." },
    { "platform": "blog",      "url": "https://...", "label": "Read the log" }
  ]
}
```

**Required:** `id`, `date`, `place`, `lat`, `lng`
**Optional:** everything else

### Finding lat/lng for a place

Easiest: go to [Google Maps](https://maps.google.com), right-click the spot,
click the coordinates at the top of the menu — they're copied to your clipboard.
First number is `lat`, second is `lng`.

### Photos

Two options:
1. **External URL** — paste any public image URL into `photo`.
2. **Local file** — drop the image in the `photos/` folder, then use
   `"photo": "photos/myshot.jpg"`.

### Social embeds

For now this is just a labelled link button — the user clicks it and is
taken to the actual Instagram/TikTok/YouTube post in a new tab.
(True inline embeds are a v2 feature; the platform widgets are clunky and
slow inside popups.)

---

## Editing the "About" text

Open `index.html`, find the `<div class="modal" id="about-modal">` block,
and rewrite the paragraphs inside `<article class="modal-card">`.

---

## Deploying for free (GitHub Pages)

1. Create a new GitHub repo (e.g. `sailing-adventure`).
2. Upload all the files (`index.html`, `styles.css`, `app.js`,
   `trips.json`, plus `photos/` if you have local images).
3. In the repo: **Settings → Pages → Source: `main` branch / root**.
4. After ~1 minute, your site is live at
   `https://<your-username>.github.io/sailing-adventure/`.

Updating later: edit `trips.json` in GitHub directly (pencil icon →
commit). The site updates within a minute.

### Custom domain (optional, ~$12/yr)

Buy a domain (Namecheap, Cloudflare Registrar). In the repo's
**Settings → Pages → Custom domain**, enter your domain. Add a
CNAME record at your registrar pointing to `<username>.github.io`.

---

## What's included in v1

- Light, paper-textured editorial design
- Light/standard map tiles (warmly tinted)
- Horizontal timeline strip, newest-first
- Solid line connecting all stops in date order
- Pulsing terracotta dot for current location
- Click marker → popup with date, place, note, photo, social links
- "About" button (top-right) opening a modal
- Mobile-friendly layout

## What's *not* in v1 (planned later)

- True inline social media embeds (just links for now)
- Auto-import from YouTube API
- Phone GPS auto-update
- A form/admin UI to add entries (you edit `trips.json` directly)

---

Built with [Leaflet](https://leafletjs.com/) and
[OpenStreetMap](https://www.openstreetmap.org/) tiles. Free forever.
