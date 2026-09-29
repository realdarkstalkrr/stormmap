/* StormMap — Skew-T/log-P diagram and hodograph (canvas) */
'use strict';

(function () {
  const K = 273.15, RD = 287.04, CP = 1005.7, LV = 2.501e6, EPS = 0.622;
  const es = t => 6.112 * Math.exp(17.67 * t / (t + 243.5));
  const ws = (t, p) => { const e = Math.min(es(t), p * 0.5); return EPS * e / (p - e); };
  function moistLapse(tk, p) {
    const rs = ws(tk - K, p);
    return ((RD * tk + LV * rs) / p) / (CP + (LV * LV * rs * EPS) / (RD * tk * tk));
  }
  function moistStep(tc, p0, p1) {
    let t = tc + K; const h = p1 - p0;
    const k1 = moistLapse(t, p0), k2 = moistLapse(t + 0.5 * h * k1, p0 + 0.5 * h);
    const k3 = moistLapse(t + 0.5 * h * k2, p0 + 0.5 * h), k4 = moistLapse(t + h * k3, p1);
    return t + h * (k1 + 2 * k2 + 2 * k3 + k4) / 6 - K;
  }

  function setup(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(10, r.width * dpr); canvas.height = Math.max(10, r.height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, W: r.width, H: r.height };
  }

  SM.drawSkewT = function (canvas, d, parcelKey = 'ml', compare = null) {
    const { ctx, W, H } = setup(canvas);
    ctx.fillStyle = '#05070a'; ctx.fillRect(0, 0, W, H);
    const m = { l: 44, r: 70, t: 14, b: 26 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const PB = 1050, PT = 100, lnB = Math.log(PB), lnT = Math.log(PT);
    const TL = -40, TR = 45, skew = 0.95 * pw / ph;
    const y = p => m.t + (Math.log(p) - lnT) / (lnB - lnT) * ph;
    const x = (t, p) => m.l + (t - TL) / (TR - TL) * pw + (m.t + ph - y(p)) * skew;

    ctx.save();
    ctx.beginPath(); ctx.rect(m.l, m.t, pw, ph); ctx.clip();
    const line = (pts, color, w = 1, dash = null) => {
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.setLineDash(dash || []);
      ctx.beginPath();
      let started = false;
      for (const [t, p] of pts) {
        if (t == null || p == null) { started = false; continue; }
        const X = x(t, p), Y = y(p);
        if (!started) { ctx.moveTo(X, Y); started = true; } else ctx.lineTo(X, Y);
      }
      ctx.stroke(); ctx.setLineDash([]);
    };
    // isobars
    ctx.font = '10px JetBrains Mono, monospace';
    for (const p of [1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100]) {
      ctx.strokeStyle = p % 100 === 0 || p === 850 || p === 925 ? '#1c2230' : '#141925'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(m.l, y(p)); ctx.lineTo(m.l + pw, y(p)); ctx.stroke();
    }
    // isotherms
    for (let t = -120; t <= 50; t += 10) line([[t, PB], [t, PT]], t === 0 ? '#2e5b7a' : '#172030', t === 0 ? 1.4 : 1);
    // dry adiabats
    for (let th = 250; th <= 470; th += 10) {
      const pts = [];
      for (let p = PB; p >= PT; p -= 25) pts.push([th * Math.pow(p / 1000, 0.2857) - K, p]);
      line(pts, 'rgba(180,120,60,0.22)');
    }
    // moist adiabats
    for (let t0 = -16; t0 <= 36; t0 += 4) {
      const pts = [[t0, 1000]];
      let t = t0;
      for (let p = 1000; p > 200; p -= 20) { t = moistStep(t, p, p - 20); pts.push([t, p - 20]); }
      line(pts, 'rgba(60,160,120,0.22)', 1, [4, 3]);
    }
    // mixing ratio lines
    for (const w of [1, 2, 4, 7, 10, 16, 24]) {
      const pts = [];
      for (let p = PB; p >= 600; p -= 50) { const e = w * p / (622 + w); const l = Math.log(e / 6.112); pts.push([243.5 * l / (17.67 - l), p]); }
      line(pts, 'rgba(120,120,200,0.3)', 1, [2, 4]);
    }

    const P = d.plot;
    // CAPE / CIN shading for the selected parcel
    const pc = P.parcels[parcelKey];
    if (pc && pc.t) {
      const lfc = pc.lfc, el = pc.el;
      for (let k = 0; k + 1 < pc.t.length; k++) {
        const i = pc.i0 + k;
        const p0 = P.p[i], p1 = P.p[i + 1];
        if (p1 == null) break;
        const tp0 = pc.t[k], tp1 = pc.t[k + 1], te0 = P.t[i], te1 = P.t[i + 1];
        if (tp0 == null || tp1 == null || te0 == null || te1 == null) continue;
        let col = null;
        if (lfc && el && p0 <= lfc + 0.1 && p1 >= el - 0.1 && tp0 > te0 && tp1 > te1) col = 'rgba(244,63,94,0.28)';
        else if (lfc && p0 > lfc && tp0 < te0) col = 'rgba(56,189,248,0.18)';
        if (!col) continue;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(x(te0, p0), y(p0)); ctx.lineTo(x(tp0, p0), y(p0)); ctx.lineTo(x(tp1, p1), y(p1)); ctx.lineTo(x(te1, p1), y(p1));
        ctx.closePath(); ctx.fill();
      }
      line(pc.t.map((t, k) => [t, P.p[pc.i0 + k]]), '#f8fafc', 1.6, [6, 4]);
    }
    // comparison model (thin dashed)
    if (compare && compare.plot) {
      const C = compare.plot;
      line(C.td.map((t, i) => [t, C.p[i]]), 'rgba(110,231,183,.8)', 1.4, [5, 4]);
      line(C.t.map((t, i) => [t, C.p[i]]), 'rgba(251,146,160,.85)', 1.4, [5, 4]);
    }
    // downdraft parcel and wet-bulb profile
    if (P.downdraft && P.downdraft.length > 1) line(P.downdraft.map(([p, t]) => [t, p]), '#c084fc', 1.5, [3, 3]);
    if (P.wetbulb) line(P.wetbulb.map((t, i) => [t, P.p[i]]), '#38bdf8', 1.1);
    // environment
    line(P.td.map((t, i) => [t, P.p[i]]), '#34d399', 2.6);
    line(P.t.map((t, i) => [t, P.p[i]]), '#f43f5e', 2.6);
    ctx.restore();

    // axes labels
    ctx.fillStyle = '#8b93a7'; ctx.font = '10px JetBrains Mono, monospace';
    ctx.textAlign = 'right';
    for (const p of [1000, 850, 700, 500, 300, 200, 100]) ctx.fillText(p, m.l - 6, y(p) + 3);
    ctx.textAlign = 'center';
    for (let t = -40; t <= 40; t += 10) { const X = x(t, PB); if (X > m.l && X < m.l + pw) ctx.fillText(t + '°', X, H - 8); }
    // height AGL ticks
    ctx.textAlign = 'left'; ctx.fillStyle = '#5b6377';
    for (const km of [1, 3, 6, 9, 12]) {
      const p = pAtZ(P, km * 1000);
      if (!p) continue;
      ctx.fillText(km + 'km', m.l + 3, y(p) - 2);
      ctx.strokeStyle = '#3a4256'; ctx.beginPath(); ctx.moveTo(m.l, y(p)); ctx.lineTo(m.l + 8, y(p)); ctx.stroke();
    }
    // parcel levels
    if (pc) {
      const marks = [['LCL', pc.lcl, '#34d399'], ['LFC', pc.lfc, '#fbbf24'], ['EL', pc.el, '#a78bfa']];
      ctx.font = '600 10px JetBrains Mono, monospace';
      for (const [lab, p, col] of marks) {
        if (!p) continue;
        const Y = y(p);
        ctx.strokeStyle = col; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(m.l + pw - 46, Y); ctx.lineTo(m.l + pw - 30, Y); ctx.stroke();
        ctx.fillStyle = col; ctx.fillText(lab, m.l + pw - 27, Y + 3);
      }
    }
    // effective inflow layer
    if (P.eff_layer) {
      const [pb, pt] = P.eff_layer;
      ctx.strokeStyle = '#e879f9'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(m.l + 18, y(pb)); ctx.lineTo(m.l + 12, y(pb)); ctx.lineTo(m.l + 12, y(pt)); ctx.lineTo(m.l + 18, y(pt)); ctx.stroke();
      ctx.fillStyle = '#e879f9'; ctx.fillText(`${Math.round(d.indices.esrh)} m²/s²`, m.l + 22, (y(pb) + y(pt)) / 2 + 3);
    }
    // wind barbs column
    ctx.save();
    ctx.strokeStyle = 'rgba(235,240,248,0.9)'; ctx.fillStyle = 'rgba(235,240,248,0.9)'; ctx.lineWidth = 1.2;
    let lastY = -99;
    for (let i = 0; i < P.p.length; i++) {
      const Y = y(P.p[i]);
      if (Y - lastY < 18 && i) continue;
      if (Y < m.t + 6 || P.u[i] == null) continue;
      if (lastY > -99 && Math.abs(Y - lastY) < 18) continue;
      SM.drawBarb(ctx, W - m.r / 2 + 8, Y, P.u[i], P.v[i]);
      lastY = Y;
    }
    ctx.restore();
    ctx.strokeStyle = '#252b3a'; ctx.lineWidth = 1; ctx.strokeRect(m.l, m.t, pw, ph);
    // legend
    ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'left';
    const lg = [['T', '#f43f5e'], ['Td', '#34d399'], ['Tw', '#38bdf8'], [parcelKey.toUpperCase() + ' parcel', '#f8fafc'], ['Downdraft', '#c084fc']];
    if (compare) lg.push([SM.meta.models[compare.model] ? SM.meta.models[compare.model].name.split(' ').slice(0, 2).join(' ') : 'compare', 'rgba(251,146,160,.85)']);
    let lx = m.l + 8;
    for (const [lab, col] of lg) { ctx.fillStyle = col; ctx.fillRect(lx, m.t + 8, 10, 3); ctx.fillStyle = '#8b93a7'; ctx.fillText(lab, lx + 14, m.t + 12); lx += ctx.measureText(lab).width + 30; }
  };

  function pAtZ(P, z) {
    for (let i = 1; i < P.z.length; i++) {
      if (P.z[i - 1] <= z && P.z[i] >= z) {
        const f = (z - P.z[i - 1]) / (P.z[i] - P.z[i - 1]);
        return Math.exp(Math.log(P.p[i - 1]) + f * (Math.log(P.p[i]) - Math.log(P.p[i - 1])));
      }
    }
    return null;
  }

  SM.drawHodograph = function (canvas, d) {
    const { ctx, W, H } = setup(canvas);
    ctx.fillStyle = '#05070a'; ctx.fillRect(0, 0, W, H);
    const hodo = d.plot.hodograph;
    const mot = d.indices.motions || {};
    let maxS = 20;
    for (const [, u, v] of hodo) maxS = Math.max(maxS, Math.hypot(u, v));
    for (const k of ['bunkers_rm', 'bunkers_lm']) if (mot[k]) maxS = Math.max(maxS, mot[k].spd);
    const ringMax = Math.ceil(maxS / 10) * 10;
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 18, s = R / ringMax;
    const X = u => cx + u * s, Y = v => cy - v * s;
    ctx.strokeStyle = '#1a1f2b'; ctx.lineWidth = 1;
    ctx.font = '10px JetBrains Mono, monospace'; ctx.fillStyle = '#5b6377';
    for (let r = 10; r <= ringMax; r += 10) {
      ctx.beginPath(); ctx.arc(cx, cy, r * s, 0, 2 * Math.PI); ctx.stroke();
      ctx.fillText(r + ' m/s', cx + r * s * 0.7071 + 2, cy - r * s * 0.7071 - 2);
    }
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
    const col = h => h <= 1000 ? '#f43f5e' : h <= 3000 ? '#34d399' : h <= 6000 ? '#fbbf24' : '#22d3ee';
    ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    for (let i = 1; i < hodo.length; i++) {
      ctx.strokeStyle = col(hodo[i][0]);
      ctx.beginPath(); ctx.moveTo(X(hodo[i - 1][1]), Y(hodo[i - 1][2])); ctx.lineTo(X(hodo[i][1]), Y(hodo[i][2])); ctx.stroke();
    }
    ctx.fillStyle = '#e7eaf0';
    for (const [h, u, v] of hodo) {
      if (h % 1000 === 0 && h > 0 && h <= 9000) { ctx.beginPath(); ctx.arc(X(u), Y(v), 2.5, 0, 6.283); ctx.fill(); ctx.fillText(h / 1000, X(u) + 4, Y(v) - 4); }
    }
    const mark = (m, lab, c, shape) => {
      if (!m) return;
      ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = 1.8;
      ctx.beginPath();
      if (shape === 'sq') ctx.rect(X(m.u) - 4, Y(m.v) - 4, 8, 8); else ctx.arc(X(m.u), Y(m.v), 5, 0, 6.283);
      ctx.stroke();
      ctx.font = '600 10px JetBrains Mono, monospace';
      ctx.fillText(lab, X(m.u) + 7, Y(m.v) + 4);
    };
    mark(mot.bunkers_rm, 'RM', '#f43f5e');
    mark(mot.bunkers_lm, 'LM', '#60a5fa');
    mark(mot.mean_0_6, 'MW', '#e7eaf0', 'sq');
    mark(mot.corfidi_down, 'DS', '#34d399', 'sq');
    mark(mot.corfidi_up, 'US', '#a78bfa', 'sq');
    // storm-relative inflow from RM to surface wind
    if (mot.bunkers_rm && hodo.length) {
      ctx.strokeStyle = 'rgba(244,63,94,0.5)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X(mot.bunkers_rm.u), Y(mot.bunkers_rm.v)); ctx.lineTo(X(hodo[0][1]), Y(hodo[0][2])); ctx.stroke(); ctx.setLineDash([]);
    }
    // legend
    ctx.font = '10px JetBrains Mono, monospace';
    [['0–1', '#f43f5e'], ['1–3', '#34d399'], ['3–6', '#fbbf24'], ['6–10 km', '#22d3ee']].forEach(([l, c], i) => {
      ctx.fillStyle = c; ctx.fillRect(10, 10 + i * 14, 10, 3); ctx.fillStyle = '#8b93a7'; ctx.fillText(l, 24, 14 + i * 14);
    });
    if (mot.bunkers_rm) {
      ctx.fillStyle = '#8b93a7'; ctx.textAlign = 'right';
      ctx.fillText(`RM ${mot.bunkers_rm.dir}°/${Math.round(mot.bunkers_rm.spd * 1.944)} kt`, W - 10, H - 24);
      if (mot.bunkers_lm) ctx.fillText(`LM ${mot.bunkers_lm.dir}°/${Math.round(mot.bunkers_lm.spd * 1.944)} kt`, W - 10, H - 10);
      ctx.textAlign = 'left';
    }
  };

  /** Storm-relative wind speed vs height (Bunkers right mover). */
  SM.drawSRWind = function (canvas, d) {
    const { ctx, W, H } = setup(canvas);
    ctx.fillStyle = '#05070a'; ctx.fillRect(0, 0, W, H);
    const prof = d.plot.srwind || [];
    if (!prof.length) return;
    const m = { l: 34, r: 10, t: 18, b: 20 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
    const maxS = Math.max(40, ...prof.map(x => x[1]));
    const X = s => m.l + s / maxS * pw, Y = h => m.t + ph - h / 12000 * ph;
    // Rasmussen–Straka anvil-level bands (9–11 km)
    ctx.fillStyle = 'rgba(56,189,248,.08)'; ctx.fillRect(X(0), Y(11000), X(18) - X(0), Y(9000) - Y(11000));
    ctx.fillStyle = 'rgba(52,211,153,.08)'; ctx.fillRect(X(18), Y(11000), X(28) - X(18), Y(9000) - Y(11000));
    ctx.fillStyle = 'rgba(251,191,36,.08)'; ctx.fillRect(X(28), Y(11000), X(maxS) - X(28), Y(9000) - Y(11000));
    ctx.strokeStyle = '#1c2230'; ctx.lineWidth = 1;
    ctx.font = '9.5px Lucida Console, monospace'; ctx.fillStyle = '#6b7280';
    for (let h = 0; h <= 12000; h += 3000) { ctx.beginPath(); ctx.moveTo(m.l, Y(h)); ctx.lineTo(m.l + pw, Y(h)); ctx.stroke(); ctx.fillText(h / 1000 + 'km', 2, Y(h) + 3); }
    for (let s = 0; s <= maxS; s += 10) { ctx.beginPath(); ctx.moveTo(X(s), m.t); ctx.lineTo(X(s), m.t + ph); ctx.stroke(); ctx.fillText(s, X(s) - 5, H - 6); }
    ctx.strokeStyle = '#f43f5e'; ctx.lineWidth = 2; ctx.beginPath();
    prof.forEach(([h, s], i) => { if (i) ctx.lineTo(X(s), Y(h)); else ctx.moveTo(X(s), Y(h)); });
    ctx.stroke();
    ctx.fillStyle = '#e2e2e2'; ctx.font = 'bold 10px Tahoma, Verdana, sans-serif';
    ctx.fillText('Storm-relative wind (m/s) · HP / Classic / LP bands at 9–11 km', m.l, 12);
  };
})();
