/* StormMap — vertical cross-sections and time–height sections (canvas renderer + UI) */
'use strict';

(function () {
  const X = SM.sections = { field: 'thetae', data: null, a: null, b: null, picking: 0, th: null, thField: 'rh' };

  const RH_STOPS = [[40, [0, 0, 0, 0]], [60, [70, 120, 70, 90]], [75, [60, 150, 70, 150]], [90, [40, 170, 80, 200]], [100, [20, 200, 110, 230]]];
  const SPD_STOPS = [[10, [0, 0, 0, 0]], [20, [40, 90, 170, 140]], [30, [60, 150, 200, 190]], [40, [240, 200, 60, 210]], [55, [240, 110, 50, 230]], [70, [220, 50, 120, 240]]];
  const TE_STOPS = [[300, [40, 50, 140, 200]], [315, [40, 120, 190, 200]], [325, [60, 170, 120, 200]], [335, [220, 200, 60, 210]], [345, [230, 120, 50, 220]], [360, [200, 40, 110, 230]]];
  const NORM_STOPS = [[-30, [40, 80, 200, 220]], [-15, [80, 140, 220, 170]], [-3, [0, 0, 0, 0]], [3, [0, 0, 0, 0]], [15, [230, 140, 60, 170]], [30, [220, 50, 60, 220]]];
  function ramp(stops, v) {
    if (v !== v || v == null) return null;
    if (v <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      if (v <= stops[i][0]) {
        const a = stops[i - 1], b = stops[i], f = (v - a[0]) / (b[0] - a[0]);
        return a[1].map((c, k) => c + (b[1][k] - c) * f);
      }
    }
    return stops[stops.length - 1][1];
  }

  /**
   * Generic section painter.
   * xs: x positions (km or unix time), levels: pressures (hPa, descending), val(k, key, j) → value at column k, level j,
   * psfc[k]: surface pressure per column (terrain mask). spec: {shade, shadeStops, contours: [{key, interval, color, bold, width, labels}], barbs}
   */
  SM.drawSection = function (canvas, o) {
    const dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    canvas.width = r.width * dpr; canvas.height = r.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = r.width, H = r.height, m = { l: 52, r: 14, t: 26, b: 34 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const pTop = o.pTop || 150, pBot = 1050;
    const x0 = o.xs[0], x1 = o.xs[o.xs.length - 1];
    const X = x => m.l + (x - x0) / (x1 - x0) * pw;
    const Y = p => m.t + (Math.log(p) - Math.log(pTop)) / (Math.log(pBot) - Math.log(pTop)) * ph;
    const nx = o.xs.length, levels = o.levels.filter(p => p >= pTop), nz = levels.length;
    const lj = levels.map(p => o.levels.indexOf(p));

    // refined grid (bilinear in x and ln p) for shading and contouring
    const RX = 6, RZ = 6;
    const gx = (nx - 1) * RX + 1, gz = (nz - 1) * RZ + 1;
    function refine(key) {
      const f = new Float32Array(gx * gz).fill(NaN);
      for (let i = 0; i < gx; i++) {
        const k = Math.min(nx - 2, Math.floor(i / RX)), fx = i / RX - k;
        for (let j = 0; j < gz; j++) {
          const l = Math.min(nz - 2, Math.floor(j / RZ)), fz = j / RZ - l;
          const a = o.val(k, key, lj[l]), b = o.val(k + 1, key, lj[l]), c = o.val(k, key, lj[l + 1]), d = o.val(k + 1, key, lj[l + 1]);
          if ([a, b, c, d].some(v => v == null)) continue;
          f[j * gx + i] = (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
        }
      }
      return f;
    }
    const gxPos = i => { const k = Math.min(nx - 2, Math.floor(i / RX)), fx = i / RX - k; return X(o.xs[k] + (o.xs[k + 1] - o.xs[k]) * fx); };
    const gzPos = j => { const l = Math.min(nz - 2, Math.floor(j / RZ)), fz = j / RZ - l; return Y(Math.exp(Math.log(levels[l]) + (Math.log(levels[l + 1]) - Math.log(levels[l])) * fz)); };

    ctx.save();
    ctx.beginPath(); ctx.rect(m.l, m.t, pw, ph); ctx.clip();
    // shading
    if (o.shade) {
      const f = refine(o.shade);
      for (let i = 0; i < gx - 1; i++) {
        const xa = gxPos(i), xb = gxPos(i + 1);
        for (let j = 0; j < gz - 1; j++) {
          const v = f[j * gx + i];
          const c = ramp(o.shadeStops, v);
          if (!c || !c[3]) continue;
          ctx.fillStyle = `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${c[3] / 255})`;
          const ya = gzPos(j), yb = gzPos(j + 1);
          ctx.fillRect(xa, ya, xb - xa + 0.6, yb - ya + 0.6);
        }
      }
    }
    // grid lines
    ctx.strokeStyle = '#1c1c1c'; ctx.lineWidth = 1;
    for (const p of [1000, 925, 850, 700, 500, 400, 300, 250, 200, 150, 100]) if (p >= pTop) { ctx.beginPath(); ctx.moveTo(m.l, Y(p)); ctx.lineTo(m.l + pw, Y(p)); ctx.stroke(); }
    // contours
    ctx.font = 'bold 10px Lucida Console, monospace';
    for (const c of o.contours || []) {
      const f = refine(c.key);
      let lo = Infinity, hi = -Infinity;
      for (const v of f) if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; }
      if (lo === Infinity) continue;
      const lvls = c.levels || (() => { const a = []; for (let v = Math.ceil(lo / c.interval) * c.interval; v <= hi; v += c.interval) a.push(v); return a; })();
      for (const lv of lvls) {
        const bold = c.bold != null && Math.abs(lv - c.bold) < 1e-6;
        ctx.strokeStyle = bold ? (c.boldColor || '#fff') : c.color;
        ctx.lineWidth = bold ? 2.2 : (c.width || 1);
        ctx.setLineDash(c.dash && !bold ? c.dash : []);
        ctx.beginPath();
        let label = null;
        for (let j = 0; j < gz - 1; j++) for (let i = 0; i < gx - 1; i++) {
          const a = f[j * gx + i], b = f[j * gx + i + 1], cc = f[(j + 1) * gx + i + 1], d = f[(j + 1) * gx + i];
          if (a !== a || b !== b || cc !== cc || d !== d) continue;
          const idx = (a > lv) | ((b > lv) << 1) | ((cc > lv) << 2) | ((d > lv) << 3);
          if (idx === 0 || idx === 15) continue;
          const e = [], t = (v0, v1) => (lv - v0) / (v1 - v0);
          const lerp = (pos, n, q) => { const f = Math.floor(q); return pos(f) + (pos(Math.min(n - 1, f + 1)) - pos(f)) * (q - f); };
          const px = (ii, jj) => [lerp(gxPos, gx, ii), lerp(gzPos, gz, jj)];
          if ((a > lv) !== (b > lv)) e.push(px(i + t(a, b), j));
          if ((b > lv) !== (cc > lv)) e.push(px(i + 1, j + t(b, cc)));
          if ((d > lv) !== (cc > lv)) e.push(px(i + t(d, cc), j + 1));
          if ((a > lv) !== (d > lv)) e.push(px(i, j + t(a, d)));
          for (let k = 0; k + 1 < e.length; k += 2) {
            ctx.moveTo(e[k][0], e[k][1]); ctx.lineTo(e[k + 1][0], e[k + 1][1]);
            if (!label && c.labels !== false && (i * 7 + j * 3) % 23 === 0) label = e[k];
          }
        }
        ctx.stroke();
        if (label) {
          const txt = (c.fmt || (v => String(Math.round(v))))(lv);
          const w = ctx.measureText(txt).width + 4;
          ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(0,0,0,.85)'; ctx.fillRect(label[0] - w / 2, label[1] - 6, w, 12);
          ctx.fillStyle = bold ? (c.boldColor || '#fff') : c.color; ctx.fillText(txt, label[0] - w / 2 + 2, label[1] + 4);
        }
      }
      ctx.setLineDash([]);
    }
    // wind barbs
    if (o.barbs) {
      ctx.strokeStyle = 'rgba(235,235,235,.9)'; ctx.fillStyle = 'rgba(235,235,235,.9)'; ctx.lineWidth = 1.1;
      const stepK = Math.max(1, Math.round(nx / (pw / 44)));
      for (let k = 0; k < nx; k += stepK) for (const j of lj) {
        const p = o.levels[j];
        if (p > 1000 || (o.psfc && o.psfc[k] && p > o.psfc[k])) continue;
        if (![1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150].includes(p)) continue;
        const u = o.val(k, 'u', j), v = o.val(k, 'v', j);
        if (u == null || v == null) continue;
        SM.drawBarb(ctx, X(o.xs[k]), Y(p), u, v);
      }
    }
    // terrain
    if (o.psfc) {
      ctx.fillStyle = '#3a2a1a';
      ctx.beginPath(); ctx.moveTo(X(o.xs[0]), Y(pBot));
      o.xs.forEach((x, k) => ctx.lineTo(X(x), Y(Math.min(pBot, o.psfc[k] || 1013))));
      ctx.lineTo(X(o.xs[nx - 1]), Y(pBot)); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#8a6a40'; ctx.lineWidth = 1.2; ctx.stroke();
    }
    ctx.restore();
    // axes
    ctx.strokeStyle = '#555'; ctx.strokeRect(m.l + 0.5, m.t + 0.5, pw, ph);
    ctx.fillStyle = '#9a9a9a'; ctx.font = '10px Lucida Console, monospace'; ctx.textAlign = 'right';
    for (const p of [1000, 850, 700, 500, 400, 300, 250, 200, 150, 100]) if (p >= pTop) ctx.fillText(p, m.l - 5, Y(p) + 3);
    ctx.textAlign = 'center';
    const nt = Math.min(nx, Math.max(2, Math.floor(pw / 90)));
    for (let t = 0; t < nt; t++) {
      const x = x0 + (x1 - x0) * t / (nt - 1);
      ctx.fillText(o.xlabel(x), X(x), H - 18);
    }
    ctx.textAlign = 'left'; ctx.fillStyle = '#e2e2e2'; ctx.font = 'bold 11px Tahoma, Verdana, sans-serif';
    ctx.fillText(o.title || '', m.l, 16);
    ctx.textAlign = 'right'; ctx.fillStyle = '#ffa31a'; ctx.font = '10px Lucida Console, monospace';
    ctx.fillText(o.subtitle || '', W - m.r, 16);
    ctx.textAlign = 'left';
    if (o.legend) { ctx.fillStyle = '#8a8a8a'; ctx.fillText(o.legend, m.l, H - 5); }
  };

  const FIELDS = {
    thetae: { name: 'θe (K) + RH shading', shade: 'rh', stops: RH_STOPS, contours: [{ key: 'thetae', interval: 4, color: '#ffb24a' }, { key: 't', levels: [0], bold: 0, boldColor: '#5ad1ff', color: '#5ad1ff' }], barbs: true },
    temp: { name: 'Temperature (°C) + θ (K)', shade: 'thetae', stops: TE_STOPS, contours: [{ key: 't', interval: 5, color: '#ff6b6b', bold: 0, boldColor: '#5ad1ff' }, { key: 'theta', interval: 4, color: 'rgba(255,255,255,.55)', dash: [4, 3] }], barbs: false },
    wind: { name: 'Isotachs (m/s) + barbs', shade: 'spd', stops: SPD_STOPS, contours: [{ key: 'spd', interval: 10, color: '#dddddd' }, { key: 'theta', interval: 5, color: 'rgba(255,160,60,.6)', dash: [4, 3] }], barbs: true },
    normal: { name: 'Wind normal to section (m/s)', shade: 'normal', stops: NORM_STOPS, contours: [{ key: 'normal', interval: 5, color: 'rgba(255,255,255,.7)' }, { key: 't', levels: [0], bold: 0, boldColor: '#5ad1ff', color: '#5ad1ff' }], barbs: false },
  };

  function colVal(cols) {
    return (k, key, j) => {
      const c = cols[k];
      if (!c) return null;
      if (key === 'spd') { const u = c.u[j], v = c.v[j]; return u == null || v == null ? null : Math.hypot(u, v); }
      return c[key] ? c[key][j] : null;
    };
  }

  /* ---------------- Cross-section window ---------------- */
  X.render = function () {
    const d = X.data;
    if (!d) return;
    const f = FIELDS[X.field];
    const t = d.times[d.hour];
    SM.drawSection(SM.$('#xsCanvas'), {
      xs: d.dist, levels: d.levels, val: colVal(d.cols), psfc: d.psfc,
      shade: f.shade, shadeStops: f.stops, contours: f.contours, barbs: f.barbs,
      xlabel: x => Math.round(x) + ' km',
      title: `${d.a_place.label}  →  ${d.b_place.label}  (${d.length_km} km, ${d.bearing}°)`,
      subtitle: `${SM.meta.models[d.model].name} · ${SM.utcLabel(t)}`,
      legend: f.name + (X.field === 'normal' ? ' — positive = from the right of A→B' : '') + ' · brown = terrain',
    });
  };

  X.load = async function () {
    if (!X.a || !X.b) return;
    SM.$('#xsWin').hidden = false;
    SM.loading('xs', 'Building cross-section…');
    try {
      X.data = await SM.api('xsection', { model: SM.state.model, a: X.a.join(','), b: X.b.join(','), hour: SM.state.hour, n: 25 });
      X.render();
    } catch (e) { SM.toast('Cross-section: ' + e.message, true); } finally { SM.loading('xs'); }
  };

  function drawLine() {
    X.group.clearLayers();
    const pts = [X.a, X.b].filter(Boolean);
    pts.forEach((p, i) => L.marker(p, { pane: 'routePane', icon: L.divIcon({ className: '', iconSize: [18, 18], html: `<div class="xs-pt">${i ? 'B' : 'A'}</div>` }) }).addTo(X.group));
    if (pts.length === 2) L.polyline(pts, { pane: 'routePane', color: '#ffa31a', weight: 2.5, dashArray: '8 4' }).addTo(X.group);
  }

  X.click = function (ll) {
    if (!X.picking) return false;
    if (X.picking === 1) { X.a = [ll.lat, ll.lng]; X.b = null; X.picking = 2; drawLine(); SM.toast('Cross-section: now click point B'); }
    else { X.b = [ll.lat, ll.lng]; X.picking = 0; X.btn.classList.remove('on'); SM.map.getContainer().style.cursor = ''; drawLine(); X.load(); }
    return true;
  };

  /* ---------------- Time–height (drawer tab) ---------------- */
  const TH_FIELDS = {
    rh: { name: 'RH shading · T (°C) · θe (K) · barbs', shade: 'rh', stops: RH_STOPS, contours: [{ key: 't', interval: 5, color: '#ff6b6b', bold: 0, boldColor: '#5ad1ff' }, { key: 'thetae', interval: 5, color: 'rgba(255,178,74,.7)', dash: [4, 3] }] },
    wind: { name: 'Isotachs (m/s) · θ (K) · barbs', shade: 'spd', stops: SPD_STOPS, contours: [{ key: 'spd', interval: 10, color: '#ddd' }, { key: 'theta', interval: 5, color: 'rgba(255,160,60,.6)', dash: [4, 3] }] },
  };
  X.renderTH = function () {
    const d = X.th;
    if (!d) return;
    const f = TH_FIELDS[X.thField];
    SM.drawSection(SM.$('#thCanvas'), {
      xs: d.times, levels: d.levels, val: colVal(d.cols), psfc: d.psfc, pTop: 200,
      shade: f.shade, shadeStops: f.stops, contours: f.contours, barbs: true,
      xlabel: t => SM.utcLabel(t),
      title: `Time–height · ${d.place ? d.place.label : ''}`, subtitle: SM.meta.models[d.model].name, legend: f.name,
    });
  };
  X.loadTH = async function (lat, lon) {
    SM.loading('th', 'Loading time–height section…');
    try { X.th = await SM.api('timeheight', { model: SM.state.model, lat, lon }); X.renderTH(); }
    catch (e) { SM.toast('Time–height: ' + e.message, true); } finally { SM.loading('th'); }
  };

  X.init = function () {
    X.group = L.layerGroup().addTo(SM.map);
    const Ctl = L.Control.extend({
      options: { position: 'topright' },
      onAdd() {
        const b = L.DomUtil.create('button', 'measure-btn');
        b.title = 'Vertical cross-section: click point A, then point B';
        b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 20h18M3 20V4M6 16l4-5 3 3 5-7"/></svg>';
        L.DomEvent.disableClickPropagation(b);
        b.addEventListener('click', () => {
          X.picking = X.picking ? 0 : 1;
          b.classList.toggle('on', !!X.picking);
          SM.map.getContainer().style.cursor = X.picking ? 'crosshair' : '';
          if (X.picking) SM.toast('Cross-section: click point A');
        });
        X.btn = b;
        return b;
      },
    });
    new Ctl().addTo(SM.map);
    SM.$$('#xsFields button').forEach(b => b.addEventListener('click', () => {
      X.field = b.dataset.f;
      SM.$$('#xsFields button').forEach(x => x.classList.toggle('active', x === b));
      X.render();
    }));
    SM.$$('#thFields button').forEach(b => b.addEventListener('click', () => {
      X.thField = b.dataset.f;
      SM.$$('#thFields button').forEach(x => x.classList.toggle('active', x === b));
      X.renderTH();
    }));
    SM.$('#xsClose').addEventListener('click', () => { SM.$('#xsWin').hidden = true; X.group.clearLayers(); X.data = null; });
    SM.on('hour', SM.debounce(() => { if (X.data && !SM.$('#xsWin').hidden) X.load(); }, 300));
    SM.on('model', () => { if (X.data && !SM.$('#xsWin').hidden) X.load(); });
    window.addEventListener('resize', SM.debounce(() => { X.render(); if (SM.drawer.tab === 'timeheight') X.renderTH(); }, 200));
  };
})();
