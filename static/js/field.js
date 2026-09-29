/* StormMap — canvas layers for gridded model fields, contours and wind barbs */
'use strict';

(function () {
  /** A regular lat/lon grid with NaN gaps, built from the sparse API payload. */
  class Grid {
    constructor(def, idx, values) {
      this.step = def.step; this.lat0 = def.lat0; this.lon0 = def.lon0;
      this.nlat = def.nlat; this.nlon = def.nlon;
      this.v = new Float32Array(def.nlat * def.nlon).fill(NaN);
      for (let i = 0; i < idx.length; i++) {
        const x = values[i];
        if (x != null) this.v[idx[i]] = x;
      }
    }
    sample(lat, lon) {
      const gy = (lat - this.lat0) / this.step, gx = (lon - this.lon0) / this.step;
      const y0 = Math.floor(gy), x0 = Math.floor(gx);
      if (y0 < 0 || x0 < 0 || y0 >= this.nlat - 1 || x0 >= this.nlon - 1) return NaN;
      const fy = gy - y0, fx = gx - x0, n = this.nlon, v = this.v;
      const a = v[y0 * n + x0], b = v[y0 * n + x0 + 1], c = v[(y0 + 1) * n + x0], d = v[(y0 + 1) * n + x0 + 1];
      const w = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
      let s = 0, ws = 0;
      if (a === a) { s += a * w[0]; ws += w[0]; }
      if (b === b) { s += b * w[1]; ws += w[1]; }
      if (c === c) { s += c * w[2]; ws += w[2]; }
      if (d === d) { s += d * w[3]; ws += w[3]; }
      return ws > 0.35 ? s / ws : NaN;
    }
    nearest(lat, lon) {
      const iy = Math.round((lat - this.lat0) / this.step), ix = Math.round((lon - this.lon0) / this.step);
      if (iy < 0 || ix < 0 || iy >= this.nlat || ix >= this.nlon) return NaN;
      return this.v[iy * this.nlon + ix];
    }
  }
  SM.Grid = Grid;

  /** Base canvas layer that repaints on every map move. */
  const CanvasLayer = L.Layer.extend({
    initialize(opts) { L.setOptions(this, opts); },
    onAdd(map) {
      this._map = map;
      this._canvas = L.DomUtil.create('canvas', 'field-canvas leaflet-zoom-hide');
      this._canvas.style.position = 'absolute';
      this._canvas.style.opacity = this.options.opacity == null ? 1 : this.options.opacity;
      map.getPane(this.options.pane || 'overlayPane').appendChild(this._canvas);
      map.on('moveend zoomend resize', this._reset, this);
      this._reset();
    },
    onRemove(map) {
      map.off('moveend zoomend resize', this._reset, this);
      this._canvas.remove();
    },
    setOpacity(o) { this.options.opacity = o; if (this._canvas) this._canvas.style.opacity = o; },
    redraw() { if (this._map) this._reset(); },
    _reset() {
      const map = this._map, size = map.getSize();
      if (size.x < 2 || size.y < 2) return;
      const tl = map.containerPointToLayerPoint([0, 0]);
      L.DomUtil.setPosition(this._canvas, tl);
      const dpr = this.options.hidpi ? (window.devicePixelRatio || 1) : 1;
      this._canvas.width = size.x * dpr; this._canvas.height = size.y * dpr;
      this._canvas.style.width = size.x + 'px'; this._canvas.style.height = size.y + 'px';
      const ctx = this._canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.x, size.y);
      this.draw(ctx, size, map);
    },
    // precomputed lat per row / lon per column for fast raster rendering (Web Mercator)
    axes(size, map, cell) {
      const w = Math.ceil(size.x / cell), h = Math.ceil(size.y / cell);
      const lons = new Float64Array(w), lats = new Float64Array(h);
      for (let i = 0; i < w; i++) lons[i] = map.containerPointToLatLng([i * cell + cell / 2, 0]).lng;
      for (let j = 0; j < h; j++) lats[j] = map.containerPointToLatLng([0, j * cell + cell / 2]).lat;
      return { w, h, lons, lats };
    },
  });

  /** Colour-shaded model field. */
  SM.FieldLayer = CanvasLayer.extend({
    options: { pane: 'fieldPane', opacity: 0.7 },
    setData(grid, key) { this._grid = grid; this._key = key; this.redraw(); },
    draw(ctx, size, map) {
      const g = this._grid, key = this._key;
      if (!g || !key) return;
      const cell = 3;
      const { w, h, lons, lats } = this.axes(size, map, cell);
      const img = new ImageData(w, h);
      const d = img.data;
      const categorical = SM.scales[key] && SM.scales[key].categorical;
      for (let j = 0; j < h; j++) {
        const lat = lats[j];
        for (let i = 0; i < w; i++) {
          const v = categorical ? g.nearestSmooth(lat, lons[i]) : g.sample(lat, lons[i]);
          if (v !== v) continue;
          const c = SM.colorFor(key, v);
          if (!c) continue;
          const o = (j * w + i) * 4;
          d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = c[3];
        }
      }
      const off = document.createElement('canvas');
      off.width = w; off.height = h;
      off.getContext('2d').putImageData(img, 0, 0);
      ctx.save();
      const clip = SM.coverageClip && SM.coverageClip(map);
      if (clip) ctx.clip(clip, 'evenodd');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(off, 0, 0, w * cell, h * cell);
      ctx.restore();
    },
  });

  // Categorical fields: bilinear then round, so category edges look smooth instead of blocky.
  Grid.prototype.nearestSmooth = function (lat, lon) {
    const s = this.sample(lat, lon);
    return s !== s ? NaN : Math.floor(s + 0.25);
  };

  /** Path2D of the selected countries in container pixels (field rendering is clipped to it). */
  SM.coverageClip = function (map) {
    const gj = SM.countriesGeo;
    if (!gj) return null;
    const region = SM.state.region;
    const path = new Path2D();
    const b = map.getBounds().pad(0.2);
    for (const f of gj.features) {
      if (region && region !== 'ALL' && f.properties.code !== region) continue;
      for (const poly of f.geometry.coordinates) {
        for (const ring of poly) {
          let x0 = 180, x1 = -180, y0 = 90, y1 = -90;
          for (const c of ring) { if (c[0] < x0) x0 = c[0]; if (c[0] > x1) x1 = c[0]; if (c[1] < y0) y0 = c[1]; if (c[1] > y1) y1 = c[1]; }
          if (!b.intersects([[y0, x0], [y1, x1]])) continue;
          ring.forEach((c, i) => {
            const p = map.latLngToContainerPoint([c[1], c[0]]);
            if (i) path.lineTo(p.x, p.y); else path.moveTo(p.x, p.y);
          });
          path.closePath();
        }
      }
    }
    return path;
  };

  /** Iso-lines (marching squares on a 3× refined grid). */
  SM.ContourLayer = CanvasLayer.extend({
    options: { pane: 'fieldPane', opacity: 0.9, hidpi: true, interval: 4, color: 'rgba(255,255,255,0.75)', bold: 24 },
    setData(grid) { this._grid = grid; this.redraw(); },
    draw(ctx, size, map) {
      const g = this._grid;
      if (!g) return;
      const R = 3, st = g.step / R;
      const ny = (g.nlat - 1) * R + 1, nx = (g.nlon - 1) * R + 1;
      const f = new Float32Array(ny * nx);
      let lo = Infinity, hi = -Infinity;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const v = g.sample(g.lat0 + j * st, g.lon0 + i * st);
        f[j * nx + i] = v;
        if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; }
      }
      if (lo === Infinity) return;
      const iv = this.options.interval;
      const pt = (j, i) => map.latLngToContainerPoint([g.lat0 + j * st, g.lon0 + i * st]);
      ctx.lineJoin = 'round';
      ctx.font = '600 10px JetBrains Mono, monospace';
      const labels = [];
      for (let lvl = Math.ceil(lo / iv) * iv; lvl <= hi; lvl += iv) {
        const bold = lvl % this.options.bold === 0;
        ctx.strokeStyle = bold ? 'rgba(255,255,255,0.9)' : this.options.color;
        ctx.lineWidth = bold ? 1.8 : 1;
        ctx.beginPath();
        let labeled = 0;
        for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
          const a = f[j * nx + i], b = f[j * nx + i + 1], c = f[(j + 1) * nx + i + 1], d = f[(j + 1) * nx + i];
          if (a !== a || b !== b || c !== c || d !== d) continue;
          const idx = (a > lvl) | ((b > lvl) << 1) | ((c > lvl) << 2) | ((d > lvl) << 3);
          if (idx === 0 || idx === 15) continue;
          const e = [];
          const lerp = (v0, v1) => (lvl - v0) / (v1 - v0);
          if ((a > lvl) !== (b > lvl)) e.push([j, i + lerp(a, b)]);
          if ((b > lvl) !== (c > lvl)) e.push([j + lerp(b, c), i + 1]);
          if ((d > lvl) !== (c > lvl)) e.push([j + 1, i + lerp(d, c)]);
          if ((a > lvl) !== (d > lvl)) e.push([j + lerp(a, d), i]);
          for (let k = 0; k + 1 < e.length; k += 2) {
            const p = pt(e[k][0], e[k][1]), q = pt(e[k + 1][0], e[k + 1][1]);
            ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
            if (!labeled && (j * 7 + i * 13) % 97 === 0 && p.x > 30 && p.y > 30 && p.x < size.x - 30 && p.y < size.y - 30) {
              labels.push([p.x, p.y, lvl]); labeled = 1;
            }
          }
        }
        ctx.stroke();
      }
      for (const [x, y, lvl] of labels) {
        const t = String(Math.round(lvl));
        const w = ctx.measureText(t).width + 6;
        ctx.fillStyle = 'rgba(4,5,7,0.85)';
        ctx.fillRect(x - w / 2, y - 7, w, 14);
        ctx.fillStyle = '#fff';
        ctx.fillText(t, x - w / 2 + 3, y + 4);
      }
    },
  });

  /** Wind barbs (knots) on a zoom-dependent subset of grid points. */
  SM.BarbLayer = CanvasLayer.extend({
    options: { pane: 'fieldPane', opacity: 0.9, hidpi: true },
    setData(u, v, coords) { this._u = u; this._v = v; this._coords = coords; this.redraw(); },
    draw(ctx, size, map) {
      if (!this._u) return;
      const minPx = 38;
      const placed = [];
      ctx.strokeStyle = 'rgba(235,240,248,0.9)';
      ctx.fillStyle = 'rgba(235,240,248,0.9)';
      ctx.lineWidth = 1.2;
      for (let k = 0; k < this._coords.length; k++) {
        const u = this._u[k], v = this._v[k];
        if (u == null || v == null) continue;
        const p = map.latLngToContainerPoint(this._coords[k]);
        if (p.x < -20 || p.y < -20 || p.x > size.x + 20 || p.y > size.y + 20) continue;
        if (placed.some(q => Math.abs(q.x - p.x) < minPx && Math.abs(q.y - p.y) < minPx)) continue;
        placed.push(p);
        drawBarb(ctx, p.x, p.y, u, v);
      }
    },
  });

  function drawBarb(ctx, x, y, u, v) {
    const kt = Math.hypot(u, v) * 1.943844;
    const len = 22;
    const ang = Math.atan2(-u, -v); // direction wind comes FROM (radians, clockwise from north)
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    if (kt < 2.5) { ctx.beginPath(); ctx.arc(0, 0, 3, 0, 2 * Math.PI); ctx.stroke(); ctx.restore(); return; }
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -len); ctx.stroke();
    let rem = Math.round(kt / 5) * 5, pos = -len;
    while (rem >= 50) {
      ctx.beginPath(); ctx.moveTo(0, pos); ctx.lineTo(9, pos + 3); ctx.lineTo(0, pos + 6); ctx.closePath(); ctx.fill();
      pos += 7; rem -= 50;
    }
    while (rem >= 10) { ctx.beginPath(); ctx.moveTo(0, pos); ctx.lineTo(10, pos - 4); ctx.stroke(); pos += 4; rem -= 10; }
    if (rem >= 5) { if (pos === -len) pos += 4; ctx.beginPath(); ctx.moveTo(0, pos); ctx.lineTo(5, pos - 2); ctx.stroke(); }
    ctx.restore();
    ctx.beginPath(); ctx.arc(x, y, 1.4, 0, 2 * Math.PI); ctx.fill();
  }
  SM.drawBarb = drawBarb;
})();
