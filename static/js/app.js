/* StormMap — application controller */
'use strict';

(function () {
  const S = SM.state;
  const HOUR_KEYS_NOW = ['cape', 'shr6', 'srh1', 'srh3', 'scp', 'stp', 'ship', 'lcl'];

  /* ======================= URL state ======================= */
  function readHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    return { region: h.get('r'), model: h.get('m'), param: h.get('p'), hour: h.get('h') };
  }
  const writeHash = SM.debounce(() => {
    const h = new URLSearchParams({ r: S.region, m: S.model, p: S.param, h: S.hour });
    history.replaceState(null, '', '#' + h.toString());
  }, 300);

  /* ======================= Map ======================= */
  const BASES = {
    dark: () => L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> © <a href="https://carto.com/attributions">CARTO</a>' }),
    terrain: () => L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade_Dark/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, attribution: 'Hillshade © Esri' }),
    roads: () => L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> © <a href="https://carto.com/attributions">CARTO</a>' }),
    sat: () => L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: 'Imagery © Esri' }),
  };
  let baseLayer = null, labelLayer = null, satLayer = null;

  function initMap() {
    const map = SM.map = L.map('map', { zoomControl: false, worldCopyJump: false, minZoom: 3, maxZoom: 13, preferCanvas: false, zoomSnap: 0.5 })
      .setView(SM.meta.center, 5);
    L.control.zoom({ position: 'topright' }).addTo(map);
    L.control.scale({ imperial: false, position: 'topright' }).addTo(map);
    const panes = [['fieldPane', 350], ['isoPane', 355], ['satPane', 360], ['radarPane', 400], ['particlePane', 410], ['zonePane', 415], ['bordersPane', 420], ['roadPane', 425], ['labelsPane', 430], ['valuesPane', 440], ['lightningPane', 450], ['cellPane', 500]];
    for (const [name, z] of panes) { map.createPane(name); map.getPane(name).style.zIndex = z; }
    map.getPane('valuesPane').style.pointerEvents = 'none';
    map.getPane('particlePane').style.pointerEvents = 'none';
    map.getPane('isoPane').style.pointerEvents = 'none';
    map.getPane('zonePane').style.pointerEvents = 'none';
    map.getPane('roadPane').style.pointerEvents = 'none';
    map.createPane('routePane'); map.getPane('routePane').style.zIndex = 470;
    map.getPane('labelsPane').style.pointerEvents = 'none';
    map.getPane('bordersPane').style.pointerEvents = 'none';
    setBase('dark');
    labelLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', pane: 'labelsPane', maxZoom: 19 }).addTo(map);
  }

  function setBase(key) {
    if (baseLayer) SM.map.removeLayer(baseLayer);
    baseLayer = BASES[key]().addTo(SM.map);
    baseLayer.bringToBack();
    SM.$$('#baseSeg button').forEach(b => b.classList.toggle('active', b.dataset.base === key));
  }

  async function loadBorders() {
    const gj = await (await fetch('data/countries.geojson')).json();
    SM.countriesGeo = gj;
    SM.fieldLayer.redraw(); SM.outlookLayer.redraw();
    // draw borders as lines, skipping the artificial edge where European Russia is clipped at 62°E
    const lines = [];
    for (const f of gj.features) for (const poly of f.geometry.coordinates) for (const ring of poly) {
      let cur = [];
      for (let i = 0; i < ring.length; i++) {
        const c = ring[i], n = ring[i + 1];
        cur.push([c[1], c[0]]);
        if (n && c[0] === 62 && n[0] === 62) { if (cur.length > 1) lines.push(cur); cur = []; }
      }
      if (cur.length > 1) lines.push(cur);
    }
    SM.borders = L.polyline(lines, { pane: 'bordersPane', interactive: false, color: '#6ee7f9', weight: 1.1, opacity: 0.55 }).addTo(SM.map);
  }

  /* ======================= Controls ======================= */
  function buildSelectors() {
    const rs = SM.$('#regionSel');
    rs.appendChild(SM.el('option', { value: 'ALL' }, 'All 10 countries'));
    for (const [k, c] of Object.entries(SM.meta.countries)) rs.appendChild(SM.el('option', { value: k }, SM.esc(c.name)));
    const ms = SM.$('#modelSel');
    const groups = {};
    for (const [k, m] of Object.entries(SM.meta.models)) (groups[m.group] = groups[m.group] || []).push([k, m]);
    for (const [g, list] of Object.entries(groups)) {
      const og = SM.el('optgroup', { label: g });
      for (const [k, m] of list) og.appendChild(SM.el('option', { value: k }, `${SM.esc(m.name)} · ${SM.esc(m.res)}`));
      ms.appendChild(og);
    }
    rs.value = S.region; ms.value = S.model;
    rs.addEventListener('change', () => { S.region = rs.value; fitRegion(); SM.fieldLayer.setData([]); gridCache.clear(); reloadModel(); });
    ms.addEventListener('change', () => {
      S.model = ms.value;
      const cov = SM.meta.models[S.model].coverage;
      if (cov && S.region !== 'ALL' && !cov.includes(S.region)) SM.toast(`${SM.meta.models[S.model].name} may not fully cover ${SM.meta.countries[S.region].name}.`);
      if (cov && S.region === 'ALL') SM.toast(`${SM.meta.models[S.model].name} is a limited-area model — parts of the region will be blank. Pick a covered country for best results.`);
      gridCache.clear(); reloadModel(); SM.emit('model');
    });
  }

  function fitRegion() {
    const b = S.region === 'ALL' ? SM.meta.region_bounds : SM.meta.countries[S.region].bounds;
    SM.map.fitBounds([[b[0], b[2]], [b[1], b[3]]], { padding: [20, 20] });
  }

  function buildParamList() {
    const box = SM.$('#paramList');
    box.innerHTML = '';
    for (const [group, keys] of SM.PARAM_GROUPS) {
      const g = SM.el('div', { class: 'param-group' }, `<h4>${group}</h4>`);
      const chips = SM.el('div', { class: 'chips' });
      for (const k of keys) {
        const p = SM.meta.params[k];
        if (!p) continue;
        const na = S.available && !S.available.includes(k);
        const c = SM.el('button', { class: 'chip' + (k === S.param ? ' active' : '') + (na ? ' na' : ''), title: p.desc || p.label, 'data-k': k }, SM.esc(p.label));
        c.addEventListener('click', () => selectParam(k));
        chips.appendChild(c);
      }
      g.appendChild(chips);
      box.appendChild(g);
    }
    const p = SM.meta.params[S.param];
    const unit = SM.units.paramUnit(S.param);
    SM.$('#paramDesc').textContent = p ? `${p.label}${unit ? ' (' + unit + ')' : ''} — ${p.desc}` : '';
    SM.$('#legend').innerHTML = SM.legendHTML(S.param);
    buildLayerBar();
  }

  function selectParam(k) {
    S.param = k;
    for (const q of SM.QUICK_LAYERS) if (q[3].some(l => l[1] === k)) S.quickLevel[q[0]] = k;
    buildParamList();
    renderField();
    writeHash();
  }

  /* ======================= Ventusky-style layer bar ======================= */
  S.quickLevel = {};
  function buildLayerBar() {
    const bar = SM.$('#layerBar');
    bar.innerHTML = '';
    SM.QUICK_LAYERS.forEach(([id, label, icon, levels], i) => {
      if (id === 'cape') bar.appendChild(SM.el('div', { class: 'lb-sep' }));
      const active = levels.some(l => l[1] === S.param);
      const cur = levels.find(l => l[1] === (active ? S.param : S.quickLevel[id])) || levels[0];
      const na = S.available && !levels.some(l => S.available.includes(l[1]));
      const b = SM.el('button', { class: 'lb-btn' + (active ? ' active' : ''), title: label + (levels.length > 1 ? ' — click again for levels' : ''), 'data-id': id, style: na ? 'opacity:.35' : '' },
        `${SM.glyph(icon)}<span>${SM.esc(label)}</span>${levels.length > 1 && active ? '<span class="lvl">▾</span>' : ''}`);
      b.addEventListener('click', e => {
        e.stopPropagation();
        if (active && levels.length > 1) { openLevels(b, levels); return; }
        closeLevels();
        selectParam(cur[1]);
      });
      bar.appendChild(b);
    });
  }

  function openLevels(btn, levels) {
    const pop = SM.$('#levelPop');
    pop.innerHTML = '';
    for (const [lab, key] of levels) {
      const b = SM.el('button', { class: key === S.param ? 'active' : '' }, SM.esc(lab));
      b.addEventListener('click', e => { e.stopPropagation(); closeLevels(); selectParam(key); });
      pop.appendChild(b);
    }
    const wrap = SM.$('#mapWrap').getBoundingClientRect(), r = btn.getBoundingClientRect();
    pop.hidden = false;
    if (window.innerWidth < 820) { pop.style.left = Math.max(8, r.left - wrap.left) + 'px'; pop.style.top = (r.top - wrap.top - pop.offsetHeight - 6) + 'px'; }
    else { pop.style.left = (r.left - wrap.left - pop.offsetWidth - 8) + 'px'; pop.style.top = (r.top - wrap.top) + 'px'; }
  }
  function closeLevels() { SM.$('#levelPop').hidden = true; }

  /* ======================= Model grid ======================= */
  let gridReq = 0;
  S.grids = {};

  const gridCache = new Map();
  function fetchGrid(hour) {
    const key = `${S.model}|${S.region}|${hour}`;
    if (!gridCache.has(key)) {
      const pr = SM.api('grid', { model: S.model, region: S.region, hour }).catch(e => { gridCache.delete(key); throw e; });
      gridCache.set(key, pr);
      if (gridCache.size > 30) gridCache.delete(gridCache.keys().next().value);
    }
    return gridCache.get(key);
  }
  function prefetch() {
    if (!S.times) return;
    for (const dh of [1, 2]) if (S.hour + dh < S.times.length) fetchGrid(S.hour + dh).catch(() => {});
  }

  async function loadGrid() {
    const id = ++gridReq;
    const cached = gridCache.has(`${S.model}|${S.region}|${S.hour}`);
    SM.status('stModel', 'busy', 'Loading model grid…');
    if (!cached) SM.loading('grid', `Loading ${SM.meta.models[S.model].name}…`);
    try {
      const d = await fetchGrid(S.hour);
      if (id !== gridReq) return;
      S.gridData = d;
      S.times = d.times;
      S.available = d.available;
      S.grids = {};
      for (const [k, vals] of Object.entries(d.fields)) S.grids[k] = new SM.Grid(d.grid, d.idx, vals);
      S.coords = d.idx.map(i => [d.grid.lat0 + Math.floor(i / d.grid.nlon) * d.grid.step, d.grid.lon0 + (i % d.grid.nlon) * d.grid.step]);
      buildParamList();
      renderField();
      updateTimeLabel();
      const age = Math.round((Date.now() / 1000 - d.fetched) / 60);
      const m = SM.meta.models[S.model];
      SM.status('stModel', 'ok', `${m.name}: ${d.idx.length} grid points, step ${d.grid.step}°, fetched ${age} min ago`);
      SM.$('#modelBadge').innerHTML = `<b>${SM.esc(m.name)}</b> · ${SM.esc(m.res)} · grid ${d.grid.step}° · updated ${age < 1 ? 'just now' : age + ' min ago'}`;
      prefetch();
    } catch (e) {
      if (id !== gridReq) return;
      SM.status('stModel', 'err', e.message);
      SM.toast('Model data: ' + e.message, true, 8000);
    } finally {
      if (id === gridReq) SM.loading('grid');
    }
  }

  function renderField(fade = true) {
    const g = S.grids[S.param];
    const layers = [];
    if (SM.$('#lyrField').checked && g) {
      if (S.param === 'precip' && S.grids.cloud) layers.push({ grid: S.grids.cloud, key: 'cloud' });
      layers.push({ grid: g, key: S.param });
    }
    SM.fieldLayer.setData(layers, fade);
    // isolines
    let iso = SM.$('#isoSel').value;
    if (iso === 'auto') iso = S.param === 'mslp' ? 'mslp' : S.param === 'z500' ? 'z500' : 'none';
    if (iso === 'mslp' && S.grids.mslp) {
      SM.contourLayer.setData(S.grids.mslp, { interval: 4, bold: 20, extrema: true, format: v => SM.units.fmt('pressure', v) });
    } else if (iso === 'z500' && S.grids.z500) {
      SM.contourLayer.setData(S.grids.z500, { interval: 4, bold: 24, extrema: true, format: v => String(Math.round(v)) });
    } else SM.contourLayer.setData(null);
    // animated wind
    if (SM.$('#lyrParticles').checked) {
      let lvl = SM.PARTICLE_LEVEL[S.param] || '10';
      if (!S.grids['u' + lvl]) lvl = S.grids.u500 && lvl === '250' ? '500' : '10';
      SM.particleLayer.setField(S.grids['u' + lvl], S.grids['v' + lvl], lvl);
      SM.$('#particleLevel').textContent = lvl === '10' ? '10 m' : lvl + ' hPa';
    } else SM.particleLayer.setField(null, null);
    // values at cities
    SM.cityLayer.setData(SM.$('#lyrValues').checked && g ? g : null, S.param);
    if (SM.$('#lyrBarbs').checked && S.gridData) {
      const lvl = SM.$('#barbLevel').value, f = S.gridData.fields;
      const u = f['u' + lvl], v = f['v' + lvl];
      SM.barbLayer.setData(u, v, S.coords);
    } else SM.barbLayer.setData(null);
  }

  let nowReq = 0;
  async function loadNowFields() {
    if (!S.times) return;
    const nowIdx = nowIndex();
    const id = ++nowReq;
    try {
      const d = nowIdx === S.hour && S.gridData ? S.gridData : await SM.api('grid', { model: S.model, region: S.region, hour: nowIdx });
      if (id !== nowReq) return;
      const out = {};
      for (const k of HOUR_KEYS_NOW) if (d.fields[k]) out[k] = new SM.Grid(d.grid, d.idx, d.fields[k]);
      S.nowFields = out;
      SM.emit('now-fields');
    } catch (e) { /* tracker simply lacks environment data */ }
  }

  function nowIndex() {
    if (!S.times) return 0;
    const now = Date.now() / 1000;
    let best = 0;
    for (let i = 0; i < S.times.length; i++) if (S.times[i] <= now) best = i;
    return best;
  }

  async function reloadModel() {
    writeHash();
    SM.$('#olModel').textContent = SM.meta.models[S.model].name;
    await loadGrid();
    loadTimeline();
    loadNowFields();
    loadOutlook();
  }

  /* ======================= Timeline ======================= */
  let playTimer = null;
  function setHour(h, load = true) {
    if (!S.times) return;
    S.hour = Math.max(0, Math.min(h, S.times.length - 1));
    SM.$('#tlSlider').value = S.hour;
    updateTimeLabel();
    writeHash();
    if (load) debouncedGrid();
    SM.emit('hour', S.hour);
  }
  const debouncedGrid = SM.debounce(loadGrid, 120);

  function updateTimeLabel() {
    if (!S.times) return;
    const t = S.times[S.hour];
    SM.$('#tlTime').textContent = SM.units.stamp(t);
    const lead = Math.round((t - Date.now() / 1000) / 3600);
    SM.$('#tlLead').textContent = (lead >= 0 ? '+' : '') + lead + 'h · ' + (SM.units.cfg.time === 'utc' ? SM.localHM(t) + ' local' : SM.utcHM(t) + 'Z');
    SM.$('#tlSlider').max = S.times.length - 1;
    SM.$('#tlSlider').value = S.hour;
  }

  async function loadTimeline() {
    try {
      const d = await SM.api('timeline', { model: S.model, region: S.region });
      S.timeline = d;
      drawSpark();
    } catch (e) { /* sparkline is optional */ }
  }

  function drawSpark() {
    const d = S.timeline;
    const cv = SM.$('#tlSpark');
    const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    cv.width = r.width * dpr; cv.height = r.height * dpr;
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    const days = SM.$('#tlDays');
    days.innerHTML = '';
    if (!d) return;
    const n = d.times.length, w = r.width / n;
    const maxCape = Math.max(1000, ...d.cape);
    for (let i = 0; i < n; i++) {
      const lv = d.threat[i];
      const h = 4 + (d.cape[i] / maxCape) * (r.height - 8);
      ctx.fillStyle = lv >= 1 ? SM.THREAT_COLORS[Math.min(lv, 5)] : '#1a2030';
      ctx.globalAlpha = lv >= 1 ? 0.85 : 0.6;
      ctx.fillRect(i * w + 0.5, r.height - h, Math.max(1, w - 1), h);
      const dt = new Date(d.times[i] * 1000);
      if ((SM.units.cfg.time === 'utc' ? dt.getUTCHours() : dt.getHours()) === 0) {
        days.appendChild(SM.el('span', { style: `left:${(i / n) * 100}%` }, SM.units.dayLabel(d.times[i])));
      }
    }
    ctx.globalAlpha = 1;
    const nx = (nowIndex() + 0.5) * w;
    ctx.strokeStyle = '#22d3ee'; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(nx, 0); ctx.lineTo(nx, r.height); ctx.stroke();
  }

  function togglePlay() {
    if (playTimer) { clearInterval(playTimer); playTimer = null; SM.$('#tlPlay').textContent = '▶'; return; }
    SM.$('#tlPlay').textContent = '❚❚';
    playTimer = setInterval(() => setHour(S.hour + 1 >= S.times.length ? 0 : S.hour + 1), 1100);
  }

  /* ======================= Readout ======================= */
  function initReadout() {
    const box = SM.$('#readout');
    let pending = null;
    SM.map.on('mousemove', e => {
      pending = e.latlng;
      requestAnimationFrame(() => {
        if (!pending) return;
        const { lat, lng } = pending; pending = null;
        const g = S.grids[S.param];
        const p = SM.meta.params[S.param];
        if (!g) { box.hidden = true; return; }
        const v = S.param === 'threat' ? g.category(lat, lng) : g.smooth(lat, lng);
        let txt = `${lat.toFixed(2)}, ${lng.toFixed(2)}`;
        if (v === v) {
          const shown = S.param === 'threat' ? SM.THREAT_NAMES[Math.max(0, v)] : SM.units.fmtParam(S.param, v);
          txt += ` · ${SM.esc(p.label)} <b>${shown}</b> ${SM.esc(SM.units.paramUnit(S.param))}`;
          const at = k => S.grids[k] ? S.grids[k].smooth(lat, lng) : NaN;
          const weather = ['t2', 'precip', 'cloud', 'wind10', 'gust', 'mslp', 'rh2', 'td2'].includes(S.param);
          const extra = weather ? [['t2', 'Temp'], ['wind10', 'Wind'], ['mslp', 'Pressure']] : [['cape', 'CAPE'], ['shr6', 'Shear'], ['srh1', 'SRH1']];
          for (const [k, lab] of extra) {
            const x = at(k);
            if (k !== S.param && x === x) txt += ` · ${lab} ${SM.units.fmtParam(k, x, true)}`;
          }
        }
        box.innerHTML = txt;
        box.hidden = false;
      });
    });
    SM.map.on('mouseout', () => { box.hidden = true; });
  }

  /* ======================= Outlook ======================= */
  S.olDay = 0;
  async function loadOutlook() {
    const box = SM.$('#olCountries');
    box.innerHTML = '<p class="hint">Computing outlook…</p>';
    try {
      const d = await SM.api('outlook', { model: S.model, region: S.region });
      S.outlook = d;
      if (S.olDay >= d.days.length) S.olDay = 0;
      renderOutlook();
    } catch (e) { box.innerHTML = `<p class="hint">Outlook unavailable: ${SM.esc(e.message)}</p>`; }
  }

  function renderOutlook() {
    const d = S.outlook;
    if (!d) return;
    const seg = SM.$('#olDays');
    seg.innerHTML = '';
    d.days.forEach((day, i) => {
      const dt = new Date(day.date + 'T00:00:00Z');
      const lab = `Day ${i + 1} · ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getUTCDay()]} ${dt.getUTCDate()}`;
      const b = SM.el('button', { class: i === S.olDay ? 'active' : '' }, lab);
      b.addEventListener('click', () => { S.olDay = i; renderOutlook(); });
      seg.appendChild(b);
    });
    SM.$('#olLegend').innerHTML = SM.scales.threat.cats.map(c => `<span style="background:${c[1]}">${c[2]}</span>`).join('');
    const day = d.days[S.olDay];
    SM.$('#olCountries').innerHTML = '';
    for (const c of day.countries) {
      const col = c.level ? SM.THREAT_COLORS[c.level] : '#2a3142';
      const el = SM.el('div', { class: 'olc' }, `<b>${SM.esc(c.name)}</b><span class="cat" style="background:${col};${c.level ? '' : 'color:var(--muted)'}">${SM.THREAT_NAMES[c.level]}</span><p>${SM.esc(c.text)}${c.severe_pct ? ` · ${c.severe_pct}% of area ≥ SLGT` : ''}</p>`);
      el.addEventListener('click', () => { const b = SM.meta.countries[c.code].bounds; SM.map.fitBounds([[b[0], b[2]], [b[1], b[3]]]); });
      SM.$('#olCountries').appendChild(el);
    }
    const tb = SM.$('#olTargets');
    tb.innerHTML = day.targets.length ? '' : '<p class="hint">No organised severe threat identified for this day.</p>';
    day.targets.forEach((t, i) => {
      const el = SM.el('div', { class: 'target' }, `
        <div class="t-top"><span><span class="rank">#${i + 1}</span><b>${SM.esc(t.place || '')}</b></span><span class="cat" style="font:600 10px var(--mono);padding:2px 6px;border-radius:4px;color:#000;background:${SM.THREAT_COLORS[t.level] || '#444'}">${SM.THREAT_NAMES[t.level] || ''}</span></div>
        <div class="t-vals">${SM.utcLabel(t.time)} · CAPE ${SM.fmt(t.cape)} · Shear ${SM.fmt(t.shr6, 0)} m/s · SRH1 ${SM.fmt(t.srh1)} · STP ${SM.fmt(t.stp, 1)} · SCP ${SM.fmt(t.scp, 1)} · SHIP ${SM.fmt(t.ship, 1)} · LCL ${SM.fmt(t.lcl)} m</div>`);
      el.addEventListener('click', () => {
        SM.map.flyTo([t.lat, t.lon], 7);
        setHour(t.hour);
        SM.drawer.open(t.lat, t.lon, { hour: t.hour });
      });
      tb.appendChild(el);
    });
    renderOutlookLayer();
  }

  function renderOutlookLayer() {
    const d = S.outlook;
    if (!SM.$('#lyrOutlook').checked || !d) { SM.outlookLayer.setData([]); return; }
    SM.outlookLayer.setData([{ grid: new SM.Grid(d.grid, d.idx, d.days[S.olDay].category), key: 'threat' }]);
  }

  /* ======================= Warnings ======================= */
  const CONVECTIVE = /thunder|storm|wind|rain|flood|hail|tornado|gale|squall|lightning|convect/i;
  S.warnFilter = 'storm';
  async function loadWarnings() {
    try {
      const d = await SM.api('warnings');
      S.warnings = d;
      renderWarnings();
    } catch (e) { SM.$('#warnList').innerHTML = `<p class="hint">Warnings unavailable: ${SM.esc(e.message)}</p>`; }
  }
  function renderWarnings() {
    const d = S.warnings;
    if (!d) return;
    const list = d.warnings.filter(w => w.level >= 2 && (S.warnFilter === 'all' || CONVECTIVE.test(w.type + ' ' + w.event)));
    const badge = SM.$('#warnBadge');
    const orange = list.filter(w => w.level >= 3).length;
    badge.hidden = !orange; badge.textContent = orange;
    const col = { 1: '#34d399', 2: '#fbbf24', 3: '#fb923c', 4: '#f43f5e' };
    const box = SM.$('#warnList');
    box.innerHTML = list.length ? '' : '<p class="hint">No active yellow+ warnings of this type.</p>';
    for (const w of list.slice(0, 150)) {
      const t = [w.onset, w.expires].filter(Boolean).map(x => x.replace('T', ' ').slice(0, 16)).join(' → ');
      box.appendChild(SM.el('div', { class: 'warn', style: `--wc:${col[w.level]}` }, `
        <div class="w-top"><b>${SM.esc(w.event || w.type)}</b><span class="w-cc">${SM.esc(w.country)}</span></div>
        <p>${SM.esc(w.areas.join(', '))}${w.n_areas > w.areas.length ? ` +${w.n_areas - w.areas.length} more` : ''}</p>
        ${w.description ? `<p>${SM.esc(w.description.slice(0, 260))}</p>` : ''}
        ${t ? `<div class="w-time">${SM.esc(t)}</div>` : ''}`));
    }
    SM.$('#warnStatus').innerHTML = '<div><b>Feed status</b></div>' + Object.entries(d.status).map(([c, s]) => `<div><span>${SM.esc(SM.meta.countries[c].name)}</span><span>${SM.esc(s)}</span></div>`).join('');
  }

  /* ======================= Chase mode ======================= */
  const C = SM.chase = { pos: null, watch: null, marker: null, picking: false, line: null };

  C.setPos = function (lat, lon, src) {
    C.pos = [lat, lon];
    C.src = src;
    if (!C.marker) {
      C.marker = L.marker([lat, lon], { pane: 'cellPane', icon: L.divIcon({ className: '', iconSize: [18, 18], html: '<div style="width:18px;height:18px;border-radius:50%;background:#22d3ee;border:3px solid #031014;box-shadow:0 0 0 3px rgba(34,211,238,.35),0 0 18px #22d3ee"></div>' }) }).addTo(SM.map);
    } else C.marker.setLatLng([lat, lon]);
    C.render();
    SM.tracker.refreshEnrich();
  };

  /** Relative geometry of a track vs. the chaser. Units: km, minutes. */
  C.solve = function (tr) {
    if (!C.pos) return null;
    const c = tr.cur;
    const D = SM.geo.enu(C.pos, [c.lat, c.lon]);
    const dist = Math.hypot(D[0], D[1]);
    const out = { dist, brg: SM.geo.bearing(C.pos[0], C.pos[1], c.lat, c.lon) };
    if (!tr.v) return out;
    const V = [tr.v[0] * 0.06, tr.v[1] * 0.06]; // km/min
    const vv = V[0] * V[0] + V[1] * V[1];
    const tMin = vv > 0 ? Math.max(0, Math.min(120, -(D[0] * V[0] + D[1] * V[1]) / vv)) : 0;
    out.cpaT = tMin;
    out.cpaD = Math.hypot(D[0] + V[0] * tMin, D[1] + V[1] * tMin);
    out.approaching = (D[0] * V[0] + D[1] * V[1]) < 0;
    // intercept: |D + V t| = s t, s = effective road speed (km/min), road factor 1.3
    const s = (+SM.$('#chaseSpeed').value || 80) / 60 / 1.3;
    const a = vv - s * s, b = 2 * (D[0] * V[0] + D[1] * V[1]), cc = dist * dist;
    let t = null;
    if (Math.abs(a) < 1e-9) t = b < 0 ? -cc / b : null;
    else {
      const disc = b * b - 4 * a * cc;
      if (disc >= 0) {
        const r1 = (-b - Math.sqrt(disc)) / (2 * a), r2 = (-b + Math.sqrt(disc)) / (2 * a);
        t = [r1, r2].filter(x => x > 0).sort((x, y) => x - y)[0] ?? null;
      }
    }
    if (t != null && t < 240) {
      out.icptT = t;
      out.icpt = SM.geo.offset(c.lat, c.lon, V[0] * t, V[1] * t);
      out.icptBrg = SM.geo.bearing(C.pos[0], C.pos[1], out.icpt[0], out.icpt[1]);
      out.icptDist = SM.geo.dist(C.pos[0], C.pos[1], out.icpt[0], out.icpt[1]);
    }
    return out;
  };

  C.threatTo = function (tr) {
    const s = C.solve(tr);
    if (!s) return null;
    const r = Math.sqrt(tr.cur.area / Math.PI);
    if (s.dist < r + 3) return 'OVERHEAD';
    if (s.cpaD != null && s.approaching && s.cpaD < r + 12 && s.cpaT < 90) return `HITS YOU ~${Math.round(s.cpaT)} min`;
    return null;
  };

  C.render = function () {
    const box = SM.$('#chaseInfo');
    if (!C.pos) return;
    const place = SM.nearestCity(C.pos[0], C.pos[1]);
    let html = `<div class="chase-me">📍 <b>${SM.esc(place.label)}</b><br>${C.pos[0].toFixed(4)}, ${C.pos[1].toFixed(4)} · ${SM.esc(C.src)}</div>`;
    const zc = SM.zones.at(C.pos[0], C.pos[1]);
    if (zc) html += `<div class="danger-banner">⛔ Your position is inside a no-go area (${SM.esc(SM.zones.label(zc))}). Routing is disabled from here.</div>`;
    const tracks = SM.tracker.tracks.map(tr => ({ tr, s: C.solve(tr) })).filter(x => x.s && x.s.dist < 400).sort((a, b) => a.s.dist - b.s.dist).slice(0, 15);
    const threats = tracks.filter(x => C.threatTo(x.tr));
    if (threats.length) html += `<div class="danger-banner">⚠ ${threats.length} cell(s) forecast to pass over or near your position: ${threats.map(x => 'C' + x.tr.id + ' (' + SM.esc(C.threatTo(x.tr)) + ')').join(', ')}</div>`;
    if (!tracks.length) html += '<p class="hint">No tracked cells within 400 km.</p>';
    box.innerHTML = html;
    for (const { tr, s } of tracks) {
      const el = SM.el('div', { class: 'icpt', style: `--c:${SM.tracker.color(tr)}` }, `
        <div class="i-top"><span>C${tr.id} · ${tr.cur.maxDbz} dBZ</span><span>${Math.round(s.dist)} km ${SM.geo.compass(s.brg)}</span></div>
        <p>${tr.v ? `Moving ${SM.geo.compass(tr.dir)} at ${Math.round(tr.spd * 3.6)} km/h · ${s.approaching ? '<b>approaching</b>' : 'moving away'} · closest ${Math.round(s.cpaD)} km in ${Math.round(s.cpaT)} min` : 'Motion unknown (new cell)'}</p>
        <p>${s.icptT != null ? `Straight-line estimate: head <b>${SM.geo.compass(s.icptBrg)}</b> ${Math.round(s.icptDist)} km, meet in ~<b>${Math.round(s.icptT)} min</b>` : 'No intercept possible at this speed'}</p>
        ${tr.rank ? `<p>Potential: <b style="color:${tr.rank.color}">${tr.rank.verdict} (${tr.rank.score})</b>${tr.rank.chase.ok ? '' : ' · <b style="color:#f87171">not chaseable</b>'}</p>` : ''}
        <div class="rk-actions"><button class="btn primary" data-act="road" ${tr.v && (!tr.rank || tr.rank.chase.ok) ? '' : 'disabled'}>Plan road intercept</button></div>`);
      el.querySelector('[data-act=road]').addEventListener('click', ev => { ev.stopPropagation(); C.planIntercept(tr); });
      el.addEventListener('click', () => {
        SM.tracker.select(tr.id, false);
        if (C.line) SM.map.removeLayer(C.line);
        if (s.icpt) {
          C.line = L.polyline([C.pos, s.icpt], { pane: 'cellPane', color: '#22d3ee', weight: 2, dashArray: '2 6' }).addTo(SM.map);
          SM.map.fitBounds(L.latLngBounds([C.pos, s.icpt, [tr.cur.lat, tr.cur.lon]]).pad(0.3));
        } else SM.map.fitBounds(L.latLngBounds([C.pos, [tr.cur.lat, tr.cur.lon]]).pad(0.3));
      });
      box.appendChild(el);
    }
  };

  /* ---------- road routing & storm intercept ---------- */
  C.mode = 'flank';
  C.routeLayer = null;

  function clearRoute() {
    if (C.routeLayer) { SM.map.removeLayer(C.routeLayer); C.routeLayer = null; }
    SM.$('#routeBox').hidden = true;
  }
  C.clearRoute = clearRoute;

  function drawRoute(route, extras = []) {
    if (C.routeLayer) SM.map.removeLayer(C.routeLayer);
    const g = L.layerGroup();
    const approx = route.source === 'approx';
    L.polyline(route.geometry, { pane: 'routePane', color: '#22d3ee', weight: 9, opacity: 0.18, interactive: false }).addTo(g);
    L.polyline(route.geometry, { pane: 'routePane', color: '#67e8f9', weight: 3.2, opacity: 0.95, dashArray: approx ? '8 7' : null, interactive: false }).addTo(g);
    for (const x of extras) x.addTo(g);
    C.routeLayer = g.addTo(SM.map);
    if (!SM.$('#lyrRoads').checked && !approx) { SM.$('#lyrRoads').checked = true; setRoads(); }
    SM.map.fitBounds(L.latLngBounds(route.geometry.concat(extras.filter(x => x.getLatLng).map(x => x.getLatLng()))).pad(0.15));
  }

  function stepText(s) {
    if (s.type === 'waypoint') return SM.esc(s.name);
    const verb = { depart: 'Start', arrive: 'Arrive', turn: 'Turn', 'new name': 'Continue', merge: 'Merge', 'on ramp': 'Take ramp', 'off ramp': 'Exit', fork: 'Keep', 'end of road': 'Turn', continue: 'Continue', roundabout: 'Roundabout', rotary: 'Roundabout', 'exit roundabout': 'Exit roundabout' }[s.type] || 'Continue';
    const mod = s.modifier && !['depart', 'arrive'].includes(s.type) ? ' ' + s.modifier : '';
    return `${verb}${mod}${s.name ? ' — <b>' + SM.esc(s.name) + '</b>' : ''}`;
  }

  function routeHTML(route) {
    const safe = route.safety || {};
    const src = route.source === 'osrm' ? 'Real roads (OSRM / OpenStreetMap)' : 'Approximate — no road data';
    const steps = (route.steps || []).slice(0, 40).map(s => `<li>${stepText(s)}${s.distance_km != null ? `<span>${s.distance_km} km</span>` : ''}</li>`).join('');
    return `
      <div class="rt-stats">
        <div><span>Drive</span><b>${Math.round(route.duration_min)} min</b></div>
        <div><span>Distance</span><b>${Math.round(route.distance_km)} km</b></div>
        <div><span>Arrive</span><b>${SM.localHM(Date.now() / 1000 + route.duration_min * 60)}</b></div>
      </div>
      <div class="rt-safe ${safe.ok ? 'ok' : 'bad'}">${safe.ok ? '✔ Checked against no-go zones every 0.5 km' + (safe.min_front_km != null && safe.min_front_km < 120 ? ` · closest front line ≈ ${safe.min_front_km} km` : '') : '⛔ ' + SM.esc(safe.reason || 'Route crosses a no-go area')}</div>
      <div class="rt-src ${route.source}">${src}${route.via ? ' · via ' + SM.esc(route.via) : ''}</div>
      ${route.approx_note ? `<p class="hint">${SM.esc(route.approx_note)}</p>` : ''}
      ${steps ? `<details class="rt-steps"><summary>Directions (${route.steps.length} steps)</summary><ol>${steps}</ol></details>` : ''}`;
  }

  function zoneParams() {
    return { front: SM.zones.front, border: SM.zones.border, speed: +SM.$('#chaseSpeed').value || 80 };
  }

  C.planIntercept = async function (tr) {
    if (!C.pos) {
      SM.toast('Set your position first (Chase → Track my GPS or Set position on map)', true, 6000);
      SM.$('.rail-btn[data-panel=chase]').click();
      return;
    }
    if (!tr.v) { SM.toast('Cell motion unknown yet — wait for another radar frame.', true); return; }
    const box = SM.$('#routeBox');
    box.hidden = false;
    box.innerHTML = `<div class="rt-head"><b>Intercepting C${tr.id}…</b></div><p class="hint">Finding the earliest safe road intercept.</p>`;
    if (!SM.$('#panel .pane[data-pane=chase]').classList.contains('active')) SM.$('.rail-btn[data-panel=chase]').click();
    SM.loading('route', 'Planning intercept…');
    try {
      const r = Math.sqrt(tr.cur.area / Math.PI);
      const x = await SM.api('intercept', Object.assign(zoneParams(), {
        from: C.pos.join(','), lat: tr.cur.lat, lon: tr.cur.lon, u: tr.v[0].toFixed(2), v: tr.v[1].toFixed(2), r: r.toFixed(1), mode: C.mode,
      }));
      if (!x.ok) {
        box.innerHTML = `<div class="rt-head"><b>C${tr.id}: no safe intercept</b><button class="icon-btn" id="rtClose">✕</button></div>
          <div class="danger-banner">${SM.esc(x.reason)}</div>
          ${x.enters_nogo_min ? `<p class="hint">⚠ The storm enters a no-go area in ~${x.enters_nogo_min} min.</p>` : ''}
          ${(x.notes || []).map(n => `<p class="hint">${SM.esc(n)}</p>`).join('')}`;
        SM.$('#rtClose').onclick = clearRoute;
        return;
      }
      const tgt = L.marker(x.target, { pane: 'routePane', icon: L.divIcon({ className: '', iconSize: [22, 22], html: '<div class="tgt-icon">⊕</div>' }) })
        .bindTooltip(`Intercept point · be here by ${SM.localHM(x.storm_ts - 600)}`, { direction: 'top' });
      const storm = L.circleMarker(x.storm_at_target_time, { pane: 'routePane', radius: 9, color: '#f43f5e', weight: 2, fillOpacity: 0.2 })
        .bindTooltip(`C${tr.id} forecast position at ${SM.localHM(x.storm_ts)}`, { direction: 'top' });
      const link = L.polyline([x.target, x.storm_at_target_time], { pane: 'routePane', color: '#f43f5e', weight: 1.5, dashArray: '3 5' });
      drawRoute(x.route, [tgt, storm, link]);
      box.innerHTML = `
        <div class="rt-head"><b>Intercept C${tr.id}</b><span class="rt-mode">${x.mode === 'flank' ? 'safe flank' : 'on track'}</span><button class="icon-btn" id="rtClose">✕</button></div>
        <div class="rt-plan">Drive <b>${SM.geo.compass(x.approach_bearing)}</b> to ${SM.esc(x.target_place ? x.target_place.label : '')}. You arrive at <b>${SM.localHM(x.arrive_ts)}</b>; the storm (moving ${x.storm_heading_text} at ${SM.units.fmt('wind', x.storm_speed_kmh / 3.6, true)}) reaches the area around <b>${SM.localHM(x.storm_ts)}</b> — <b>${Math.round(x.margin_min)} min</b> margin.</div>
        ${x.enters_nogo_min ? `<div class="danger-banner">⚠ Storm enters a no-go area in ~${x.enters_nogo_min} min — do not follow it there.</div>` : ''}
        ${routeHTML(x.route)}`;
      SM.$('#rtClose').onclick = clearRoute;
    } catch (e) {
      box.innerHTML = `<div class="rt-head"><b>Intercept failed</b><button class="icon-btn" id="rtClose">✕</button></div><div class="danger-banner">${SM.esc(e.message)}</div>`;
      SM.$('#rtClose').onclick = clearRoute;
    } finally { SM.loading('route'); }
  };

  C.routeTo = async function (lat, lon) {
    if (!C.pos) { SM.toast('Set your position first', true); return; }
    const box = SM.$('#routeBox');
    box.hidden = false;
    box.innerHTML = '<div class="rt-head"><b>Routing…</b></div>';
    SM.loading('route', 'Finding a safe road route…');
    try {
      const r = await SM.api('route', Object.assign(zoneParams(), { from: C.pos.join(','), to: `${lat.toFixed(5)},${lon.toFixed(5)}` }));
      const dest = L.circleMarker([lat, lon], { pane: 'routePane', radius: 7, color: '#67e8f9', weight: 2, fillOpacity: 0.3 });
      drawRoute(r, [dest]);
      box.innerHTML = `<div class="rt-head"><b>Route to ${SM.esc(SM.nearestCity(lat, lon).label)}</b><button class="icon-btn" id="rtClose">✕</button></div>${routeHTML(r)}`;
    } catch (e) {
      box.innerHTML = `<div class="rt-head"><b>No route</b><button class="icon-btn" id="rtClose">✕</button></div><div class="danger-banner">${SM.esc(e.message)}</div>`;
    } finally {
      SM.loading('route');
      SM.$('#rtClose').onclick = clearRoute;
    }
  };

  let roadLayer = null;
  function setRoads() {
    if (roadLayer) { SM.map.removeLayer(roadLayer); roadLayer = null; }
    if (!SM.$('#lyrRoads').checked) return;
    roadLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', {
      pane: 'roadPane', maxZoom: 18, opacity: 0.75, attribution: 'Roads © Esri, HERE, OpenStreetMap',
    }).addTo(SM.map);
  }

  function initChase() {
    const fb = SM.$('#frontBuf'), bb = SM.$('#borderBuf');
    fb.value = SM.zones.front; bb.value = SM.zones.border;
    const lab = () => { SM.$('#frontBufV').textContent = fb.value + ' km'; SM.$('#borderBufV').textContent = bb.value + ' km'; };
    lab();
    for (const r of [fb, bb]) r.addEventListener('input', () => { lab(); SM.zones.setBuffers(+fb.value, +bb.value); });
    SM.$$('#approachSeg button').forEach(b => b.addEventListener('click', () => {
      C.mode = b.dataset.m;
      SM.$$('#approachSeg button').forEach(x => x.classList.toggle('active', x === b));
    }));
    SM.$('#routePickBtn').addEventListener('click', () => {
      C.routePicking = !C.routePicking;
      SM.$('#routePickBtn').classList.toggle('on', C.routePicking);
      SM.map.getContainer().style.cursor = C.routePicking ? 'crosshair' : '';
      if (C.routePicking) SM.toast('Click the map to choose a destination');
    });
    SM.$('#lyrRoads').addEventListener('change', setRoads);
    SM.$('#lyrZones').addEventListener('change', e => SM.zones.setEnabled(e.target.checked));
    SM.$('#gpsBtn').addEventListener('click', () => {
      if (C.watch != null) {
        navigator.geolocation.clearWatch(C.watch); C.watch = null;
        SM.$('#gpsBtn').textContent = 'Track my GPS'; SM.$('#gpsBtn').classList.remove('on');
        return;
      }
      if (!navigator.geolocation) { SM.toast('Geolocation not available in this browser', true); return; }
      SM.$('#gpsBtn').textContent = 'Stop GPS'; SM.$('#gpsBtn').classList.add('on');
      let first = true;
      C.watch = navigator.geolocation.watchPosition(p => {
        C.setPos(p.coords.latitude, p.coords.longitude, `GPS ±${Math.round(p.coords.accuracy)} m`);
        if (first) { SM.map.flyTo(C.pos, 8); first = false; }
      }, err => {
        SM.toast('GPS: ' + err.message + (location.protocol === 'http:' && location.hostname !== 'localhost' ? ' (browsers require HTTPS or localhost for GPS — use "Set position on map")' : ''), true, 9000);
        navigator.geolocation.clearWatch(C.watch); C.watch = null;
        SM.$('#gpsBtn').textContent = 'Track my GPS'; SM.$('#gpsBtn').classList.remove('on');
      }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
    });
    SM.$('#pickBtn').addEventListener('click', () => {
      C.picking = !C.picking;
      SM.$('#pickBtn').classList.toggle('on', C.picking);
      SM.map.getContainer().style.cursor = C.picking ? 'crosshair' : '';
      if (C.picking) SM.toast('Click the map to set your position');
    });
    SM.$('#chaseSpeed').addEventListener('change', () => { C.render(); SM.tracker.refreshEnrich(); });
    SM.on('cells', () => C.render());
  }

  /* ======================= Search ======================= */
  function initSearch() {
    const inp = SM.$('#searchInput'), res = SM.$('#searchResults');
    const run = SM.debounce(async () => {
      const q = inp.value.trim();
      if (q.length < 2) { res.hidden = true; return; }
      try {
        const d = await SM.api('geocode', { q });
        res.innerHTML = '';
        if (!d.results.length) { res.innerHTML = '<button disabled>No matches in coverage area</button>'; res.hidden = false; return; }
        for (const r of d.results) {
          const b = SM.el('button', {}, `${SM.esc(r.name)}<small>${SM.esc(r.admin1 || '')} ${SM.esc(r.country_code)}</small>`);
          b.addEventListener('click', () => {
            res.hidden = true; inp.value = r.name;
            SM.map.flyTo([r.latitude, r.longitude], 8);
            SM.drawer.open(r.latitude, r.longitude);
          });
          res.appendChild(b);
        }
        res.hidden = false;
      } catch (e) { res.hidden = true; }
    }, 250);
    inp.addEventListener('input', run);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { const b = res.querySelector('button:not([disabled])'); if (b) b.click(); } if (e.key === 'Escape') res.hidden = true; });
    document.addEventListener('click', e => { if (!e.target.closest('.search')) res.hidden = true; });
  }

  /* ======================= Panels & layers UI ======================= */
  function initPanels() {
    SM.$$('.rail-btn').forEach(b => b.addEventListener('click', () => {
      const panel = SM.$('#panel');
      const same = b.classList.contains('active') && !panel.classList.contains('collapsed');
      SM.$$('.rail-btn').forEach(x => x.classList.toggle('active', x === b));
      SM.$$('.pane').forEach(p => p.classList.toggle('active', p.dataset.pane === b.dataset.panel));
      panel.classList.toggle('collapsed', same);
      setTimeout(() => SM.map.invalidateSize(), 220);
      if (b.dataset.panel === 'warnings' && !S.warnings) loadWarnings();
      if (b.dataset.panel === 'chase') C.render();
    }));
    SM.$('#panelClose').addEventListener('click', () => { SM.$('#panel').classList.add('collapsed'); setTimeout(() => SM.map.invalidateSize(), 220); });

    SM.$('#lyrField').addEventListener('change', () => renderField());
    for (const id of ['#lyrParticles', '#lyrValues', '#isoSel']) SM.$(id).addEventListener('change', () => renderField(false));
    SM.$('#settingsBtn').addEventListener('click', e => {
      e.stopPropagation();
      const m = SM.$('#settingsMenu');
      m.hidden = !m.hidden;
      if (!m.hidden) SM.units.buildMenu(m);
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('#settingsMenu')) SM.$('#settingsMenu').hidden = true;
      if (!e.target.closest('#levelPop')) closeLevels();
    });
    SM.on('units', () => { buildParamList(); renderField(false); updateTimeLabel(); drawSpark(); });
    SM.$('#lyrBarbs').addEventListener('change', () => renderField(false));
    SM.$('#barbLevel').addEventListener('change', () => renderField(false));
    SM.$('#lyrRadar').addEventListener('change', e => SM.radar.setEnabled(e.target.checked));
    SM.$('#lyrLightning').addEventListener('change', e => SM.lightning.setEnabled(e.target.checked));
    SM.$('#lyrOutlook').addEventListener('change', renderOutlookLayer);
    SM.$('#lyrSat').addEventListener('change', setSat);
    SM.$('#satLayer').addEventListener('change', setSat);
    SM.$$('.op').forEach(r => r.addEventListener('input', () => {
      const o = r.value / 100;
      if (r.dataset.layer === 'field') SM.fieldLayer.setOpacity(o);
      if (r.dataset.layer === 'radar') SM.radar.setOpacity(o);
    }));
    SM.$$('#baseSeg button').forEach(b => b.addEventListener('click', () => setBase(b.dataset.base)));
    SM.$$('#warnFilter button').forEach(b => b.addEventListener('click', () => {
      S.warnFilter = b.dataset.f;
      SM.$$('#warnFilter button').forEach(x => x.classList.toggle('active', x === b));
      renderWarnings();
    }));

    SM.$('#tlSlider').addEventListener('input', e => setHour(+e.target.value));
    SM.$('#tlPlay').addEventListener('click', togglePlay);
    SM.$('#tlNow').addEventListener('click', () => setHour(nowIndex()));
    window.addEventListener('resize', SM.debounce(drawSpark, 200));

    document.addEventListener('keydown', e => {
      if (e.target.matches('input[type=search], input[type=number], select')) return;
      if (e.key === 'ArrowRight') { setHour(S.hour + 1); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { setHour(S.hour - 1); e.preventDefault(); }
      else if (e.key === ' ') { togglePlay(); e.preventDefault(); }
      else if (e.key === 'r' || e.key === 'R') SM.radar.toggle();
      else if (e.key === 'Escape') SM.drawer.close();
    });

    SM.map.on('click', e => {
      if (C.picking) {
        C.picking = false; SM.$('#pickBtn').classList.remove('on'); SM.map.getContainer().style.cursor = '';
        C.setPos(e.latlng.lat, e.latlng.lng, 'manual');
        return;
      }
      if (C.routePicking) {
        C.routePicking = false; SM.$('#routePickBtn').classList.remove('on'); SM.map.getContainer().style.cursor = '';
        C.routeTo(e.latlng.lat, e.latlng.lng);
        return;
      }
      SM.drawer.open(e.latlng.lat, e.latlng.lng);
    });
  }

  function setSat() {
    if (satLayer) { SM.map.removeLayer(satLayer); satLayer = null; }
    if (!SM.$('#lyrSat').checked) return;
    satLayer = L.tileLayer.wms('https://view.eumetsat.int/geoserver/wms', {
      layers: SM.$('#satLayer').value, format: 'image/png', transparent: true, version: '1.3.0',
      pane: 'satPane', opacity: 0.75, attribution: 'Satellite © EUMETSAT',
    }).addTo(SM.map);
  }

  function startClock() {
    const tick = () => {
      const d = new Date();
      SM.$('#clockUtc').textContent = SM.pad(d.getUTCHours()) + ':' + SM.pad(d.getUTCMinutes()) + ':' + SM.pad(d.getUTCSeconds());
    };
    tick(); setInterval(tick, 1000);
  }

  /* ======================= Boot ======================= */
  async function boot() {
    startClock();
    try {
      SM.meta = await SM.api('meta');
    } catch (e) {
      SM.toast('Cannot reach StormMap server: ' + e.message, true, 20000);
      return;
    }
    try { SM.cities = await (await fetch('data/cities.json')).json(); } catch (e) { SM.cities = []; }
    // label priority: each country's largest cities first (list is ordered by size within a country)
    const rank = {};
    SM.cityPriority = SM.cities.map(c => [c, (rank[c[1]] = (rank[c[1]] || 0) + 1)]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
    SM.$('#demoTag').hidden = !SM.meta.demo;
    const h = readHash();
    S.region = h.region && (h.region === 'ALL' || SM.meta.countries[h.region]) ? h.region : 'ALL';
    S.model = h.model && SM.meta.models[h.model] ? h.model : 'best_match';
    S.param = h.param && SM.meta.params[h.param] ? h.param : 't2';
    S.hour = h.hour != null ? +h.hour : null;

    if (window.innerWidth < 820) SM.$('#panel').classList.add('collapsed');
    initMap();
    SM.fieldLayer = new SM.FieldLayer({ opacity: 0.75 }).addTo(SM.map);
    SM.outlookLayer = new SM.FieldLayer({ opacity: 0.55 }).addTo(SM.map);
    SM.contourLayer = new SM.ContourLayer().addTo(SM.map);
    SM.barbLayer = new SM.BarbLayer().addTo(SM.map);
    SM.particleLayer = new SM.ParticleLayer().addTo(SM.map);
    SM.cityLayer = new SM.CityValueLayer().addTo(SM.map);
    loadBorders();
    buildSelectors();
    buildParamList();
    initPanels();
    initReadout();
    initSearch();
    initChase();
    SM.drawer.init();
    fitRegion();

    SM.radar.init();
    SM.lightning.init();
    SM.zones.init();
    SM.ranking.init();
    SM.tracker.init();

    // first grid load: pick the current hour once the time axis is known
    const hourGiven = S.hour != null;
    if (!hourGiven) S.hour = 0;
    SM.$('#olModel').textContent = SM.meta.models[S.model].name;
    await loadGrid();
    if (!hourGiven && S.times) { setHour(nowIndex(), false); await loadGrid(); }
    loadTimeline();
    loadNowFields();
    loadOutlook();
    loadWarnings();
    setInterval(loadNowFields, 15 * 60000);
    setInterval(loadWarnings, 10 * 60000);
    setInterval(drawSpark, 5 * 60000);
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
