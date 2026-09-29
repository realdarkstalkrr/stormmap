/* StormMap — animated wind-flow particles (Ventusky-style streak animation) */
'use strict';

(function () {
  const SPEED_BINS = [3, 6, 10, 15, 22, Infinity];
  const BIN_ALPHA = [0.28, 0.4, 0.52, 0.64, 0.74, 0.85];

  SM.ParticleLayer = L.Layer.extend({
    options: { pane: 'particlePane', density: 1 },

    onAdd(map) {
      this._map = map;
      this._c = L.DomUtil.create('canvas', 'field-canvas leaflet-zoom-hide');
      this._c.style.position = 'absolute';
      map.getPane(this.options.pane).appendChild(this._c);
      map.on('movestart zoomstart', this._pause, this);
      map.on('moveend zoomend resize', this._restart, this);
      this._visHandler = () => (document.hidden ? this._stop() : this._restart());
      document.addEventListener('visibilitychange', this._visHandler);
      this._restart();
    },

    onRemove(map) {
      this._stop();
      map.off('movestart zoomstart', this._pause, this);
      map.off('moveend zoomend resize', this._restart, this);
      document.removeEventListener('visibilitychange', this._visHandler);
      this._c.remove();
    },

    /** u, v: SM.Grid objects in m/s; level: '10' | '850' | '500' | '250'. */
    setField(u, v, level) {
      this._u = u; this._v = v;
      this._k = level === '10' ? 0.09 : level === '850' ? 0.06 : 0.035;
      if (this._map) this._restart();
    },

    _pause() { this._stop(); if (this._ctx) this._ctx.clearRect(0, 0, this._w, this._h); },

    _stop() { if (this._raf) cancelAnimationFrame(this._raf); this._raf = null; },

    _restart() {
      this._stop();
      const map = this._map;
      if (!map || !this._u || document.hidden) { if (this._ctx) this._ctx.clearRect(0, 0, this._w || 0, this._h || 0); return; }
      const size = map.getSize();
      if (size.x < 2 || size.y < 2) return;
      const dpr = window.devicePixelRatio || 1;
      this._w = size.x; this._h = size.y;
      L.DomUtil.setPosition(this._c, map.containerPointToLayerPoint([0, 0]));
      this._c.width = size.x * dpr; this._c.height = size.y * dpr;
      this._c.style.width = size.x + 'px'; this._c.style.height = size.y + 'px';
      const ctx = this._ctx = this._c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // screen → geo lookup tables (Web Mercator: lon linear in x, lat per row)
      const w0 = map.containerPointToLatLng([0, 0]).lng, w1 = map.containerPointToLatLng([size.x, 0]).lng;
      this._lon0 = w0; this._dlon = (w1 - w0) / size.x;
      this._lat = new Float64Array(size.y + 1);
      for (let y = 0; y <= size.y; y++) this._lat[y] = map.containerPointToLatLng([0, y]).lat;
      // mercator stretch: pixels per degree lat vs lon differ by 1/cos(lat) — handled by the map
      const n = Math.round(Math.min(2600, (size.x * size.y) / 700) * this.options.density);
      this._clip = SM.coverageClip(map);
      this._p = new Float32Array(n * 3); // x, y, age
      this._maxAge = new Uint8Array(n);
      for (let i = 0; i < n; i++) this._spawn(i, true);
      let last = 0;
      const frame = ts => {
        this._raf = requestAnimationFrame(frame);
        if (ts - last < 28) return; // ~35 fps is plenty and saves battery
        last = ts;
        this._step();
      };
      this._raf = requestAnimationFrame(frame);
    },

    _vel(x, y) {
      const yi = y | 0;
      if (yi < 0 || yi >= this._h) return null;
      const lat = this._lat[yi], lon = this._lon0 + x * this._dlon;
      const u = this._u.sample(lat, lon), v = this._v.sample(lat, lon);
      if (u !== u || v !== v) return null;
      return [u, v];
    },

    _spawn(i, initial) {
      const p = this._p;
      for (let t = 0; t < 6; t++) {
        const x = Math.random() * this._w, y = Math.random() * this._h;
        if (this._vel(x, y) || t === 5) {
          p[i * 3] = x; p[i * 3 + 1] = y;
          p[i * 3 + 2] = initial ? Math.random() * 80 : 0;
          this._maxAge[i] = 50 + Math.random() * 70;
          return;
        }
      }
    },

    _step() {
      const ctx = this._ctx, p = this._p, n = this._maxAge.length, k = this._k;
      if (!this._clip && SM.countriesGeo) this._clip = SM.coverageClip(this._map);
      // fade existing trails
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = 'rgba(0,0,0,0.9)';
      ctx.fillRect(0, 0, this._w, this._h);
      ctx.globalCompositeOperation = 'source-over';
      const paths = SPEED_BINS.map(() => new Path2D());
      for (let i = 0; i < n; i++) {
        const o = i * 3;
        const x = p[o], y = p[o + 1];
        const vel = this._vel(x, y);
        if (!vel || p[o + 2] > this._maxAge[i]) { this._spawn(i, false); continue; }
        const spd = Math.hypot(vel[0], vel[1]);
        const nx = x + vel[0] * k * 2.2, ny = y - vel[1] * k * 2.2;
        let b = 0;
        while (spd > SPEED_BINS[b]) b++;
        paths[b].moveTo(x, y); paths[b].lineTo(nx, ny);
        p[o] = nx; p[o + 1] = ny; p[o + 2] += 1;
        if (nx < 0 || ny < 0 || nx > this._w || ny > this._h) this._spawn(i, false);
      }
      ctx.save();
      if (this._clip) ctx.clip(this._clip, 'evenodd');
      ctx.lineWidth = 1;
      ctx.lineCap = 'round';
      for (let b = 0; b < paths.length; b++) {
        ctx.strokeStyle = `rgba(255,255,255,${BIN_ALPHA[b]})`;
        ctx.stroke(paths[b]);
      }
      ctx.restore();
    },
  });
})();
