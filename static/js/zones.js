/* StormMap — no-go zones (occupied territory, front-line and border buffers) */
'use strict';

(function () {
  const Z = SM.zones = { data: null, grid: null, cls: null, front: 30, border: 20, enabled: true };
  const COLORS = { 1: [220, 38, 38, 0.42], 2: [148, 163, 184, 0.38], 3: [249, 115, 22, 0.16], 4: [234, 179, 8, 0.12] };

  try {
    const s = JSON.parse(localStorage.getItem('sm-zones') || '{}');
    if (s.front != null) Z.front = s.front;
    if (s.border != null) Z.border = s.border;
  } catch (e) { /* ignore */ }

  /** Class of a point: 0 free, 1 occupied, 2 contested, 3 front buffer, 4 border zone. */
  Z.at = function (lat, lon) {
    const g = Z.grid;
    if (!g || !Z.cls) return 0;
    const j = Math.floor((lat - g.lat0) / g.res), i = Math.floor((lon - g.lon0) / g.res);
    if (j < 0 || i < 0 || j >= g.nlat || i >= g.nlon) return 0;
    return Z.cls[j * g.nlon + i];
  };
  Z.label = c => (Z.data && Z.data.classes[c]) || '';

  /** Canvas layer painting the class raster row by row (exact in Web Mercator). */
  const MaskLayer = L.Layer.extend({
    onAdd(map) {
      this._map = map;
      this._c = L.DomUtil.create('canvas', 'field-canvas leaflet-zoom-hide');
      this._c.style.position = 'absolute';
      map.getPane('zonePane').appendChild(this._c);
      map.on('moveend zoomend resize', this.redraw, this);
      this.redraw();
    },
    onRemove(map) { map.off('moveend zoomend resize', this.redraw, this); this._c.remove(); },
    redraw() {
      const map = this._map, g = Z.grid;
      if (!map) return;
      const size = map.getSize(), dpr = window.devicePixelRatio || 1;
      L.DomUtil.setPosition(this._c, map.containerPointToLayerPoint([0, 0]));
      this._c.width = size.x * dpr; this._c.height = size.y * dpr;
      this._c.style.width = size.x + 'px'; this._c.style.height = size.y + 'px';
      const ctx = this._c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!g || !Z.img) return;
      // one source row → the projected pixel band of that latitude row
      const x0 = map.latLngToContainerPoint([g.lat0, g.lon0]).x;
      const x1 = map.latLngToContainerPoint([g.lat0, g.lon0 + g.nlon * g.res]).x;
      ctx.imageSmoothingEnabled = false;
      for (let j = 0; j < g.nlat; j++) {
        const yTop = map.latLngToContainerPoint([g.lat0 + (j + 1) * g.res, g.lon0]).y;
        const yBot = map.latLngToContainerPoint([g.lat0 + j * g.res, g.lon0]).y;
        if (yBot < 0 || yTop > size.y) continue;
        if (!Z.rowHas[j]) continue;
        ctx.drawImage(Z.img, 0, g.nlat - 1 - j, g.nlon, 1, x0, yTop, x1 - x0, Math.max(1, yBot - yTop + 0.5));
      }
      // hatch the hard zones for legibility
      if (map.getZoom() >= 6 && Z.hatch) {
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = Z.hatch;
        ctx.fillRect(0, 0, size.x, size.y);
        ctx.globalCompositeOperation = 'source-over';
      }
    },
  });

  function buildImage() {
    const g = Z.grid;
    const cv = document.createElement('canvas');
    cv.width = g.nlon; cv.height = g.nlat;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(g.nlon, g.nlat);
    Z.rowHas = new Uint8Array(g.nlat);
    for (let j = 0; j < g.nlat; j++) {
      const row = g.nlat - 1 - j; // image row 0 = north
      for (let i = 0; i < g.nlon; i++) {
        const c = Z.cls[j * g.nlon + i];
        if (!c) continue;
        Z.rowHas[j] = 1;
        const col = COLORS[c];
        const o = (row * g.nlon + i) * 4;
        img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = col[3] * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    Z.img = cv;
    const p = document.createElement('canvas');
    p.width = p.height = 10;
    const pc = p.getContext('2d');
    pc.strokeStyle = 'rgba(255,255,255,0.08)'; pc.lineWidth = 1;
    pc.beginPath(); pc.moveTo(0, 10); pc.lineTo(10, 0); pc.stroke();
    Z.hatch = pc.createPattern(p, 'repeat');
  }

  Z.load = async function () {
    SM.status('stZones', 'busy', 'Loading no-go zones…');
    try {
      const d = await SM.api('zones', { front: Z.front, border: Z.border });
      Z.data = d;
      Z.grid = d.grid;
      const cls = new Uint8Array(d.grid.nlat * d.grid.nlon);
      let k = 0;
      for (let r = 0; r < d.rle.length; r += 2) { cls.fill(d.rle[r], k, k + d.rle[r + 1]); k += d.rle[r + 1]; }
      Z.cls = cls;
      buildImage();
      Z.layer.redraw();
      if (Z.outline) SM.map.removeLayer(Z.outline);
      Z.outline = L.geoJSON(d.polygons, {
        pane: 'zonePane', interactive: false,
        style: f => ({ color: f.properties.class === 1 ? '#ef4444' : '#94a3b8', weight: 1.4, opacity: 0.9, fill: false }),
      });
      if (Z.enabled) Z.outline.addTo(SM.map);
      const m = d.meta;
      SM.status('stZones', m.fallback ? 'err' : 'ok', `No-go zones: ${m.source}`);
      Z.renderInfo();
      SM.emit('zones');
    } catch (e) {
      SM.status('stZones', 'err', 'No-go zones unavailable: ' + e.message);
      SM.$('#zoneInfo').innerHTML = `<div class="danger-banner">No-go zone data unavailable (${SM.esc(e.message)}). Do not rely on routes near the front line.</div>`;
    }
  };

  Z.renderInfo = function () {
    const d = Z.data;
    if (!d) return;
    const m = d.meta;
    const upd = m.updated ? SM.esc(String(m.updated).replace('T', ' ').slice(0, 16)) : '—';
    SM.$('#zoneInfo').innerHTML = `
      ${m.fallback ? `<div class="danger-banner">⚠ ${SM.esc(m.source)}. Precision about ±${m.precision_km} km. Routes are extra-cautious.</div>` : ''}
      <div class="zone-meta">
        <div><span>Source</span><b>${SM.esc(m.source)}</b></div>
        <div><span>Map date</span><b>${upd}</b></div>
        <div><span>Grid precision</span><b>~${m.precision_km} km (${m.resolution_deg}°)</b></div>
        <div><span>Occupied area</span><b>${Math.round(m.occupied_km2).toLocaleString()} km²</b></div>
      </div>
      <div class="zone-legend">
        <span><i style="background:rgba(220,38,38,.6)"></i>Occupied</span>
        <span><i style="background:rgba(148,163,184,.6)"></i>Contested</span>
        <span><i style="background:rgba(249,115,22,.35)"></i>Front buffer ${d.front_km} km</span>
        <span><i style="background:rgba(234,179,8,.3)"></i>Border zone ${d.border_km} km</span>
      </div>`;
  };

  Z.setEnabled = function (on) {
    Z.enabled = on;
    if (on) { Z.layer.addTo(SM.map); if (Z.outline) Z.outline.addTo(SM.map); }
    else { SM.map.removeLayer(Z.layer); if (Z.outline) SM.map.removeLayer(Z.outline); }
  };

  Z.setBuffers = SM.debounce(function (front, border) {
    Z.front = front; Z.border = border;
    try { localStorage.setItem('sm-zones', JSON.stringify({ front, border })); } catch (e) { /* ignore */ }
    Z.load();
  }, 400);

  Z.init = function () {
    Z.layer = new MaskLayer().addTo(SM.map);
    Z.load();
    setInterval(Z.load, 3 * 3600 * 1000);
  };
})();
