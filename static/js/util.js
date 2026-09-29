/* StormMap — shared utilities */
'use strict';

const SM = window.SM = {
  state: {},
  meta: null,
  map: null,
  bus: new EventTarget(),
};

SM.on = (type, fn) => SM.bus.addEventListener(type, e => fn(e.detail));
SM.emit = (type, detail) => SM.bus.dispatchEvent(new CustomEvent(type, { detail }));

SM.api = async function (path, params = {}, opts = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = '/api/' + path + (qs ? '?' + qs : '');
  const res = await fetch(url, { signal: opts.signal });
  let body;
  try { body = await res.json(); } catch (e) { body = { error: 'Invalid response' }; }
  if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
  return body;
};

SM.$ = (sel, root = document) => root.querySelector(sel);
SM.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
SM.el = (tag, attrs = {}, html) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  if (html != null) e.innerHTML = html;
  return e;
};
SM.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

SM.fmt = function (v, nd = 0, unit = '') {
  if (v == null || Number.isNaN(v)) return '—';
  return Number(v).toFixed(nd) + unit;
};
SM.pad = n => String(n).padStart(2, '0');
SM.utcHM = t => { const d = new Date(t * 1000); return SM.pad(d.getUTCHours()) + ':' + SM.pad(d.getUTCMinutes()); };
SM.utcLabel = t => {
  const d = new Date(t * 1000);
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
  return `${wd} ${SM.pad(d.getUTCDate())} ${SM.pad(d.getUTCHours())}Z`;
};
SM.localHM = t => { const d = new Date(t * 1000); return SM.pad(d.getHours()) + ':' + SM.pad(d.getMinutes()); };

let toastTimer;
SM.toast = function (msg, isErr = false, ms = 4500) {
  const t = SM.$('#toast');
  t.textContent = msg;
  t.classList.toggle('err', isErr);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
};

const loadingSet = new Map();
SM.loading = function (key, text) {
  if (text) loadingSet.set(key, text); else loadingSet.delete(key);
  const box = SM.$('#loading');
  if (!loadingSet.size) { box.hidden = true; return; }
  box.hidden = false;
  SM.$('#loadingText').textContent = Array.from(loadingSet.values()).slice(-1)[0];
};

SM.status = function (id, cls, title) {
  const p = SM.$('#' + id);
  if (!p) return;
  p.classList.remove('ok', 'busy', 'err');
  if (cls) p.classList.add(cls);
  if (title) p.title = title;
};

/* ---------- Geo ---------- */
SM.geo = {
  R: 6371,
  dist(lat1, lon1, lat2, lon2) {
    const r = Math.PI / 180;
    const dp = (lat2 - lat1) * r, dl = (lon2 - lon1) * r;
    const a = Math.sin(dp / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dl / 2) ** 2;
    return 2 * this.R * Math.asin(Math.sqrt(a));
  },
  bearing(lat1, lon1, lat2, lon2) {
    const r = Math.PI / 180;
    const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
    const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  },
  compass(deg) {
    return ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.floor(((deg + 11.25) % 360) / 22.5)];
  },
  // move a point by (east km, north km)
  offset(lat, lon, ekm, nkm) {
    return [lat + nkm / 111.32, lon + ekm / (111.32 * Math.cos(lat * Math.PI / 180))];
  },
  // local tangent-plane km offsets of b relative to a
  enu(a, b) {
    return [(b[1] - a[1]) * 111.32 * Math.cos(a[0] * Math.PI / 180), (b[0] - a[0]) * 111.32];
  },
  tile2lon(x, z) { return x / 2 ** z * 360 - 180; },
  tile2lat(y, z) { const n = Math.PI - 2 * Math.PI * y / 2 ** z; return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); },
  lon2tile(lon, z) { return (lon + 180) / 360 * 2 ** z; },
  lat2tile(lat, z) { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z; },
};

SM.cities = [];
SM.nearestCity = function (lat, lon) {
  let best = null, bd = 1e9;
  for (const c of SM.cities) {
    const d = SM.geo.dist(lat, lon, c[2], c[3]);
    if (d < bd) { bd = d; best = c; }
  }
  if (!best) return { label: `${lat.toFixed(2)}, ${lon.toFixed(2)}`, country: null };
  const dir = SM.geo.compass(SM.geo.bearing(best[2], best[3], lat, lon));
  return {
    name: best[0], country: best[1], dist: bd,
    label: bd < 8 ? best[0] : `${Math.round(bd)} km ${dir} of ${best[0]}`,
  };
};

SM.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/* Chart.js dark defaults */
if (window.Chart) {
  Chart.defaults.color = '#8b93a7';
  Chart.defaults.borderColor = '#1a1f2b';
  Chart.defaults.font.family = getComputedStyle(document.documentElement).getPropertyValue('--font') || 'Inter, sans-serif';
  Chart.defaults.font.size = 11;
  Chart.defaults.plugins.legend.labels.boxWidth = 10;
  Chart.defaults.plugins.legend.labels.boxHeight = 10;
  Chart.defaults.animation = false;
  Chart.defaults.maintainAspectRatio = false;
}
