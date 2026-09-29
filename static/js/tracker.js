/* StormMap — radar storm-cell identification, tracking and nowcasting.
 *
 * 1. Builds a reflectivity mosaic for the coverage area from radar tiles (z5) of the last N frames.
 * 2. Converts pixel colours to approximate dBZ.
 * 3. Labels connected cells above a threshold, computes centroid / area / max dBZ / hull.
 * 4. Links cells frame-to-frame (motion-predicted nearest neighbour), estimates motion by
 *    least squares and extrapolates 15–60 min with an uncertainty cone.
 * 5. Enriches cells with lightning rates, model environment, nearest town and threat flags.
 */
'use strict';

(function () {
  const Z = 5, TS = 256;
  const T = SM.tracker = {
    threshold: 40,
    nFrames: 6,
    cells: [],
    tracks: [],
    selected: null,
    busy: false,
    lastScan: 0,
    group: null,
  };

  /* ---------- colour → dBZ (robust to RainViewer "Universal Blue" & "Original" schemes) ---------- */
  function rgbToDbz(r, g, b, a) {
    if (a < 40) return 0;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), v = mx / 255, s = mx ? (mx - mn) / mx : 0;
    if (s < 0.18) return v > 0.85 ? 66 : 12;              // white = extreme, grey = light/noise
    let h;
    const d = mx - mn;
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    if (h >= 270 && h < 345) return 60;                    // magenta / purple
    if (h >= 345 || h < 12) return v > 0.85 ? 52 : 56;     // red / dark red
    if (h < 30) return 49;                                 // red-orange
    if (h < 45) return 45;                                 // orange
    if (h < 75) return 40;                                 // yellow
    if (h < 170) return 30;                                // greens (Original scheme)
    return Math.round(12 + (1 - v) * 40);                  // blues: darker = stronger (≤ ~35 dBZ)
  }
  T.rgbToDbz = rgbToDbz;

  function tileRange() {
    const b = SM.meta.region_bounds;
    return {
      x0: Math.floor(SM.geo.lon2tile(b[2] - 1, Z)), x1: Math.floor(SM.geo.lon2tile(b[3] + 1, Z)),
      y0: Math.floor(SM.geo.lat2tile(b[1] + 1, Z)), y1: Math.floor(SM.geo.lat2tile(b[0] - 1, Z)),
    };
  }

  function loadImg(url) {
    return new Promise(res => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = url;
    });
  }

  /** Build a dBZ raster (Uint8Array) for one radar frame. */
  async function mosaic(frame) {
    const tr = tileRange();
    const nx = tr.x1 - tr.x0 + 1, ny = tr.y1 - tr.y0 + 1;
    const W = nx * TS, H = ny * TS;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const base = SM.radar.tileUrl(frame, TS).replace('{z}', Z);
    const jobs = [];
    for (let ty = tr.y0; ty <= tr.y1; ty++) for (let tx = tr.x0; tx <= tr.x1; tx++) {
      const url = base.replace('{x}', tx).replace('{y}', ty);
      jobs.push(loadImg(url).then(img => { if (img) ctx.drawImage(img, (tx - tr.x0) * TS, (ty - tr.y0) * TS); }));
    }
    await Promise.all(jobs);
    const px = ctx.getImageData(0, 0, W, H).data;
    const dbz = new Uint8Array(W * H);
    for (let i = 0, o = 0; i < dbz.length; i++, o += 4) {
      if (px[o + 3]) dbz[i] = rgbToDbz(px[o], px[o + 1], px[o + 2], px[o + 3]);
    }
    return { dbz, W, H, x0: tr.x0 * TS, y0: tr.y0 * TS, time: frame.time };
  }

  function pixToLatLon(m, x, y) {
    const n = TS * 2 ** Z;
    const gx = (m.x0 + x) / n, gy = (m.y0 + y) / n;
    const lon = gx * 360 - 180;
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * gy))) * 180 / Math.PI;
    return [lat, lon];
  }

  function convexHull(pts) {
    if (pts.length < 4) return pts;
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }

  /** Connected-component labelling of pixels ≥ threshold. */
  function detect(m, thr) {
    const { dbz, W, H } = m;
    const seen = new Uint8Array(W * H);
    const cells = [];
    const stack = new Int32Array(W * H);
    const kmPerPxEq = 40075 / (TS * 2 ** Z);
    for (let start = 0; start < W * H; start++) {
      if (seen[start] || dbz[start] < thr) continue;
      let sp = 0;
      stack[sp++] = start;
      seen[start] = 1;
      let n = 0, sx = 0, sy = 0, sw = 0, mx = 0, core = 0, core55 = 0, mxX = 0, mxY = 0;
      const edge = [];
      while (sp) {
        const p = stack[--sp];
        const x = p % W, y = (p / W) | 0, v = dbz[p];
        const w = v - thr + 5;
        n++; sx += x * w; sy += y * w; sw += w;
        if (v > mx) { mx = v; mxX = x; mxY = y; }
        if (v >= 50) core++;
        if (v >= 55) core55++;
        let isEdge = false;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) { isEdge = true; continue; }
          const q = yy * W + xx;
          if (dbz[q] < thr) { isEdge = true; continue; }
          if (!seen[q]) { seen[q] = 1; stack[sp++] = q; }
        }
        if (isEdge && (edge.length < 4000)) edge.push([x, y]);
      }
      const cy = sy / sw, cx = sx / sw;
      const [lat, lon] = pixToLatLon(m, cx, cy);
      const kmPx = kmPerPxEq * Math.cos(lat * Math.PI / 180);
      const area = n * kmPx * kmPx;
      if (area < 40) continue; // ignore specks
      const hull = convexHull(edge.map(p => [p[0] + 0.5, p[1] + 0.5])).map(p => pixToLatLon(m, p[0], p[1]));
      cells.push({
        lat, lon, area, maxDbz: mx, coreArea: core * kmPx * kmPx, core55Area: core55 * kmPx * kmPx,
        hull, peak: pixToLatLon(m, mxX, mxY), time: m.time,
      });
    }
    return cells;
  }

  /** Link cells across frames into tracks. */
  function link(framesCells) {
    const tracks = [];
    let nextId = 1;
    for (let f = 0; f < framesCells.length; f++) {
      const cells = framesCells[f];
      const t = cells.time;
      const active = tracks.filter(tr => tr.last === f - 1);
      const pairs = [];
      for (const tr of active) {
        const last = tr.pts[tr.pts.length - 1];
        const dt = t - last.time;
        const pred = tr.v ? SM.geo.offset(last.lat, last.lon, tr.v[0] * dt / 1000, tr.v[1] * dt / 1000) : [last.lat, last.lon];
        for (let k = 0; k < cells.list.length; k++) {
          const c = cells.list[k];
          const d = SM.geo.dist(pred[0], pred[1], c.lat, c.lon);
          const lim = 20 + 0.5 * Math.sqrt(Math.max(c.area, last.area)) + (tr.v ? 0 : 12);
          if (d < lim) pairs.push([d - Math.min(c.area, last.area) / 2000, tr, k]);
        }
      }
      pairs.sort((a, b) => a[0] - b[0]);
      const usedT = new Set(), usedC = new Set();
      for (const [, tr, k] of pairs) {
        if (usedT.has(tr) || usedC.has(k)) continue;
        usedT.add(tr); usedC.add(k);
        tr.pts.push(cells.list[k]);
        tr.last = f;
        fitMotion(tr);
      }
      for (let k = 0; k < cells.list.length; k++) {
        if (usedC.has(k)) continue;
        tracks.push({ id: nextId++, pts: [cells.list[k]], last: f, v: null });
      }
    }
    return tracks;
  }

  /** Least-squares motion (east/north m/s) over the last ≤5 positions. */
  function fitMotion(tr) {
    const pts = tr.pts.slice(-5);
    if (pts.length < 2) { tr.v = null; return; }
    const ref = pts[0];
    const t0 = ref.time;
    let st = 0, stt = 0, se = 0, sn = 0, ste = 0, stn = 0;
    for (const p of pts) {
      const t = p.time - t0;
      const [e, n] = SM.geo.enu([ref.lat, ref.lon], [p.lat, p.lon]);
      st += t; stt += t * t; se += e; sn += n; ste += t * e; stn += t * n;
    }
    const N = pts.length, den = N * stt - st * st;
    if (den <= 0) { tr.v = null; return; }
    const ve = (N * ste - st * se) / den * 1000, vn = (N * stn - st * sn) / den * 1000; // m/s
    const spd = Math.hypot(ve, vn);
    tr.v = spd > 45 ? null : [ve, vn];
    // residual → track quality
    let res = 0;
    for (const p of pts) {
      const t = p.time - t0;
      const [e, n] = SM.geo.enu([ref.lat, ref.lon], [p.lat, p.lon]);
      const pe = (se / N) + (ve / 1000) * (t - st / N), pn = (sn / N) + (vn / 1000) * (t - st / N);
      res += Math.hypot(e - pe, n - pn);
    }
    tr.err = res / N;
  }

  function envAt(lat, lon) {
    const g = SM.state.nowFields;
    if (!g) return null;
    const out = {};
    for (const k of ['cape', 'shr6', 'srh1', 'srh3', 'scp', 'stp', 'ship', 'lcl']) {
      const grid = g[k];
      out[k] = grid ? grid.sample(lat, lon) : NaN;
    }
    return out;
  }

  function enrich(tr) {
    const c = tr.pts[tr.pts.length - 1];
    const prev = tr.pts.length > 2 ? tr.pts[tr.pts.length - 3] : tr.pts[0];
    const place = SM.nearestCity(c.lat, c.lon);
    const spd = tr.v ? Math.hypot(tr.v[0], tr.v[1]) : null;
    const dir = tr.v ? (Math.atan2(tr.v[0], tr.v[1]) * 180 / Math.PI + 360) % 360 : null;
    const r = Math.sqrt(c.area / Math.PI) + 8;
    const lt10 = SM.lightning.countNear(c.lat, c.lon, r, 10 * 60000);
    const lt10prev = SM.lightning.countNear(c.lat, c.lon, r, 10 * 60000, 10 * 60000);
    const env = envAt(c.lat, c.lon);
    const age = (c.time - tr.pts[0].time) / 60;
    const flags = [];
    if (c.maxDbz >= 60 || c.core55Area > 30) flags.push(['LARGE HAIL', 'hail']);
    else if (c.maxDbz >= 55) flags.push(['HAIL', 'hail']);
    if (c.maxDbz >= 55 && env && env.scp >= 2 && age >= 20) flags.push(['SUPERCELL?', 'sc']);
    if (env && env.stp >= 1 && c.maxDbz >= 50) flags.push(['TOR ENV', 'sev']);
    if (spd && spd > 22) flags.push(['FAST', 'sev']);
    if (c.area > 4000) flags.push(['MCS/CLUSTER', '']);
    if (c.maxDbz > prev.maxDbz + 3 || c.area > prev.area * 1.3) flags.push(['GROWING', 'grow']);
    if (lt10 > 30 && lt10 > lt10prev * 2 && lt10prev > 3) flags.push(['LTG JUMP', 'sev']);
    let score = (c.maxDbz - 35) * 2 + Math.log10(1 + c.area) * 6 + Math.min(lt10, 200) / 10;
    if (env) score += (env.scp || 0) * 2 + (env.stp || 0) * 5 + (env.ship || 0) * 3;
    const sev = c.maxDbz >= 60 || score > 80 ? 3 : c.maxDbz >= 55 || score > 60 ? 2 : c.maxDbz >= 50 ? 1 : 0;
    Object.assign(tr, {
      cur: c, place, spd, dir, lt10, lt10prev, env, age, flags, score, sev,
      trend: { dbz: c.maxDbz - prev.maxDbz, area: prev.area ? (c.area / prev.area - 1) * 100 : 0 },
    });
    tr.rank = SM.rankCell ? SM.rankCell(tr) : null;
    return tr;
  }

  T.forecast = function (tr, minutes) {
    if (!tr.v) return null;
    return SM.geo.offset(tr.cur.lat, tr.cur.lon, tr.v[0] * minutes * 0.06, tr.v[1] * minutes * 0.06);
  };

  const SEV_COLORS = ['#22d3ee', '#fbbf24', '#fb923c', '#f43f5e'];
  T.color = tr => SEV_COLORS[tr.sev];

  function draw() {
    T.group.clearLayers();
    if (!SM.$('#lyrCells').checked) return;
    for (const tr of T.tracks) {
      const c = tr.cur, col = T.color(tr), sel = T.selected === tr.id;
      if (c.hull.length > 2) {
        L.polygon(c.hull, { pane: 'cellPane', color: col, weight: sel ? 2.5 : 1.5, fillColor: col, fillOpacity: sel ? 0.18 : 0.07, dashArray: tr.pts.length < 2 ? '4 4' : null })
          .on('click', () => T.select(tr.id, true)).addTo(T.group);
      }
      // past track
      if (tr.pts.length > 1) {
        L.polyline(tr.pts.map(p => [p.lat, p.lon]), { pane: 'cellPane', color: '#e7eaf0', weight: 1.5, opacity: 0.7 }).addTo(T.group);
        for (const p of tr.pts.slice(0, -1)) L.circleMarker([p.lat, p.lon], { pane: 'cellPane', radius: 2, color: '#e7eaf0', weight: 1, fillOpacity: 1 }).addTo(T.group);
      }
      // forecast track + cone
      if (tr.v) {
        const pts = [[c.lat, c.lon]];
        const left = [], right = [];
        const spd = Math.hypot(tr.v[0], tr.v[1]);
        const ux = tr.v[0] / spd, uy = tr.v[1] / spd;
        for (const m of [15, 30, 45, 60]) {
          const f = T.forecast(tr, m);
          pts.push(f);
          const w = 3 + m * 0.25 + (tr.err || 0) * 0.5; // km half-width
          left.push(SM.geo.offset(f[0], f[1], -uy * w, ux * w));
          right.push(SM.geo.offset(f[0], f[1], uy * w, -ux * w));
          L.circleMarker(f, { pane: 'cellPane', radius: 3, color: col, weight: 1.5, fillColor: '#040507', fillOpacity: 1 })
            .bindTooltip(`+${m} min · ${SM.utcHM(tr.cur.time + m * 60)}Z`, { direction: 'top' }).addTo(T.group);
        }
        L.polygon([[c.lat, c.lon], ...left, ...right.reverse()], { pane: 'cellPane', stroke: false, fillColor: col, fillOpacity: 0.12, interactive: false }).addTo(T.group);
        L.polyline(pts, { pane: 'cellPane', color: col, weight: 2, dashArray: '6 5' }).addTo(T.group);
      }
      const arrow = tr.dir == null ? '' : ' ' + '↑↗→↘↓↙←↖'[Math.round(tr.dir / 45) % 8];
      L.marker([c.lat, c.lon], { pane: 'cellPane', icon: L.divIcon({ className: '', html: '', iconSize: [0, 0] }), interactive: false })
        .bindTooltip(`C${tr.id} ${c.maxDbz}dBZ${arrow}${tr.spd ? ' ' + Math.round(tr.spd * 3.6) : ''}`, { permanent: true, direction: 'right', offset: [8, 0], className: 'cell-label' })
        .addTo(T.group);
    }
  }

  function renderList() {
    const box = SM.$('#cellList');
    const n = T.tracks.length;
    const badge = SM.$('#cellBadge');
    const sig = T.tracks.filter(t => t.sev >= 2).length;
    badge.hidden = !n; badge.textContent = sig || n;
    const age = T.frameTime ? Math.round((Date.now() / 1000 - T.frameTime) / 60) : null;
    SM.$('#trkSummary').innerHTML = n
      ? `<b>${n}</b> cells ≥ ${T.threshold} dBZ · <b>${sig}</b> significant · radar ${SM.utcHM(T.frameTime)}Z (${age} min ago)`
      : `No cells ≥ ${T.threshold} dBZ in the coverage area${T.frameTime ? ' · radar ' + SM.utcHM(T.frameTime) + 'Z' : ''}.`;
    box.innerHTML = '';
    for (const tr of T.tracks.slice(0, 60)) {
      const c = tr.cur, e = tr.env || {};
      const mv = tr.v ? `${SM.geo.compass(tr.dir)} ${Math.round(tr.spd * 3.6)}` : '—';
      const me = SM.chase && SM.chase.threatTo(tr);
      const rk = tr.rank ? `<span class="flag" style="background:${tr.rank.color}33;color:${tr.rank.color}">${tr.rank.verdict} ${tr.rank.score}</span>` : '';
      const flags = rk + tr.flags.map(f => `<span class="flag ${f[1]}">${f[0]}</span>`).join('') + (me ? `<span class="flag me">${SM.esc(me)}</span>` : '');
      const trend = tr.trend.dbz > 2 ? '▲' : tr.trend.dbz < -2 ? '▼' : '';
      const el = SM.el('div', { class: 'cell' + (T.selected === tr.id ? ' sel' : ''), style: `--c:${T.color(tr)}` }, `
        <div class="cell-top"><span class="cell-id">C${tr.id} <small style="color:var(--dim)">${Math.round(tr.age)} min</small></span><span class="cell-dbz">${c.maxDbz} dBZ ${trend}</span></div>
        <div class="cell-place">${SM.esc(tr.place.label)}</div>
        <div class="cell-stats">
          <div><small>Motion</small><span>${mv}</span></div>
          <div><small>Area</small><span>${Math.round(c.area)}</span></div>
          <div><small>Ltg/10m</small><span>${tr.lt10}</span></div>
          <div><small>SCP|STP</small><span>${e.scp >= 0 ? e.scp.toFixed(1) : '—'}|${e.stp >= 0 ? e.stp.toFixed(1) : '—'}</span></div>
        </div>
        ${flags ? `<div class="cell-flags">${flags}</div>` : ''}`);
      el.addEventListener('click', () => T.select(tr.id, true));
      box.appendChild(el);
    }
  }

  T.select = function (id, fly) {
    T.selected = id;
    const tr = T.tracks.find(t => t.id === id);
    if (tr && fly) SM.map.flyTo([tr.cur.lat, tr.cur.lon], Math.max(SM.map.getZoom(), 8), { duration: 0.8 });
    draw(); renderList();
    SM.emit('cell-selected', tr);
  };

  T.scan = async function () {
    if (T.busy || !SM.radar.frames.length) return;
    T.busy = true;
    SM.status('stTracker', 'busy', 'Scanning radar frames…');
    try {
      const frames = SM.radar.frames.slice(-T.nFrames);
      const framesCells = [];
      for (const fr of frames) {
        const m = await mosaic(fr);
        const list = detect(m, T.threshold);
        framesCells.push({ time: fr.time, list });
      }
      const all = link(framesCells);
      const lastF = framesCells.length - 1;
      T.frameTime = frames[frames.length - 1].time;
      const prevSel = T.selected;
      T.tracks = all.filter(t => t.last === lastF).map(enrich).sort((a, b) => b.score - a.score);
      if (!T.tracks.some(t => t.id === prevSel)) T.selected = null;
      T.lastScan = Date.now();
      draw(); renderList();
      SM.status('stTracker', 'ok', `Tracker: ${T.tracks.length} cells at ${SM.utcHM(T.frameTime)}Z`);
      SM.emit('cells', T.tracks);
    } catch (e) {
      console.error(e);
      SM.status('stTracker', 'err', 'Tracker error: ' + e.message);
    } finally {
      T.busy = false;
    }
  };

  T.refreshEnrich = function () {
    if (!T.tracks.length) return;
    T.tracks.forEach(enrich);
    T.tracks.sort((a, b) => b.score - a.score);
    draw(); renderList();
    SM.emit('cells', T.tracks);
  };

  T.init = function () {
    T.group = L.layerGroup().addTo(SM.map);
    SM.$('#trkThreshold').addEventListener('change', e => { T.threshold = +e.target.value; SM.$('#thrLabel').textContent = T.threshold; T.scan(); });
    SM.$('#trkFrames').addEventListener('change', e => { T.nFrames = +e.target.value; T.scan(); });
    SM.$('#trkRun').addEventListener('click', () => T.scan());
    SM.$('#lyrCells').addEventListener('change', draw);
    SM.on('radar-frames', () => T.scan());
    SM.on('now-fields', () => T.refreshEnrich());
    setInterval(() => { if (SM.lightning.strikes.length) T.refreshEnrich(); }, 30000);
  };
})();
