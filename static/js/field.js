/* StormMap — canvas layers: gridded fields, isolines with H/L centres, city values, wind barbs */
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
    /** Bilinear interpolation tolerant to missing corners. */
    sample(lat, lon) {
      const gy = (lat - this.lat0) / this.step, gx = (lon - this.lon0) / this.step;
      const y0 = Math.floor(gy), x0 = Math.floor(gx);
      if (y0 < 0 || x0 < 0 || y0 >= this.nlat - 1 || x0 >= this.nlon - 1) return NaN;
      const fy = gy - y0, fx = gx - x0, n = this.nlon, v = this.v;
      const a = v[y0 * n + x0], b = v[y0 * n + x0 + 1], c = v[(y0 + 1) * n + x0], d = v[(y0 + 1) * n + x0 + 1];
      const w0 = (1 - fx) * (1 - fy), w1 = fx * (1 - fy), w2 = (1 - fx) * fy, w3 = fx * fy;
      let s = 0, ws = 0;
      if (a === a) { s += a * w0; ws += w0; }
      if (b === b) { s += b * w1; ws += w1; }
      if (c === c) { s += c * w2; ws += w2; }
      if (d === d) { s += d * w3; ws += w3; }
      return ws > 0.35 ? s / ws : NaN;
    }
    /** Bicubic (Catmull-Rom) interpolation, clamped to the local range; falls back to bilinear near gaps. */
    smooth(lat, lon) {
      const gy = (lat - this.lat0) / this.step, gx = (lon - this.lon0) / this.step;
      const y1 = Math.floor(gy), x1 = Math.floor(gx);
      if (y1 < 1 || x1 < 1 || y1 >= this.nlat - 2 || x1 >= this.nlon - 2) return this.sample(lat, lon);
      const fy = gy - y1, fx = gx - x1, n = this.nlon, v = this.v;
      const rows = [0, 0, 0, 0];
      let lo = Infinity, hi = -Infinity;
      for (let j = 0; j < 4; j++) {
        const o = (y1 - 1 + j) * n + x1 - 1;
        const p0 = v[o], p1 = v[o + 1], p2 = v[o + 2], p3 = v[o + 3];
        if (p0 !== p0 || p1 !== p1 || p2 !== p2 || p3 !== p3) return this.sample(lat, lon);
        if (j === 1 || j === 2) { lo = Math.min(lo, p1, p2); hi = Math.max(hi, p1, p2); }
        rows[j] = cr(p0, p1, p2, p3, fx);
      }
      const r = cr(rows[0], rows[1], rows[2], rows[3], fy);
      return r < lo ? lo : r > hi ? hi : r;
    }
    nearest(lat, lon) {
      const iy = Math.round((lat - this.lat0) / this.step), ix = Math.round((lon - this.lon0) / this.step);
      if (iy < 0 || ix < 0 || iy >= this.nlat || ix >= this.nlon) return NaN;
      return this.v[iy * this.nlon + ix];
    }
  }
  function cr(p0, p1, p2, p3, t) {
    return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  }
  // Categorical fields: interpolate then floor, so category edges are smooth rather than blocky.
  Grid.prototype.category = function (lat, lon) {
    const s = this.sample(lat, lon);
    return s !== s ? NaN : Math.floor(s + 0.25);
  };
  SM.Grid = Grid;

  /** Base canvas layer that repaints on every map move. */
  const CanvasLayer = L.Layer.extend({
    initialize(opts) { L.setOptions(this, opts); },
    onAdd(map) {
      this._map = map;
      this._canvas = this._makeCanvas();
      map.on('moveend zoomend resize', this._reset, this);
      this._reset();
    },
    onRemove(map) {
      map.off('moveend zoomend resize', this._reset, this);
      this._canvas.remove();
    },
    _makeCanvas() {
      const c = L.DomUtil.create('canvas', 'field-canvas leaflet-zoom-hide');
      c.style.position = 'absolute';
      c.style.opacity = this.options.opacity == null ? 1 : this.options.opacity;
      this._map.getPane(this.options.pane || 'overlayPane').appendChild(c);
      return c;
    },
    setOpacity(o) { this.options.opacity = o; if (this._canvas) this._canvas.style.opacity = o; },
    redraw() { if (this._map) this._reset(); },
    _paint(canvas) {
      const map = this._map, size = map.getSize();
      if (size.x < 2 || size.y < 2) return false;
      L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
      const dpr = this.options.hidpi ? (window.devicePixelRatio || 1) : 1;
      canvas.width = size.x * dpr; canvas.height = size.y * dpr;
      canvas.style.width = size.x + 'px'; canvas.style.height = size.y + 'px';
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.x, size.y);
      this.draw(ctx, size, map);
      return true;
    },
    _reset() { this._paint(this._canvas); },
    /** Repaint into a fresh canvas and cross-fade it in (used when the data changes). */
    _fadeIn() {
      if (!this._map) return;
      const old = this._canvas;
      const next = this._makeCanvas();
      next.style.transition = 'opacity .35s ease';
      next.style.opacity = 0;
      if (!this._paint(next)) { next.remove(); return; }
      this._canvas = next;
      requestAnimationFrame(() => { next.style.opacity = this.options.opacity == null ? 1 : this.options.opacity; });
      setTimeout(() => old.remove(), 380);
    },
    axes(size, map, cell) {
      const w = Math.ceil(size.x / cell), h = Math.ceil(size.y / cell);
      const lons = new Float64Array(w), lats = new Float64Array(h);
      for (let i = 0; i < w; i++) lons[i] = map.containerPointToLatLng([i * cell + cell / 2, 0]).lng;
      for (let j = 0; j < h; j++) lats[j] = map.containerPointToLatLng([0, j * cell + cell / 2]).lat;
      return { w, h, lons, lats };
    },
  });

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

  /** Colour-shaded model field(s); `layers` = [{grid, key}] painted bottom to top. */
  SM.FieldLayer = CanvasLayer.extend({
    options: { pane: 'fieldPane', opacity: 0.75 },
    setData(layers, fade = true) {
      this._layers = (layers || []).filter(l => l && l.grid);
      if (fade && this._canvas) this._fadeIn(); else this.redraw();
    },
    draw(ctx, size, map) {
      const layers = this._layers;
      if (!layers || !layers.length) return;
      const cell = 3;
      const { w, h, lons, lats } = this.axes(size, map, cell);
      const img = new ImageData(w, h);
      const d = img.data;
      for (const { grid, key } of layers) {
        const categorical = SM.scales[key] && SM.scales[key].categorical;
        for (let j = 0; j < h; j++) {
          const lat = lats[j];
          for (let i = 0; i < w; i++) {
            const v = categorical ? grid.category(lat, lons[i]) : grid.smooth(lat, lons[i]);
            if (v !== v) continue;
            const c = SM.colorFor(key, v);
            if (!c || c[3] <= 0) continue;
            const o = (j * w + i) * 4, a = c[3] / 255, da = d[o + 3] / 255;
            // alpha-composite (source over) so cloud cover shows beneath precipitation
            const oa = a + da * (1 - a);
            d[o] = (c[0] * a + d[o] * da * (1 - a)) / oa;
            d[o + 1] = (c[1] * a + d[o + 1] * da * (1 - a)) / oa;
            d[o + 2] = (c[2] * a + d[o + 2] * da * (1 - a)) / oa;
            d[o + 3] = oa * 255;
          }
        }
      }
      const off = document.createElement('canvas');
      off.width = w; off.height = h;
      off.getContext('2d').putImageData(img, 0, 0);
      ctx.save();
      const clip = SM.coverageClip(map);
      if (clip) ctx.clip(clip, 'evenodd');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(off, 0, 0, w * cell, h * cell);
      ctx.restore();
    },
  });

  /** Iso-lines (marching squares on a 3× refined bicubic grid) with optional H/L centres. */
  SM.ContourLayer = CanvasLayer.extend({
    options: { pane: 'isoPane', opacity: 0.95, hidpi: true },
    setData(grid, opts = {}) { this._grid = grid; this._o = opts; this.redraw(); },
    draw(ctx, size, map) {
      const g = this._grid, o = this._o || {};
      if (!g) return;
      const iv = o.interval || 4, bold = o.bold || iv * 5, fmt = o.format || (v => String(Math.round(v)));
      const R = 3, st = g.step / R;
      const ny = (g.nlat - 1) * R + 1, nx = (g.nlon - 1) * R + 1;
      const f = new Float32Array(ny * nx);
      let lo = Infinity, hi = -Infinity;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const v = g.smooth(g.lat0 + j * st, g.lon0 + i * st);
        f[j * nx + i] = v;
        if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; }
      }
      if (lo === Infinity) return;
      const pt = (j, i) => map.latLngToContainerPoint([g.lat0 + j * st, g.lon0 + i * st]);
      ctx.save();
      const clip = SM.coverageClip(map);
      if (clip) ctx.clip(clip, 'evenodd');
      ctx.lineJoin = 'round';
      ctx.font = '600 10px JetBrains Mono, monospace';
      const labels = [];
      for (let lvl = Math.ceil(lo / iv) * iv; lvl <= hi; lvl += iv) {
        const isBold = Math.abs(lvl % bold) < 1e-6;
        ctx.strokeStyle = isBold ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.5)';
        ctx.lineWidth = isBold ? 1.6 : 0.9;
        ctx.beginPath();
        let lastLabel = null;
        for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
          const a = f[j * nx + i], b = f[j * nx + i + 1], c = f[(j + 1) * nx + i + 1], d = f[(j + 1) * nx + i];
          if (a !== a || b !== b || c !== c || d !== d) continue;
          const idx = (a > lvl) | ((b > lvl) << 1) | ((c > lvl) << 2) | ((d > lvl) << 3);
          if (idx === 0 || idx === 15) continue;
          const e = [];
          const t = (v0, v1) => (lvl - v0) / (v1 - v0);
          if ((a > lvl) !== (b > lvl)) e.push([j, i + t(a, b)]);
          if ((b > lvl) !== (c > lvl)) e.push([j + t(b, c), i + 1]);
          if ((d > lvl) !== (c > lvl)) e.push([j + 1, i + t(d, c)]);
          if ((a > lvl) !== (d > lvl)) e.push([j + t(a, d), i]);
          for (let k = 0; k + 1 < e.length; k += 2) {
            const p = pt(e[k][0], e[k][1]), q = pt(e[k + 1][0], e[k + 1][1]);
            ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
            if (p.x > 40 && p.y > 40 && p.x < size.x - 40 && p.y < size.y - 60 &&
                (!lastLabel || Math.hypot(p.x - lastLabel.x, p.y - lastLabel.y) > 260)) {
              if (!labels.some(l => Math.hypot(l[0] - p.x, l[1] - p.y) < 60)) { labels.push([p.x, p.y, lvl]); lastLabel = p; }
            }
          }
        }
        ctx.stroke();
      }
      for (const [x, y, lvl] of labels) {
        const txt = fmt(lvl);
        const w = ctx.measureText(txt).width + 8;
        ctx.fillStyle = 'rgba(4,5,7,0.8)';
        roundRect(ctx, x - w / 2, y - 7, w, 14, 4); ctx.fill();
        ctx.fillStyle = '#e7eaf0';
        ctx.fillText(txt, x - w / 2 + 4, y + 3.5);
      }
      if (o.extrema) drawExtrema(ctx, f, nx, ny, pt, size, fmt, R);
      ctx.restore();
    },
  });

  /** Mark pressure centres: local minima "L" and maxima "H" of the refined field. */
  function drawExtrema(ctx, f, nx, ny, pt, size, fmt, R) {
    const rad = 3 * R, found = [];
    for (let j = 2; j < ny - 2; j += 1) for (let i = 2; i < nx - 2; i += 1) {
      const v = f[j * nx + i];
      if (v !== v) continue;
      let isMin = true, isMax = true, n = 0, tot = 0, depth = 0;
      for (let dj = -rad; dj <= rad && (isMin || isMax); dj++) for (let di = -rad; di <= rad; di++) {
        if (!dj && !di) continue;
        const jj = j + dj, ii = i + di;
        tot++;
        if (jj < 0 || ii < 0 || jj >= ny || ii >= nx) continue;
        const w = f[jj * nx + ii];
        if (w !== w) continue;
        n++;
        if (w < v) isMin = false;
        if (w > v) isMax = false;
        depth = Math.max(depth, Math.abs(w - v));
      }
      // need most of the neighbourhood present and a real closed centre (≥ 1.5 units deep)
      if (!(isMin || isMax) || n < tot * 0.6 || depth < 1.5) continue;
      // reject false centres where the field is simply cut off at the data edge
      const ok = (dj, di) => { const jj = j + dj, ii = i + di; return jj >= 0 && ii >= 0 && jj < ny && ii < nx && f[jj * nx + ii] === f[jj * nx + ii]; };
      if (!(ok(rad, 0) && ok(-rad, 0) && ok(0, rad) && ok(0, -rad))) continue;
      const p = pt(j, i);
      if (p.x < 20 || p.y < 20 || p.x > size.x - 20 || p.y > size.y - 20) continue;
      if (found.some(q => Math.hypot(q.x - p.x, q.y - p.y) < 120)) continue;
      found.push(p);
      const low = isMin;
      ctx.font = '800 26px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(4,5,7,0.75)';
      ctx.strokeText(low ? 'L' : 'H', p.x, p.y + 6);
      ctx.fillStyle = low ? '#ff5a6e' : '#5aa9ff';
      ctx.fillText(low ? 'L' : 'H', p.x, p.y + 6);
      ctx.font = '600 11px JetBrains Mono, monospace';
      ctx.strokeText(fmt(v), p.x, p.y + 22);
      ctx.fillStyle = '#e7eaf0';
      ctx.fillText(fmt(v), p.x, p.y + 22);
      ctx.textAlign = 'left';
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  SM.roundRect = roundRect;

  /** Ventusky-style values printed at cities (decluttered by zoom). */
  SM.CityValueLayer = CanvasLayer.extend({
    options: { pane: 'valuesPane', hidpi: true },
    setData(grid, key) { this._grid = grid; this._key = key; this.redraw(); },
    draw(ctx, size, map) {
      const g = this._grid, key = this._key;
      if (!g || !key || !SM.cities.length) return;
      const cat = SM.scales[key] && SM.scales[key].categorical;
      const zoom = map.getZoom();
      const showName = zoom >= 6.5 && size.x > 600;
      const boxes = [];
      ctx.textAlign = 'center';
      for (const c of SM.cityPriority || SM.cities) {
        const p = map.latLngToContainerPoint([c[2], c[3]]);
        if (p.x < 10 || p.y < 10 || p.x > size.x - 10 || p.y > size.y - 10) continue;
        const v = cat ? g.category(c[2], c[3]) : g.smooth(c[2], c[3]);
        if (v !== v) continue;
        const txt = cat ? (SM.THREAT_NAMES[Math.max(0, v)] || '') : SM.units.fmtParam(key, v);
        if (cat && v < 1) continue;
        if (key === 'precip' && v < 0.1) continue;
        const w = Math.max(30, txt.length * 7.5 + 12), h = showName ? 30 : 20;
        const box = [p.x - w / 2 - 6, p.y - h / 2 - 4, w + 12, h + 8];
        if (boxes.some(b => box[0] < b[0] + b[2] && box[0] + box[2] > b[0] && box[1] < b[1] + b[3] && box[1] + box[3] > b[1])) continue;
        boxes.push(box);
        const col = SM.colorFor(key, v);
        ctx.fillStyle = 'rgba(6,8,12,0.78)';
        roundRect(ctx, p.x - w / 2, p.y - h / 2, w, h, 6); ctx.fill();
        if (col) { ctx.fillStyle = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`; roundRect(ctx, p.x - w / 2, p.y - h / 2, 3, h, 1.5); ctx.fill(); }
        ctx.fillStyle = '#f4f6fa';
        ctx.font = '700 12px Inter, sans-serif';
        ctx.fillText(txt, p.x + 1, p.y + (showName ? -1 : 4));
        if (showName) {
          ctx.font = '500 9.5px Inter, sans-serif';
          ctx.fillStyle = '#9aa3b5';
          ctx.fillText(c[0].length > 12 ? c[0].slice(0, 11) + '…' : c[0], p.x + 1, p.y + 11);
        }
      }
      ctx.textAlign = 'left';
    },
  });

  /** Wind barbs (knots) on a zoom-dependent subset of grid points. */
  SM.BarbLayer = CanvasLayer.extend({
    options: { pane: 'isoPane', opacity: 0.9, hidpi: true },
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
