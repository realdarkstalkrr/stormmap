/* StormMap — storm potential ranking ("is this cell worth chasing?") */
'use strict';

(function () {
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const VERDICTS = [
    [65, 'HIGH POTENTIAL', '#e879f9'],
    [45, 'GOOD POTENTIAL', '#f43f5e'],
    [25, 'MARGINAL', '#fbbf24'],
    [0, 'NO POTENTIAL', '#64748b'],
  ];

  function envAt(lat, lon) {
    const g = SM.state.nowFields;
    if (!g) return null;
    const v = k => (g[k] ? g[k].sample(lat, lon) : NaN);
    return { cape: v('cape'), scp: v('scp'), stp: v('stp'), ship: v('ship'), shr6: v('shr6'), srh1: v('srh1') };
  }
  const nz = x => (x === x && x != null ? x : 0);

  /** Score a tracked cell (see tracker.js) — returns {score, verdict, color, parts, reasons, chase}. */
  SM.rankCell = function (tr) {
    const c = tr.cur;
    const reasons = [];
    // --- intensity (0–25)
    let inten = clamp((c.maxDbz - 40) / 25, 0, 1) * 20 + clamp(c.core55Area / 20, 0, 5);
    if (c.maxDbz >= 60) reasons.push(['+', `Very intense core (${c.maxDbz} dBZ) — large hail likely`]);
    else if (c.maxDbz >= 55) reasons.push(['+', `Strong core (${c.maxDbz} dBZ)`]);
    else if (c.maxDbz < 45) reasons.push(['-', `Weak echo (${c.maxDbz} dBZ)`]);
    // --- trend (−15…+15)
    const dz = tr.trend ? tr.trend.dbz : 0, da = tr.trend ? tr.trend.area : 0;
    const trend = clamp(dz * 1.5 + da / 10, -15, 15);
    if (trend >= 5) reasons.push(['+', `Intensifying (${dz >= 0 ? '+' : ''}${dz} dBZ, area ${da >= 0 ? '+' : ''}${Math.round(da)}%)`]);
    if (trend <= -5) reasons.push(['-', `Weakening (${dz} dBZ, area ${Math.round(da)}%)`]);
    // --- lightning (0–15)
    let ltg = clamp(Math.log2(1 + tr.lt10) * 2, 0, 12);
    const jump = tr.lt10 > 30 && tr.lt10 > tr.lt10prev * 2 && tr.lt10prev > 3;
    if (jump) { ltg += 3; reasons.push(['+', `Lightning jump (${tr.lt10prev} → ${tr.lt10} / 10 min)`]); }
    else if (tr.lt10 >= 40) reasons.push(['+', `Very active lightning (${tr.lt10} / 10 min)`]);
    // --- environment now and along the forecast path (0–30)
    const pts = [[c.lat, c.lon]];
    for (const m of [30, 60]) { const f = SM.tracker.forecast(tr, m); if (f) pts.push(f); }
    const envs = pts.map(p => envAt(p[0], p[1])).filter(Boolean);
    let env = 0, envNow = envs[0], envBest = null;
    for (const e of envs) {
      const s = clamp(nz(e.scp) * 2, 0, 12) + clamp(nz(e.stp) * 5, 0, 10) + clamp(nz(e.ship) * 2.5, 0, 5) + clamp(nz(e.cape) / 1000, 0, 3);
      if (s > env) { env = s; envBest = e; }
    }
    if (envBest) {
      if (nz(envBest.stp) >= 1) reasons.push(['+', `Tornadic environment ahead (STP ${nz(envBest.stp).toFixed(1)})`]);
      if (nz(envBest.scp) >= 4) reasons.push(['+', `Supercell environment (SCP ${nz(envBest.scp).toFixed(1)}, shear ${Math.round(nz(envBest.shr6))} m/s)`]);
      else if (nz(envBest.scp) < 1) reasons.push(['-', 'Poor supercell environment (SCP < 1)']);
      if (envNow && envs.length > 1 && nz(envs[envs.length - 1].scp) > nz(envNow.scp) + 1) reasons.push(['+', 'Moving into more favourable air']);
      if (envNow && envs.length > 1 && nz(envs[envs.length - 1].scp) < nz(envNow.scp) - 1.5) reasons.push(['-', 'Moving into less favourable air']);
    } else reasons.push(['?', 'Model environment not loaded yet']);
    // --- organisation / persistence (0–15)
    let org = 0;
    if (tr.age >= 60) org += 8; else if (tr.age >= 30) org += 5; else if (tr.age >= 10) org += 2;
    if (tr.spd != null && tr.spd >= 4 && tr.spd <= 22) org += 4;
    if (c.area >= 80 && c.area <= 3000) org += 3;
    if (tr.age >= 45) reasons.push(['+', `Long-lived (${Math.round(tr.age)} min tracked)`]);
    if (c.area > 4000) reasons.push(['-', 'Large cluster/MCS — hard to target a single storm']);

    let score = clamp(inten + trend + ltg + env + org, 0, 100);
    const dying = dz <= -6 && da < -20;
    if (dying) { score = Math.min(score, 20); reasons.unshift(['-', 'Collapsing']); }

    // --- chaseability: no-go zones and speed
    const chase = { ok: true, notes: [] };
    if (SM.zones && SM.zones.cls) {
      const now = SM.zones.at(c.lat, c.lon);
      if (now >= 1) { chase.ok = false; chase.notes.push(`In no-go area now (${SM.zones.label(now)})`); }
      for (const m of [15, 30, 45, 60, 90]) {
        const f = SM.tracker.forecast(tr, m);
        if (!f) break;
        const z = SM.zones.at(f[0], f[1]);
        if (z >= 1 && now === 0) { chase.notes.push(`Enters no-go area (${SM.zones.label(z)}) in ~${m} min`); if (m <= 30) chase.ok = false; break; }
      }
    }
    if (tr.spd && tr.spd > 25) chase.notes.push(`Very fast (${Math.round(tr.spd * 3.6)} km/h) — hard to keep up`);
    if (SM.chase && SM.chase.pos) {
      const d = SM.geo.dist(SM.chase.pos[0], SM.chase.pos[1], c.lat, c.lon);
      chase.dist = d;
    }

    const v = VERDICTS.find(x => score >= x[0]);
    return {
      score: Math.round(score), verdict: dying ? 'DYING' : v[1], color: dying ? '#64748b' : v[2], reasons, chase,
      parts: { Intensity: [inten, 25], Trend: [trend, 15], Lightning: [Math.min(ltg, 15), 15], Environment: [env, 30], Organisation: [org, 15] },
    };
  };

  /* ---------------- Panel ---------------- */
  const R = SM.ranking = { filter: 'all' };

  R.render = function () {
    const box = SM.$('#rankList');
    if (!box) return;
    const tracks = SM.tracker.tracks.filter(t => t.rank);
    const ranked = tracks.slice().sort((a, b) => b.rank.score - a.rank.score)
      .filter(t => R.filter === 'all' || (R.filter === 'chase' && t.rank.chase.ok && t.rank.score >= 25));
    const counts = {};
    for (const t of tracks) counts[t.rank.verdict] = (counts[t.rank.verdict] || 0) + 1;
    SM.$('#rankSummary').innerHTML = tracks.length
      ? ['HIGH POTENTIAL', 'GOOD POTENTIAL', 'MARGINAL', 'NO POTENTIAL', 'DYING'].filter(k => counts[k]).map(k => `<span class="rk-count" style="--c:${(VERDICTS.find(v => v[1] === k) || [0, 0, '#64748b'])[2]}">${counts[k]} ${k.toLowerCase()}</span>`).join('')
      : '<span class="hint">No tracked cells yet — ranking fills in when the radar tracker finds storms.</span>';
    box.innerHTML = '';
    ranked.forEach((tr, i) => {
      const r = tr.rank, c = tr.cur;
      const parts = Object.entries(r.parts).map(([k, [v, max]]) => {
        const pct = Math.round(clamp(v, 0, max) / max * 100), neg = v < 0;
        return `<div class="rk-part"><span>${k}</span><div class="rk-bar"><i style="width:${neg ? Math.round(-v / max * 100) : pct}%;background:${neg ? '#64748b' : r.color}"></i></div></div>`;
      }).join('');
      const reasons = r.reasons.slice(0, 5).map(([s, t]) => `<li class="${s === '+' ? 'pos' : s === '-' ? 'neg' : ''}">${s === '+' ? '✔' : s === '-' ? '✖' : '•'} ${SM.esc(t)}</li>`).join('');
      const chase = (r.chase.ok ? '' : '<li class="nogo">⛔ Not chaseable</li>') + r.chase.notes.map(n => `<li class="nogo">⚠ ${SM.esc(n)}</li>`).join('');
      const el = SM.el('div', { class: 'rk-card' + (SM.tracker.selected === tr.id ? ' sel' : ''), style: `--c:${r.color}` }, `
        <div class="rk-top">
          <span class="rk-rank">#${i + 1}</span>
          <span class="rk-id">C${tr.id}</span>
          <span class="rk-verdict">${r.verdict}</span>
          <span class="rk-score">${r.score}</span>
        </div>
        <div class="rk-place">${SM.esc(tr.place.label)} · ${c.maxDbz} dBZ · ${tr.v ? SM.geo.compass(tr.dir) + ' ' + SM.units.fmt('wind', tr.spd, true) : 'motion unknown'}${r.chase.dist != null ? ` · ${Math.round(r.chase.dist)} km from you` : ''}</div>
        <div class="rk-meter"><i style="width:${r.score}%"></i></div>
        <div class="rk-parts">${parts}</div>
        <ul class="rk-reasons">${reasons}${chase}</ul>
        <div class="rk-actions">
          <button class="btn" data-act="locate">Locate</button>
          <button class="btn primary" data-act="intercept" ${r.chase.ok && tr.v ? '' : 'disabled title="Not chaseable or motion unknown"'}>Plan intercept</button>
        </div>`);
      el.querySelector('[data-act=locate]').addEventListener('click', () => SM.tracker.select(tr.id, true));
      el.querySelector('[data-act=intercept]').addEventListener('click', () => SM.chase.planIntercept(tr));
      box.appendChild(el);
    });
  };

  R.init = function () {
    SM.$$('#rankFilter button').forEach(b => b.addEventListener('click', () => {
      R.filter = b.dataset.f;
      SM.$$('#rankFilter button').forEach(x => x.classList.toggle('active', x === b));
      R.render();
    }));
    SM.on('cells', R.render);
    SM.on('cell-selected', R.render);
    SM.on('zones', () => SM.tracker.refreshEnrich());
  };
})();
