/* StormMap service worker — offline app shell, last-known data, cached map tiles.
 * Requires HTTPS (or localhost). Bump VERSION when the shell changes. */
'use strict';

const VERSION = 'sm-v2';
// v2: tile cache renamed so CARTO "API key required" tiles cached by v1 are dropped
const SHELL = `${VERSION}-shell`, API = 'sm-api', TILES = 'sm-tiles-v2';
const TILE_MAX = 6000;
const SHELL_FILES = [
  '/', 'index.html', 'manifest.webmanifest', 'css/app.css', 'css/retro.css',
  'vendor/leaflet/leaflet.css', 'vendor/leaflet/leaflet.js', 'vendor/chartjs/chart.umd.min.js',
  'js/util.js', 'js/i18n.js', 'js/units.js', 'js/icons.js', 'js/scales.js', 'js/field.js', 'js/particles.js',
  'js/radar.js', 'js/lightning.js', 'js/tracker.js', 'js/zones.js', 'js/sun.js', 'js/obs.js', 'js/alerts.js',
  'js/chaselog.js', 'js/tools.js', 'js/sections.js', 'js/ranking.js', 'js/safety.js', 'js/warn.js',
  'js/offline.js', 'js/skewt.js', 'js/drawer.js', 'js/app.js',
  'data/countries.geojson', 'data/cities.json', 'data/cities_uk.json', 'icons/icon-192.png',
];
// API responses worth keeping for offline use (everything else is network-only)
const API_KEEP = /^\/api\/(meta|grid|timeline|zones|oblasts|hazards|airalerts|warn\/active|warn\/status|outlook|warnings|forecast|meteogram|sounding|radar\/frames|radar\/tile|obs)/;
const TILE_HOSTS = /(basemaps\.cartocdn\.com|server\.arcgisonline\.com|tile\.openstreetmap\.org)$/;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => (k.endsWith('-shell') && k !== SHELL) || (k.startsWith('sm-tiles') && k !== TILES)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

async function notify(type, detail) {
  const cs = await self.clients.matchAll();
  cs.forEach(c => c.postMessage({ type, detail }));
}

async function markOffline(res) {
  const h = new Headers(res.headers);
  h.set('X-SM-Offline', '1');
  const date = res.headers.get('X-SM-Stored');
  notify('offline-data', { stored: date ? +date : null });
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: h });
}

async function apiNetworkFirst(req) {
  const cache = await caches.open(API);
  try {
    const res = await withTimeout(fetch(req), req.url.includes('/radar/tile') ? 15000 : 25000);
    if (res.ok) {
      const h = new Headers(res.headers);
      h.set('X-SM-Stored', String(Date.now()));
      cache.put(req, new Response(await res.clone().blob(), { status: res.status, headers: h }));
      notify('online');
    }
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return markOffline(hit);
    return new Response(JSON.stringify({ error: 'Offline and no cached copy of this data' }),
      { status: 503, headers: { 'Content-Type': 'application/json', 'X-SM-Offline': '1' } });
  }
}

async function trimTiles() {
  const c = await caches.open(TILES);
  const keys = await c.keys();
  if (keys.length > TILE_MAX) await Promise.all(keys.slice(0, keys.length - TILE_MAX).map(k => c.delete(k)));
}

let putCount = 0;
async function tileCacheFirst(req) {
  const c = await caches.open(TILES);
  const hit = await c.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') {
      c.put(req, res.clone());
      if (++putCount % 200 === 0) trimTiles();
    }
    return res;
  } catch (e) {
    return new Response('', { status: 504 });
  }
}

async function shellStaleWhileRevalidate(req) {
  const c = await caches.open(SHELL);
  const hit = await c.match(req, { ignoreSearch: true });
  const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
  if (hit) return hit;
  const res = await net;
  if (res) return res;
  if (req.mode === 'navigate') return c.match('index.html');
  return new Response('', { status: 504 });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/api/')) {
      if (API_KEEP.test(url.pathname)) e.respondWith(apiNetworkFirst(req));
      return;
    }
    if (req.mode === 'navigate') {
      e.respondWith(fetch(req).catch(() => caches.open(SHELL).then(c => c.match('index.html'))));
      return;
    }
    e.respondWith(shellStaleWhileRevalidate(req));
    return;
  }
  if (TILE_HOSTS.test(url.hostname)) e.respondWith(tileCacheFirst(req));
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'clear-tiles') e.waitUntil(caches.delete(TILES));
});
