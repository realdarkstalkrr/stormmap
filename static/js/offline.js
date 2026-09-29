/* StormMap — offline support: service-worker registration, offline badge, "save this area" tile prefetch */
'use strict';

(function () {
  const O = SM.offline = { sw: false, cachedAt: null };
  const TILE_HOSTS = /(basemaps\.cartocdn\.com|server\.arcgisonline\.com|tile\.openstreetmap\.org)$/;
  const MAX_TILES = 2500;

  function badge() {
    const t = SM.$('#offlineTag');
    const off = !navigator.onLine || O.cachedAt != null;
    t.hidden = !off;
    t.title = O.cachedAt ? `No connection — showing data cached at ${SM.localHM(O.cachedAt / 1000)}` : 'No connection';
    t.textContent = O.cachedAt ? `OFFLINE · ${SM.localHM(O.cachedAt / 1000)}` : 'OFFLINE';
  }

  /** Tile URLs of the visible base/overlay tile layers for the current view, zoom z..z+depth. */
  function tileUrls(depth) {
    const layers = [];
    SM.map.eachLayer(l => {
      if (l instanceof L.TileLayer && !(l instanceof L.TileLayer.WMS) && l._url) {
        try { if (TILE_HOSTS.test(new URL(l._url.replace(/\{s\}/, 'a')).hostname)) layers.push(l); } catch (e) { /* ignore */ }
      }
    });
    const b = SM.map.getBounds(), z0 = Math.max(3, Math.round(SM.map.getZoom()));
    const urls = [];
    for (let z = z0; z <= Math.min(z0 + depth, 13); z++) {
      const x0 = Math.floor(SM.geo.lon2tile(b.getWest(), z)), x1 = Math.floor(SM.geo.lon2tile(b.getEast(), z));
      const y0 = Math.floor(SM.geo.lat2tile(b.getNorth(), z)), y1 = Math.floor(SM.geo.lat2tile(b.getSouth(), z));
      for (const l of layers) {
        const subs = l.options.subdomains || 'abc';
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
          urls.push(L.Util.template(l._url, Object.assign({}, l.options, {
            s: subs[Math.abs(x + y) % subs.length], x, y, z, r: l.options.detectRetina && L.Browser.retina ? '@2x' : '',
          })));
        }
      }
    }
    return urls;
  }

  O.saveArea = async function () {
    const info = SM.$('#offlineInfo');
    if (!O.sw) { SM.toast('Offline mode needs the app served over HTTPS (or localhost).', true, 8000); return; }
    let depth = 3, urls = tileUrls(depth);
    while (urls.length > MAX_TILES && depth > 0) urls = tileUrls(--depth);
    if (urls.length > MAX_TILES) { SM.toast('Zoom in further — the area is too large to store', true); return; }
    let done = 0, fail = 0;
    const queue = urls.slice();
    const worker = async () => {
      while (queue.length) {
        const u = queue.shift();
        try { await fetch(u, { mode: 'no-cors' }); done++; } catch (e) { fail++; }
        if ((done + fail) % 25 === 0) info.textContent = `Saving map tiles… ${done + fail}/${urls.length}`;
      }
    };
    info.textContent = `Saving map tiles… 0/${urls.length}`;
    // also make sure the safety layers are in the cache
    const apis = ['zones', 'oblasts', 'hazards', 'airalerts', 'warn/active', 'meta'].map(p => fetch('/api/' + p).catch(() => null));
    await Promise.all([...Array(6)].map(worker).concat(apis));
    info.textContent = `Saved ${done} tiles (zoom ${Math.round(SM.map.getZoom())}–${Math.round(SM.map.getZoom()) + depth})${fail ? `, ${fail} failed` : ''}. Model data you opened is kept too.`;
  };

  O.init = function () {
    window.addEventListener('online', () => { O.cachedAt = null; badge(); });
    window.addEventListener('offline', badge);
    badge();
    const btn = SM.$('#offlineSave');
    if (btn) btn.addEventListener('click', O.saveArea);
    if (!('serviceWorker' in navigator) || !window.isSecureContext) {
      if (SM.$('#offlineInfo')) SM.$('#offlineInfo').textContent = 'Offline mode needs HTTPS (or localhost).';
      return;
    }
    navigator.serviceWorker.register('sw.js').then(() => { O.sw = true; }).catch(e => { console.warn('service worker', e); });
    navigator.serviceWorker.addEventListener('message', e => {
      const m = e.data || {};
      if (m.type === 'offline-data') { O.cachedAt = (m.detail && m.detail.stored) || O.cachedAt || Date.now(); badge(); }
      if (m.type === 'online' && navigator.onLine && O.cachedAt) { O.cachedAt = null; badge(); }
    });
  };
})();
