/* StormMap — storm-based warnings: draft from a tracked cell, human review, publish (map + Telegram) */
'use strict';

(function () {
  const W = SM.warn = { draft: null, active: [], status: null, layer: null, preview: null };
  const UK_DIR = { N: 'північ', NNE: 'північ-північний схід', NE: 'північний схід', ENE: 'схід-північний схід', E: 'схід', ESE: 'схід-південний схід', SE: 'південний схід', SSE: 'південь-південний схід', S: 'південь', SSW: 'південь-південний захід', SW: 'південний захід', WSW: 'захід-південний захід', W: 'захід', WNW: 'захід-північний захід', NW: 'північний захід', NNW: 'північ-північний захід' };
  const SEV_COL = { moderate: '#fbbf24', severe: '#fb923c', extreme: '#e879f9' };
  let ukNames = {};

  const kyivHM = ts => new Date(ts * 1000).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' });
  const ukName = n => ukNames[n] || n;

  /** Threat polygon: 0–60 min cone around the forecast track, widening with lead time. */
  function cone(tr, minutes) {
    const c = tr.cur, r = Math.sqrt(c.area / Math.PI) + 10;
    if (!tr.v) {
      const pts = [];
      for (let k = 0; k < 20; k++) { const a = k / 20 * 2 * Math.PI; pts.push(SM.geo.offset(c.lat, c.lon, Math.cos(a) * (r + 15), Math.sin(a) * (r + 15))); }
      return pts;
    }
    const spd = Math.hypot(tr.v[0], tr.v[1]), ux = tr.v[0] / spd, uy = tr.v[1] / spd;
    const left = [], right = [];
    for (let t = 0; t <= minutes; t += 10) {
      const f = t ? SM.tracker.forecast(tr, t) : [c.lat, c.lon];
      const w = r + t * 0.25;
      left.push(SM.geo.offset(f[0], f[1], -uy * w, ux * w));
      right.push(SM.geo.offset(f[0], f[1], uy * w, -ux * w));
    }
    const back = SM.geo.offset(c.lat, c.lon, -ux * r, -uy * r);
    const front = SM.tracker.forecast(tr, minutes);
    const tip = SM.geo.offset(front[0], front[1], ux * (r + minutes * 0.25), uy * (r + minutes * 0.25));
    return [back, ...left, tip, ...right.reverse()];
  }

  function inPoly(lat, lon, poly) {
    return SM.inGeometry(lat, lon, { type: 'Polygon', coordinates: [poly.map(p => [p[1], p[0]])] });
  }

  /** Towns inside the polygon with the time the storm core passes closest. */
  function townsInPath(tr, poly, minutes) {
    const out = [];
    const now = tr.cur.time;
    for (const [name, cc, lat, lon] of SM.cities) {
      if (!inPoly(lat, lon, poly)) continue;
      let bestT = 0, bestD = 1e9;
      for (let t = 0; t <= minutes; t += 2) {
        const f = t ? SM.tracker.forecast(tr, t) : [tr.cur.lat, tr.cur.lon];
        if (!f) break;
        const d = SM.geo.dist(lat, lon, f[0], f[1]);
        if (d < bestD) { bestD = d; bestT = t; }
      }
      out.push({ name, uk: ukName(name), cc, eta: now + bestT * 60, dist: bestD });
    }
    return out.sort((a, b) => a.eta - b.eta);
  }

  function hazards(tr) {
    const c = tr.cur, e = tr.env || {}, h = [];
    const hail = c.maxDbz >= 60 || (e.ship || 0) >= 1.5 ? 'big' : c.maxDbz >= 55 || (e.ship || 0) >= 0.8 ? 'mid' : c.maxDbz >= 50 ? 'small' : null;
    if (hail === 'big') h.push(['hail', 'град до 4–5 см', 'hail up to 4–5 cm']);
    else if (hail === 'mid') h.push(['hail', 'град 2–3 см', 'hail 2–3 cm']);
    else if (hail === 'small') h.push(['hail', 'дрібний град', 'small hail']);
    const strongWind = (tr.spd || 0) > 17 || (e.shr6 || 0) >= 20 || c.area > 3000;
    h.push(strongWind ? ['wind', 'шквали 70–90 км/год', 'gusts 70–90 km/h'] : ['wind', 'шквали 50–70 км/год', 'gusts 50–70 km/h']);
    if ((e.stp || 0) >= 1 && c.maxDbz >= 50) h.push(['tornado', 'можливий смерч', 'a tornado is possible']);
    h.push(['rain', 'злива', 'torrential rain']);
    h.push(['ltg', 'часті блискавки', 'frequent lightning']);
    const severity = hail === 'big' || h.some(x => x[0] === 'tornado') ? 'extreme' : c.maxDbz >= 55 || strongWind ? 'severe' : 'moderate';
    return { list: h, severity };
  }

  function texts(d) {
    const until = kyivHM(d.expires);
    const dirKey = d.dir != null ? SM.geo.compass(d.dir) : null;
    const towns = d.towns.slice(0, 12);
    const tUk = towns.map(t => `${t.uk} ~${kyivHM(t.eta)}`).join(', ');
    const tEn = towns.map(t => `${t.name} ~${kyivHM(t.eta)}`).join(', ');
    const sevUk = { moderate: 'ГРОЗА', severe: 'НЕБЕЗПЕЧНА ГРОЗА', extreme: 'ДУЖЕ НЕБЕЗПЕЧНА ГРОЗА' }[d.severity];
    const sevEn = { moderate: 'THUNDERSTORM', severe: 'SEVERE THUNDERSTORM', extreme: 'DANGEROUS SEVERE THUNDERSTORM' }[d.severity];
    const hz = d.hazards.filter(h => d.enabled[h[0]]);
    const uk = [
      `⚠️ ${sevUk} — попередження StormMap (неофіційне)`,
      `Діє до ${until} (за Київським часом)`,
      '',
      dirKey ? `Грозова комірка рухається на ${UK_DIR[dirKey]} зі швидкістю ~${Math.round(d.spd * 3.6)} км/год.` : 'Грозова комірка майже нерухома.',
      `Небезпеки: ${hz.map(h => h[1]).join(', ')}.`,
      towns.length ? `На шляху: ${tUk}.` : '',
      '',
      'Що робити: перебувайте в приміщенні, подалі від вікон; не залишайте авто під деревами; уникайте відкритої місцевості та водойм.',
      'Під час повітряної тривоги пріоритет — укриття.',
      '',
      'Офіційні попередження: Укргідрометцентр, ДСНС.',
    ].filter((l, i, a) => l || a[i - 1]).join('\n');
    const en = [
      `⚠️ ${sevEn} — StormMap warning (unofficial)`,
      `Valid until ${until} Kyiv time`,
      '',
      dirKey ? `The storm is moving ${dirKey} at ~${Math.round(d.spd * 3.6)} km/h.` : 'The storm is nearly stationary.',
      `Hazards: ${hz.map(h => h[2]).join(', ')}.`,
      towns.length ? `In the path: ${tEn}.` : '',
      '',
      'Stay indoors away from windows; do not park under trees; avoid open ground and water.',
      'During an air-raid alert, shelter takes priority.',
      '',
      'Official warnings: Ukrhydrometcenter, State Emergency Service.',
    ].filter((l, i, a) => l || a[i - 1]).join('\n');
    return { uk, en, title_uk: `${sevUk}: ${towns.slice(0, 3).map(t => t.uk).join(', ') || 'район'}`, title_en: `${sevEn}: ${towns.slice(0, 3).map(t => t.name).join(', ') || 'area'}` };
  }

  /* ---------- composer UI ---------- */
  W.compose = function (tr) {
    const minutes = +(SM.$('#wnDur') ? SM.$('#wnDur').value : 60) || 60;
    const poly = cone(tr, minutes);
    const hz = hazards(tr);
    const d = {
      cell: `C${tr.id}`, tr, poly, minutes, spd: tr.spd || 0, dir: tr.dir,
      expires: Math.round(Date.now() / 1000 + minutes * 60), severity: hz.severity, hazards: hz.list,
      enabled: Object.fromEntries(hz.list.map(h => [h[0], true])),
    };
    d.towns = townsInPath(tr, poly, minutes);
    W.draft = d;
    W.render(true);
    SM.$('#wnWin').hidden = false;
  };

  W.render = function (regenerate) {
    const d = W.draft;
    if (!d) return;
    const tx = texts(d);
    if (regenerate) { SM.$('#wnUk').value = tx.uk; SM.$('#wnEn').value = tx.en; d.title_uk = tx.title_uk; d.title_en = tx.title_en; }
    SM.$('#wnSev').value = d.severity;
    SM.$('#wnHaz').innerHTML = d.hazards.map(h => `<label class="toggle"><input type="checkbox" data-h="${h[0]}" ${d.enabled[h[0]] ? 'checked' : ''}><span></span>${SM.esc(h[2])}</label>`).join('');
    SM.$$('#wnHaz input').forEach(i => i.addEventListener('change', () => { d.enabled[i.dataset.h] = i.checked; W.render(true); }));
    SM.$('#wnTowns').textContent = d.towns.length ? d.towns.map(t => `${t.uk} ${kyivHM(t.eta)}`).join(' · ') : '— no towns from the list in the polygon —';
    const st = W.status || {};
    SM.$('#wnStatus').innerHTML = `${st.telegram ? '✔ Telegram bot connected' : '○ Telegram not configured (dry run)'} · ${st.channel ? 'channel ✔' : 'no channel'} · ${st.subscribers || 0} subscribers`;
    if (W.preview) SM.map.removeLayer(W.preview);
    W.preview = L.polygon(d.poly, { pane: 'routePane', color: SEV_COL[d.severity], weight: 2, dashArray: '6 4', fillOpacity: 0.12 }).addTo(SM.map);
  };

  W.publish = async function () {
    const d = W.draft;
    const token = SM.$('#wnToken').value.trim();
    if (!token) { SM.toast('Enter the admin token to publish', true); return; }
    try { sessionStorage.setItem('sm-admin', token); } catch (e) { /* ignore */ }
    const body = {
      polygon: d.poly, severity: SM.$('#wnSev').value, expires: d.expires, cell: d.cell,
      text_uk: SM.$('#wnUk').value, text_en: SM.$('#wnEn').value, title_uk: d.title_uk, title_en: d.title_en,
      towns: d.towns.map(t => t.uk),
    };
    if (!confirm(`Publish this ${body.severity.toUpperCase()} warning to the map${W.status && W.status.telegram ? ' and Telegram' : ''}?`)) return;
    try {
      const r = await fetch('/api/warn/publish', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.status);
      SM.toast(`Warning ${j.id} published${j.dry_run ? ' (Telegram dry run)' : ''} · ${j.subscribers} subscriber(s) in area`);
      W.close();
      W.load();
    } catch (e) { SM.toast('Publish failed: ' + e.message, true); }
  };

  W.cancel = async function (id) {
    let token = '';
    try { token = sessionStorage.getItem('sm-admin') || ''; } catch (e) { /* ignore */ }
    token = token || prompt('Admin token') || '';
    if (!token || !confirm('Cancel warning ' + id + '?')) return;
    const r = await fetch('/api/warn/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token }, body: JSON.stringify({ id }) });
    const j = await r.json();
    if (!r.ok) SM.toast('Cancel failed: ' + (j.error || r.status), true); else { SM.toast('Warning cancelled'); W.load(); }
  };

  W.close = function () {
    SM.$('#wnWin').hidden = true;
    if (W.preview) { SM.map.removeLayer(W.preview); W.preview = null; }
  };

  /* ---------- active warnings (visible to everyone) ---------- */
  W.load = async function () {
    try {
      const [a, s] = await Promise.all([SM.api('warn/active'), SM.api('warn/status')]);
      W.active = a.warnings; W.status = s;
      if (W.layer) SM.map.removeLayer(W.layer);
      W.layer = L.layerGroup();
      for (const w of W.active) {
        L.polygon(w.polygon, { pane: 'cellPane', color: SEV_COL[w.severity], weight: 2.5, fillOpacity: 0.1, interactive: true })
          .bindTooltip(`${SM.esc(SM.i18n && SM.i18n.lang === 'uk' ? w.title_uk : w.title_en)} · until ${kyivHM(w.expires)}`, { sticky: true })
          .addTo(W.layer);
      }
      W.layer.addTo(SM.map);
      const box = SM.$('#swList');
      if (box) {
        box.innerHTML = W.active.length ? W.active.map(w => `
          <div class="warn" style="--wc:${SEV_COL[w.severity]}"><div class="w-top"><b>${SM.esc(SM.i18n && SM.i18n.lang === 'uk' ? w.title_uk : w.title_en)}</b><span class="w-cc">${w.id}</span></div>
          <p>Until ${kyivHM(w.expires)} Kyiv · ${SM.esc(w.towns.slice(0, 8).join(', '))}</p>
          <button class="btn" data-cancel="${w.id}">Cancel</button></div>`).join('') : '<p class="hint">No active StormMap warnings.</p>';
        SM.$$('[data-cancel]', box).forEach(b => b.addEventListener('click', () => W.cancel(b.dataset.cancel)));
      }
      SM.emit('stormwarnings');
    } catch (e) { /* optional */ }
  };

  /** Published warning covering a point, if any. */
  W.at = (lat, lon) => W.active.find(w => inPoly(lat, lon, w.polygon));

  W.init = async function () {
    try { ukNames = await (await fetch('data/cities_uk.json')).json(); } catch (e) { ukNames = {}; }
    try { SM.$('#wnToken').value = sessionStorage.getItem('sm-admin') || ''; } catch (e) { /* ignore */ }
    SM.$('#wnClose').addEventListener('click', W.close);
    SM.$('#wnRegen').addEventListener('click', () => W.render(true));
    SM.$('#wnSev').addEventListener('change', e => { W.draft.severity = e.target.value; W.render(true); });
    SM.$('#wnDur').addEventListener('change', () => { if (W.draft) W.compose(W.draft.tr); });
    SM.$('#wnPublish').addEventListener('click', W.publish);
    W.load();
    setInterval(W.load, 60000);
  };
})();
