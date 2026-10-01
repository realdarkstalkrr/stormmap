/* StormMap — radar mosaic (RainViewer via same-origin proxy) with loop animation */
'use strict';

(function () {
  const R = SM.radar = {
    frames: [],
    layers: {},
    index: 0,
    playing: false,
    opacity: 0.85,
    enabled: true,
    timer: null,
    scheme: 'ventusky',
  };
  try { R.scheme = localStorage.getItem('sm-radar-scheme') || 'ventusky'; } catch (e) { /* ignore */ }

  /* ---------- Ventusky-style recolouring ----------
   * The free RainViewer feed only serves its "Universal Blue" colours. Each tile is decoded back to
   * reflectivity (dBZ) along that scheme's colour ramp, lightly smoothed and repainted with a
   * Ventusky-like scale. The storm tracker keeps reading the original tiles. */

  // Universal Blue colour ramp (approximate): [dBZ, r, g, b]
  const UB = [
    [5, 180, 240, 250], [10, 136, 221, 238], [20, 0, 153, 204], [30, 0, 85, 170], [35, 0, 50, 130],
    [38, 255, 238, 0], [44, 255, 170, 0], [49, 255, 68, 0], [54, 200, 0, 0], [57, 140, 0, 0],
    [60, 255, 120, 255], [66, 255, 255, 255],
  ];
  // Ventusky-like display scale: [dBZ, r, g, b, alpha]
  const VS = [
    [5, 110, 190, 255, 0.35], [12, 70, 150, 255, 0.6], [18, 30, 100, 235, 0.78], [24, 20, 180, 80, 0.85],
    [30, 15, 140, 35, 0.9], [35, 170, 215, 25, 0.92], [40, 255, 225, 0, 0.95], [45, 255, 150, 0, 0.97],
    [50, 240, 40, 20, 1], [55, 180, 0, 30, 1], [60, 235, 0, 200, 1], [65, 150, 70, 255, 1], [70, 245, 235, 255, 1],
  ];
  R.VENTUSKY_SCALE = VS;

  const decodeCache = new Map();
  /** Nearest point on the Universal Blue ramp (piecewise linear in RGB) → interpolated dBZ. */
  function decode(r, g, b) {
    const key = (r << 16) | (g << 8) | b;
    let v = decodeCache.get(key);
    if (v !== undefined) return v;
    let best = 1e9;
    v = 0;
    for (let i = 0; i < UB.length - 1; i++) {
      const [d0, r0, g0, b0] = UB[i], [d1, r1, g1, b1] = UB[i + 1];
      const dr = r1 - r0, dg = g1 - g0, db = b1 - b0;
      const t = Math.max(0, Math.min(1, ((r - r0) * dr + (g - g0) * dg + (b - b0) * db) / (dr * dr + dg * dg + db * db || 1)));
      const e = (r - r0 - t * dr) ** 2 + (g - g0 - t * dg) ** 2 + (b - b0 - t * db) ** 2;
      if (e < best) { best = e; v = d0 + t * (d1 - d0); }
    }
    if (decodeCache.size < 100000) decodeCache.set(key, v);
    return v;
  }

  // dBZ (0.25 steps from 0 to 80) → RGBA lookup table
  const LUT = new Uint8ClampedArray(321 * 4);
  for (let k = 0; k <= 320; k++) {
    const d = k / 4;
    if (d < VS[0][0]) continue;
    let i = 0;
    while (i < VS.length - 2 && d > VS[i + 1][0]) i++;
    const a = VS[i], b = VS[i + 1], t = Math.max(0, Math.min(1, (d - a[0]) / (b[0] - a[0])));
    for (let c = 0; c < 4; c++) LUT[k * 4 + c] = c < 3 ? a[c + 1] + t * (b[c + 1] - a[c + 1]) : 255 * (a[4] + t * (b[4] - a[4]));
  }
  R.colorFor = d => { const k = Math.max(0, Math.min(320, Math.round(d * 4))) * 4; return [LUT[k], LUT[k + 1], LUT[k + 2], LUT[k + 3]]; };

  function recolour(img, ctx, n) {
    ctx.drawImage(img, 0, 0, n, n);
    const im = ctx.getImageData(0, 0, n, n), px = im.data;
    const dbz = new Float32Array(n * n);
    for (let i = 0, o = 0; i < n * n; i++, o += 4) if (px[o + 3] > 20) dbz[i] = decode(px[o], px[o + 1], px[o + 2]);
    // light 3×3 smoothing inside echoes so colour steps blend; edges keep their outline
    const sm = new Float32Array(n * n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        if (!dbz[i]) continue;
        let s = dbz[i] * 4, w = 4;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= n) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if ((dx || dy) && xx >= 0 && xx < n && dbz[yy * n + xx]) { s += dbz[yy * n + xx]; w++; }
          }
        }
        sm[i] = s / w;
      }
    }
    for (let i = 0, o = 0; i < n * n; i++, o += 4) {
      if (!sm[i]) { px[o + 3] = 0; continue; }
      const k = Math.max(0, Math.min(320, Math.round(sm[i] * 4))) * 4;
      px[o] = LUT[k]; px[o + 1] = LUT[k + 1]; px[o + 2] = LUT[k + 2]; px[o + 3] = LUT[k + 3];
    }
    ctx.putImageData(im, 0, 0);
  }

  const VentuskyRadar = L.GridLayer.extend({
    initialize(url, opts) { this._url = url; L.GridLayer.prototype.initialize.call(this, opts); },
    createTile(coords, done) {
      const n = this.getTileSize().x;
      const tile = L.DomUtil.create('canvas', 'leaflet-tile');
      tile.width = tile.height = n;
      const img = new Image();
      img.onload = () => {
        try { recolour(img, tile.getContext('2d', { willReadFrequently: true }), n); done(null, tile); } catch (e) { done(e, tile); }
      };
      img.onerror = () => done(new Error('radar tile'), tile);
      img.src = L.Util.template(this._url, { x: coords.x, y: coords.y, z: coords.z });
      return tile;
    },
  });

  R.tileUrl = function (frame, size = 256) {
    return `/api/radar/tile/{z}/{x}/{y}.png?path=${encodeURIComponent(frame.path)}&size=${size}&color=2`;
  };

  function layerFor(frame) {
    if (!R.layers[frame.path]) {
      const opts = {
        pane: 'radarPane', opacity: 0, maxNativeZoom: 7, maxZoom: 14, tileSize: 256,
        attribution: 'Radar © <a href="https://www.rainviewer.com" target="_blank" rel="noopener">RainViewer</a>',
        keepBuffer: 1, updateWhenIdle: true,
      };
      R.layers[frame.path] = R.scheme === 'ventusky' ? new VentuskyRadar(R.tileUrl(frame), opts) : L.tileLayer(R.tileUrl(frame), opts);
    }
    return R.layers[frame.path];
  }

  R.show = function (i) {
    if (!R.frames.length) return;
    R.index = Math.max(0, Math.min(i, R.frames.length - 1));
    const cur = R.frames[R.index];
    for (const f of R.frames) {
      const lyr = R.layers[f.path];
      if (!lyr) continue;
      if (f === cur) continue;
      if (R.playing) lyr.setOpacity(0); else if (SM.map.hasLayer(lyr)) SM.map.removeLayer(lyr);
    }
    if (R.enabled) {
      const lyr = layerFor(cur);
      if (!SM.map.hasLayer(lyr)) lyr.addTo(SM.map);
      lyr.setOpacity(R.opacity);
    }
    SM.$('#radarSlider').value = R.index;
    const age = Math.round((Date.now() / 1000 - cur.time) / 60);
    SM.$('#radarTime').textContent = `${SM.utcHM(cur.time)}Z · ${age} min ago`;
  };

  R.setEnabled = function (on) {
    R.enabled = on;
    if (!on) {
      R.stop();
      for (const l of Object.values(R.layers)) if (SM.map.hasLayer(l)) SM.map.removeLayer(l);
    } else R.show(R.index);
    SM.$('#radarBar').style.display = on ? '' : 'none';
  };

  R.setOpacity = function (o) { R.opacity = o; R.show(R.index); };

  R.setScheme = function (scheme) {
    R.scheme = scheme;
    try { localStorage.setItem('sm-radar-scheme', scheme); } catch (e) { /* ignore */ }
    const playing = R.playing;
    if (playing) R.stop();
    for (const l of Object.values(R.layers)) if (SM.map.hasLayer(l)) SM.map.removeLayer(l);
    R.layers = {};
    R.show(R.index);
    if (playing) R.play();
    drawScale();
  };

  function drawScale() {
    const box = SM.$('#radarScale');
    if (!box) return;
    box.hidden = R.scheme !== 'ventusky';
    if (box.hidden) return;
    const stops = [];
    for (let d = 5; d <= 70; d += 2.5) { const c = R.colorFor(d); stops.push(`rgb(${c[0]},${c[1]},${c[2]}) ${((d - 5) / 65 * 100).toFixed(1)}%`); }
    box.innerHTML = `<i style="background:linear-gradient(90deg,${stops.join(',')})"></i><span>${[10, 20, 30, 40, 50, 60].map(d => `<b style="left:${((d - 5) / 65 * 100).toFixed(1)}%">${d}</b>`).join('')}</span><em>dBZ</em>`;
  }

  R.play = function () {
    if (R.playing || !R.frames.length) return;
    R.playing = true;
    SM.$('#radarPlay').textContent = '❚❚';
    // preload every frame at zero opacity so the loop is smooth
    for (const f of R.frames) { const l = layerFor(f); if (!SM.map.hasLayer(l)) l.addTo(SM.map); l.setOpacity(0); }
    let hold = 0;
    R.timer = setInterval(() => {
      if (R.index === R.frames.length - 1 && hold++ < 2) return; // dwell on the latest frame
      hold = 0;
      R.show((R.index + 1) % R.frames.length);
    }, 550);
  };

  R.stop = function () {
    R.playing = false;
    clearInterval(R.timer);
    SM.$('#radarPlay').textContent = '▶';
    R.show(R.index);
  };

  R.toggle = () => (R.playing ? R.stop() : R.play());

  R.refresh = async function () {
    SM.status('stRadar', 'busy');
    try {
      const data = await SM.api('radar/frames');
      const frames = data.radar || [];
      if (!frames.length) throw new Error('no frames');
      const latestChanged = !R.frames.length || frames[frames.length - 1].path !== R.frames[R.frames.length - 1].path;
      // drop layers of frames that aged out
      const keep = new Set(frames.map(f => f.path));
      for (const [p, l] of Object.entries(R.layers)) if (!keep.has(p)) { if (SM.map.hasLayer(l)) SM.map.removeLayer(l); delete R.layers[p]; }
      R.frames = frames;
      R.demo = data.demo;
      const sl = SM.$('#radarSlider');
      sl.max = frames.length - 1;
      if (!R.playing) R.show(frames.length - 1);
      SM.status('stRadar', 'ok', `Radar: ${frames.length} frames, latest ${SM.utcHM(frames[frames.length - 1].time)}Z`);
      if (latestChanged) SM.emit('radar-frames', frames);
    } catch (e) {
      SM.status('stRadar', 'err', 'Radar unavailable: ' + e.message);
    }
  };

  R.init = function () {
    const sel = SM.$('#radarScheme');
    if (sel) { sel.value = R.scheme; sel.addEventListener('change', e => R.setScheme(e.target.value)); }
    drawScale();
    SM.$('#radarPlay').addEventListener('click', R.toggle);
    SM.$('#radarSlider').addEventListener('input', e => { if (R.playing) R.stop(); R.show(+e.target.value); });
    R.refresh();
    setInterval(R.refresh, 120000);
  };
})();
