/* StormMap — live lightning (Blitzortung.org community network) */
'use strict';

(function () {
  const WINDOW_MS = 30 * 60 * 1000;
  const SERVERS = ['wss://ws1.blitzortung.org/', 'wss://ws7.blitzortung.org/', 'wss://ws8.blitzortung.org/'];

  const LX = SM.lightning = {
    strikes: [],      // {lat, lon, t(ms)}
    enabled: true,
    ws: null,
    serverIdx: Math.floor(Math.random() * SERVERS.length),
    failures: 0,
    lastMsg: 0,
  };

  // Blitzortung frames are LZW-style compressed JSON strings.
  function decode(b) {
    const dict = {};
    const data = b.split('');
    let c = data[0], f = c;
    const out = [c];
    let code = 256;
    for (let i = 1; i < data.length; i++) {
      const cc = data[i].charCodeAt(0);
      const a = cc < 256 ? data[i] : (dict[cc] ? dict[cc] : f + c);
      out.push(a);
      c = a.charAt(0);
      dict[code++] = f + c;
      f = a;
    }
    return out.join('');
  }

  function inRegion(lat, lon) {
    const b = SM.meta.region_bounds; // [latmin, latmax, lonmin, lonmax]
    return lat >= b[0] - 1 && lat <= b[1] + 1 && lon >= b[2] - 2 && lon <= b[3] + 2;
  }

  function add(lat, lon, t) {
    if (!inRegion(lat, lon)) return;
    LX.strikes.push({ lat, lon, t });
    LX.lastMsg = Date.now();
  }

  function prune() {
    const cut = Date.now() - WINDOW_MS;
    let i = 0;
    while (i < LX.strikes.length && LX.strikes[i].t < cut) i++;
    if (i) LX.strikes.splice(0, i);
  }

  function connect() {
    if (!LX.enabled || SM.meta.demo) return;
    const url = SERVERS[LX.serverIdx % SERVERS.length];
    SM.status('stLightning', 'busy', 'Connecting to ' + url);
    let ws;
    try { ws = new WebSocket(url); } catch (e) { return retry(); }
    LX.ws = ws;
    ws.onopen = () => { ws.send('{"a":111}'); LX.failures = 0; SM.status('stLightning', 'ok', 'Lightning: Blitzortung live'); };
    ws.onmessage = ev => {
      try {
        const d = JSON.parse(decode(ev.data));
        if (d.lat != null && d.lon != null) add(d.lat, d.lon, d.time ? Math.round(d.time / 1e6) : Date.now());
      } catch (e) { /* ignore malformed frame */ }
    };
    ws.onerror = () => {};
    ws.onclose = () => { if (LX.ws === ws) { LX.ws = null; retry(); } };
  }

  function retry() {
    if (!LX.enabled) return;
    LX.failures++;
    LX.serverIdx++;
    SM.status('stLightning', 'err', 'Lightning feed reconnecting…');
    setTimeout(connect, Math.min(60000, 2000 * LX.failures));
  }

  async function pollDemo() {
    if (!LX.enabled) return;
    try {
      const since = LX.strikes.length ? LX.strikes[LX.strikes.length - 1].t : Date.now() - 10 * 60000;
      const d = await SM.api('demo/strikes', { since });
      for (const s of d.strikes) add(s.lat, s.lon, s.time);
      LX.strikes.sort((a, b) => a.t - b.t);
      SM.status('stLightning', 'ok', 'Lightning: demo feed');
    } catch (e) { SM.status('stLightning', 'err', e.message); }
  }

  /** Strike count within r km of a point over the last `ms` milliseconds (optionally offset). */
  LX.countNear = function (lat, lon, rKm, ms, offsetMs = 0) {
    const now = Date.now();
    const t1 = now - offsetMs, t0 = t1 - ms;
    const dLat = rKm / 111, dLon = rKm / (111 * Math.cos(lat * Math.PI / 180));
    let n = 0;
    for (let i = LX.strikes.length - 1; i >= 0; i--) {
      const s = LX.strikes[i];
      if (s.t < t0) break;
      if (s.t > t1) continue;
      if (Math.abs(s.lat - lat) < dLat && Math.abs(s.lon - lon) < dLon) n++;
    }
    return n;
  };

  LX.rate = function () {
    const cut = Date.now() - 60000;
    let n = 0;
    for (let i = LX.strikes.length - 1; i >= 0 && LX.strikes[i].t >= cut; i--) n++;
    return n;
  };

  /** Canvas layer: strikes coloured by age. */
  const StrikeLayer = L.Layer.extend({
    onAdd(map) {
      this._map = map;
      this._c = L.DomUtil.create('canvas', 'field-canvas leaflet-zoom-hide');
      this._c.style.position = 'absolute';
      map.getPane('lightningPane').appendChild(this._c);
      map.on('moveend zoomend resize', this.redraw, this);
      this.redraw();
    },
    onRemove(map) { map.off('moveend zoomend resize', this.redraw, this); this._c.remove(); },
    redraw() {
      const map = this._map;
      if (!map) return;
      const size = map.getSize(), dpr = window.devicePixelRatio || 1;
      L.DomUtil.setPosition(this._c, map.containerPointToLayerPoint([0, 0]));
      this._c.width = size.x * dpr; this._c.height = size.y * dpr;
      this._c.style.width = size.x + 'px'; this._c.style.height = size.y + 'px';
      const ctx = this._c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const now = Date.now();
      const b = map.getBounds().pad(0.05);
      for (const s of LX.strikes) {
        if (!b.contains([s.lat, s.lon])) continue;
        const age = (now - s.t) / 60000;
        const p = map.latLngToContainerPoint([s.lat, s.lon]);
        let col, r = 3;
        if (age < 1) { col = '#ffffff'; r = 5; } else if (age < 5) col = '#fde047'; else if (age < 10) col = '#fb923c'; else if (age < 20) col = '#ef4444'; else col = '#7f1d1d';
        ctx.strokeStyle = col;
        ctx.lineWidth = age < 1 ? 2 : 1.4;
        ctx.beginPath();
        ctx.moveTo(p.x - r, p.y); ctx.lineTo(p.x + r, p.y);
        ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x, p.y + r);
        ctx.stroke();
        if (age < 0.25) { ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, 6.283); ctx.stroke(); }
      }
    },
  });

  LX.setEnabled = function (on) {
    LX.enabled = on;
    if (on) {
      LX.layer.addTo(SM.map);
      if (SM.meta.demo) pollDemo(); else if (!LX.ws) connect();
    } else {
      SM.map.removeLayer(LX.layer);
      if (LX.ws) { const w = LX.ws; LX.ws = null; w.close(); }
      SM.status('stLightning', null, 'Lightning off');
    }
  };

  LX.init = function () {
    LX.layer = new StrikeLayer();
    LX.setEnabled(true);
    setInterval(() => { prune(); if (LX.enabled) LX.layer.redraw(); }, 2000);
    if (SM.meta.demo) setInterval(pollDemo, 5000);
  };
})();
