/* StormMap — point analysis drawer: sounding, parameter series, model comparison, ensembles */
'use strict';

(function () {
  const D = SM.drawer = { lat: null, lon: null, data: null, parcel: 'ml', tab: 'forecast', charts: {}, mgVar: 'cape', ensVar: 'cape', ensModel: 'icon_seamless', mgModels: null };
  let marker = null;
  const req = { snd: 0, mg: 0, ens: 0, fc: 0 };

  const MODEL_COLORS = ['#22d3ee', '#f43f5e', '#fbbf24', '#34d399', '#a78bfa', '#fb923c', '#e879f9', '#60a5fa', '#f8fafc', '#84cc16'];

  function cls(v, hi, xhi, ext) {
    if (v == null) return '';
    if (ext != null && v >= ext) return 'v-ext';
    if (v >= xhi) return 'v-xhi';
    if (v >= hi) return 'v-hi';
    return '';
  }
  const f0 = v => SM.fmt(v, 0), f1 = v => SM.fmt(v, 1), f2 = v => SM.fmt(v, 2);
  const kt = v => v == null ? '—' : Math.round(v * 1.943844) + '';

  function table(title, head, rows) {
    return `<div class="tbl"><h4>${title}</h4><table>${head ? '<tr>' + head.map(h => `<th>${h}</th>`).join('') + '</tr>' : ''}${rows.map(r => '<tr>' + r.map((c, i) => i === 0 ? `<td>${c}</td>` : `<td class="${c[1] || ''}">${c[0]}</td>`).join('') + '</tr>').join('')}</table></div>`;
  }

  function renderTable(d) {
    const x = d.indices, m = x.motions || {};
    const par = [
      ['CAPE J/kg', [f0(x.sbcape), cls(x.sbcape, 1000, 2500, 4000)], [f0(x.mlcape), cls(x.mlcape, 1000, 2500, 4000)], [f0(x.mucape), cls(x.mucape, 1000, 2500, 4000)]],
      ['CIN J/kg', [f0(x.sbcin)], [f0(x.mlcin)], [f0(x.mucin)]],
      ['LCL m', [f0(x.sblcl)], [f0(x.mllcl)], [f0(x.mulcl)]],
      ['LFC m', [f0(x.sblfc)], [f0(x.mllfc)], [f0(x.mulfc)]],
      ['EL m', [f0(x.sbel)], [f0(x.mlel)], [f0(x.muel)]],
      ['LI °C', [f1(x.sbli)], [f1(x.mlli)], [f1(x.muli)]],
    ];
    const kin = [
      ['0–500 m', [f0(x.srh500), cls(x.srh500, 100, 250)], ['—']],
      ['0–1 km', [f0(x.srh1), cls(x.srh1, 150, 300)], [kt(x.shr1), cls(x.shr1, 10, 15)]],
      ['0–3 km', [f0(x.srh3), cls(x.srh3, 200, 400)], [kt(x.shr3), cls(x.shr3, 15, 22)]],
      ['0–6 km', ['—'], [kt(x.shr6), cls(x.shr6, 20, 28)]],
      ['0–8 km', ['—'], [kt(x.shr8), cls(x.shr8, 25, 35)]],
      ['Effective', [f0(x.esrh), cls(x.esrh, 150, 300)], [kt(x.ebwd), cls(x.ebwd, 20, 28)]],
    ];
    const vec = v => v ? `${v.dir}°/${Math.round(v.spd * 1.943844)} kt` : '—';
    const mot = [
      ['Bunkers RM', [vec(m.bunkers_rm)]], ['Bunkers LM', [vec(m.bunkers_lm)]], ['Mean wind 0–6', [vec(m.mean_0_6)]],
      ['Corfidi down', [vec(m.corfidi_down)]], ['Corfidi up', [vec(m.corfidi_up)]],
    ];
    const thermo = [
      ['LR 0–3 km °C/km', [f1(x.lr03), cls(x.lr03, 7.5, 8.5)]], ['LR 700–500 °C/km', [f1(x.lr75), cls(x.lr75, 7, 8)]],
      ['PWAT mm', [f1(x.pwat), cls(x.pwat, 30, 40)]], ['DCAPE J/kg', [f0(x.dcape), cls(x.dcape, 800, 1200)]],
      ['3CAPE (ML) J/kg', [f0(x.ml3cape), cls(x.ml3cape, 75, 150)]], ['K-index', [f1(x.k_index), cls(x.k_index, 30, 36)]],
      ['Total totals', [f1(x.total_totals), cls(x.total_totals, 50, 55)]], ['Showalter', [f1(x.showalter)]],
      ['Freezing lvl m', [f0(x.fzl)]], ['WBZ m', [f0(x.wbz)]],
    ];
    const comp = [
      ['STP (eff)', [f2(x.stp_eff), cls(x.stp_eff, 1, 3, 6)]], ['STP (fixed)', [f2(x.stp_fixed), cls(x.stp_fixed, 1, 3, 6)]],
      ['SCP', [f2(x.scp), cls(x.scp, 2, 8, 16)]], ['SHIP', [f2(x.ship), cls(x.ship, 1, 2, 3)]],
      ['DCP', [f2(x.dcp), cls(x.dcp, 2, 4)]], ['EHI 0–1', [f2(x.ehi1), cls(x.ehi1, 1, 2.5)]], ['EHI 0–3', [f2(x.ehi3), cls(x.ehi3, 1.5, 3)]],
    ];
    SM.$('#sndTable').innerHTML =
      table('Parcels', ['', 'SB', 'ML', 'MU'], par) +
      table('Kinematics', ['', 'SRH m²/s²', 'Shear kt'], kin) +
      table('Composites', null, comp) +
      table('Thermodynamics', null, thermo) +
      table('Storm motion', null, mot);
    const hz = x.hazard;
    const hzCol = { 'PDS TOR': '#e879f9', TOR: '#f43f5e', 'MRGL TOR': '#fb7185', SVR: '#fb923c', 'MRGL SVR': '#fbbf24', 'FLASH FLOOD': '#34d399', TSTM: '#84cc16', NONE: '#8b93a7' }[hz] || '#e7eaf0';
    SM.$('#hazardBox').innerHTML = `<div style="font-size:10.5px;color:var(--dim);letter-spacing:.1em;text-transform:uppercase">Possible hazard type</div>
      <div class="hz-label" style="color:${hzCol}">${SM.esc(hz)}</div><div class="hz-mode">${SM.esc(x.storm_mode)}</div>`;
  }

  function drawSounding() {
    const d = D.data;
    if (!d) return;
    SM.drawSkewT(SM.$('#skewt'), d, D.parcel);
    SM.drawHodograph(SM.$('#hodo'), d);
    renderTable(d);
    SM.$('#sndTime').textContent = `${SM.esc(SM.meta.models[d.model].name)} · ${SM.utcLabel(d.times[d.hour])}`;
  }

  function timeLabels(times) { return times.map(t => SM.utcLabel(t)); }

  function nowLine(times) {
    const now = Date.now() / 1000;
    let idx = times.findIndex(t => t > now);
    if (idx < 0) idx = times.length - 1;
    return idx;
  }

  const verticalLine = {
    id: 'vline',
    afterDatasetsDraw(chart, args, opts) {
      if (opts.index == null) return;
      const x = chart.scales.x.getPixelForValue(opts.index);
      const { top, bottom } = chart.chartArea;
      const ctx = chart.ctx;
      ctx.save(); ctx.strokeStyle = opts.color || 'rgba(34,211,238,.7)'; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke(); ctx.restore();
    },
  };

  function chart(id, config) {
    if (D.charts[id]) D.charts[id].destroy();
    config.plugins = [verticalLine];
    D.charts[id] = new Chart(SM.$('#' + id), config);
    return D.charts[id];
  }

  function drawSeries() {
    const d = D.data;
    if (!d) return;
    const s = d.series, labels = timeLabels(d.times);
    const g = k => s.map(r => r ? r[k] : null);
    chart('seriesChart', {
      type: 'line',
      data: { labels, datasets: [
        { label: 'MLCAPE', data: g('mlcape'), borderColor: '#f43f5e', backgroundColor: 'rgba(244,63,94,.12)', fill: true, pointRadius: 0, tension: .3 },
        { label: 'MUCAPE', data: g('mucape'), borderColor: '#fb923c', pointRadius: 0, tension: .3, borderDash: [4, 3] },
        { label: 'MLCIN', data: g('mlcin'), borderColor: '#60a5fa', pointRadius: 0, tension: .3 },
        { label: 'Eff. shear (m/s)', data: g('ebwd'), borderColor: '#a78bfa', pointRadius: 0, yAxisID: 'y2' },
        { label: '0–6 km shear (m/s)', data: g('shr6'), borderColor: '#34d399', pointRadius: 0, yAxisID: 'y2', borderDash: [4, 3] },
      ] },
      options: { interaction: { mode: 'index', intersect: false }, plugins: { vline: { index: d.hour }, title: { display: true, text: 'Instability & shear' } },
        scales: { x: { ticks: { maxTicksLimit: 12 } }, y: { title: { display: true, text: 'J/kg' } }, y2: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'm/s' } } } },
    });
    chart('seriesChart2', {
      type: 'line',
      data: { labels, datasets: [
        { label: 'STP (eff)', data: g('stp_eff'), borderColor: '#e879f9', pointRadius: 0, tension: .3 },
        { label: 'SCP', data: g('scp'), borderColor: '#fbbf24', pointRadius: 0, tension: .3 },
        { label: 'SHIP', data: g('ship'), borderColor: '#22d3ee', pointRadius: 0, tension: .3 },
        { label: 'ESRH (m²/s²)', data: g('esrh'), borderColor: '#f43f5e', pointRadius: 0, yAxisID: 'y2', borderDash: [4, 3] },
        { label: 'SRH 0–1 km', data: g('srh1'), borderColor: '#fb7185', pointRadius: 0, yAxisID: 'y2', borderDash: [2, 2] },
      ] },
      options: { interaction: { mode: 'index', intersect: false }, plugins: { vline: { index: d.hour }, title: { display: true, text: 'Composite parameters & helicity' } },
        scales: { x: { ticks: { maxTicksLimit: 12 } }, y: { min: 0 }, y2: { position: 'right', grid: { drawOnChartArea: false } } } },
    });
  }

  function mgPicks() {
    const box = SM.$('#mgPicks');
    if (!D.mgModels) D.mgModels = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless', 'gem_global', 'ukmo_global_deterministic_10km'];
    box.innerHTML = '';
    for (const [id, m] of Object.entries(SM.meta.models)) {
      if (id === 'best_match') continue;
      const b = SM.el('button', { class: 'chip' + (D.mgModels.includes(id) ? ' active' : ''), title: `${m.name} (${m.res})` }, SM.esc(m.name.replace('Météo-France ', 'MF ')));
      b.addEventListener('click', () => {
        if (D.mgModels.includes(id)) D.mgModels = D.mgModels.filter(x => x !== id);
        else if (D.mgModels.length < 8) D.mgModels.push(id);
        mgPicks(); loadModels();
      });
      box.appendChild(b);
    }
  }

  async function loadModels() {
    if (D.lat == null || !D.mgModels.length) return;
    const id = ++req.mg;
    try {
      SM.loading('mg', 'Loading multi-model comparison…');
      const r = await SM.api('meteogram', { models: D.mgModels.join(','), lat: D.lat, lon: D.lon });
      if (id !== req.mg) return;
      D.mg = r;
      drawModels();
    } catch (e) { SM.toast('Model comparison: ' + e.message, true); } finally { SM.loading('mg'); }
  }

  function drawModels() {
    const r = D.mg;
    if (!r) return;
    const v = D.mgVar;
    const units = { cape: 'J/kg', precipitation: 'mm/h', wind_gusts_10m: 'm/s', temperature_2m: '°C', dew_point_2m: '°C', wind_speed_500hPa: 'm/s', lifted_index: '°C' };
    const ds = r.models.map((m, i) => ({
      label: SM.meta.models[m] ? SM.meta.models[m].name : m,
      data: (r.series[m] && r.series[m][v]) || [],
      borderColor: MODEL_COLORS[i % MODEL_COLORS.length], backgroundColor: MODEL_COLORS[i % MODEL_COLORS.length],
      pointRadius: 0, tension: .25, borderWidth: 1.8, spanGaps: true,
    }));
    chart('mgChart', {
      type: v === 'precipitation' ? 'bar' : 'line',
      data: { labels: timeLabels(r.times), datasets: ds },
      options: { interaction: { mode: 'index', intersect: false }, plugins: { vline: { index: nowLine(r.times) }, title: { display: true, text: `${v.replace(/_/g, ' ')} (${units[v] || ''}) · ${r.place ? r.place.label : ''}` } },
        scales: { x: { stacked: false, ticks: { maxTicksLimit: 14 } } } },
    });
  }

  function ensButtons() {
    const box = SM.$('#ensModel');
    box.innerHTML = '';
    for (const [id, name] of Object.entries(SM.meta.ensembles)) {
      const b = SM.el('button', { class: id === D.ensModel ? 'active' : '' }, SM.esc(name));
      b.addEventListener('click', () => { D.ensModel = id; ensButtons(); loadEnsemble(); });
      box.appendChild(b);
    }
  }

  async function loadEnsemble() {
    if (D.lat == null) return;
    const id = ++req.ens;
    try {
      SM.loading('ens', 'Loading ensemble…');
      const r = await SM.api('ensemble', { model: D.ensModel, lat: D.lat, lon: D.lon });
      if (id !== req.ens) return;
      D.ens = r;
      drawEnsemble();
    } catch (e) { SM.toast('Ensemble: ' + e.message, true); D.ens = null; drawEnsemble(); } finally { SM.loading('ens'); }
  }

  function drawEnsemble() {
    const r = D.ens;
    const v = D.ensVar;
    const st = r && r.vars[v];
    if (!st) {
      if (D.charts.ensChart) D.charts.ensChart.destroy();
      if (D.charts.ensProb) D.charts.ensProb.destroy();
      delete D.charts.ensChart; delete D.charts.ensProb;
      return;
    }
    const labels = timeLabels(r.times);
    chart('ensChart', {
      type: 'line',
      data: { labels, datasets: [
        { label: 'P90', data: st.p90, borderColor: 'transparent', backgroundColor: 'rgba(34,211,238,.12)', fill: '+4', pointRadius: 0 },
        { label: 'P75', data: st.p75, borderColor: 'transparent', backgroundColor: 'rgba(34,211,238,.22)', fill: '+2', pointRadius: 0 },
        { label: 'Median', data: st.p50, borderColor: '#22d3ee', borderWidth: 2, pointRadius: 0 },
        { label: 'P25', data: st.p25, borderColor: 'transparent', pointRadius: 0 },
        { label: 'P10', data: st.p10, borderColor: 'transparent', pointRadius: 0 },
        { label: 'Max', data: st.max, borderColor: '#f43f5e', borderDash: [3, 3], borderWidth: 1, pointRadius: 0 },
      ] },
      options: { interaction: { mode: 'index', intersect: false }, plugins: { vline: { index: nowLine(r.times) }, title: { display: true, text: `${r.name} · ${st.members} members · ${v.replace(/_/g, ' ')}` }, legend: { labels: { filter: i => ['Median', 'Max', 'P90', 'P75'].includes(i.text) } } },
        scales: { x: { ticks: { maxTicksLimit: 14 } } } },
    });
    const probCols = ['#fbbf24', '#fb923c', '#f43f5e'];
    chart('ensProb', {
      type: 'line',
      data: { labels, datasets: Object.entries(st.prob).map(([t, arr], i) => ({ label: `P(≥ ${t})`, data: arr, borderColor: probCols[i % 3], backgroundColor: probCols[i % 3] + '22', fill: true, pointRadius: 0, tension: .3 })) },
      options: { interaction: { mode: 'index', intersect: false }, plugins: { vline: { index: nowLine(r.times) }, title: { display: true, text: 'Exceedance probability (%)' } }, scales: { y: { min: 0, max: 100 }, x: { ticks: { maxTicksLimit: 14 } } } },
    });
  }

  /* ---------------- Point forecast (Ventusky-style) ---------------- */
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function locDate(t) {
    const off = SM.units.cfg.time === 'utc' ? 0 : (D.fc ? D.fc.utc_offset : 0);
    return new Date((t + off) * 1000); // read with UTC getters
  }
  const locHM = t => { const d = locDate(t); return SM.pad(d.getUTCHours()) + ':00'; };
  const arrow = dir => `<i style="transform:rotate(${(dir + 180) % 360}deg)">↑</i>`;

  async function loadForecast() {
    if (D.lat == null) return;
    const id = ++req.fc;
    SM.loading('fc', 'Loading point forecast…');
    try {
      let r;
      try { r = await SM.api('forecast', { model: SM.state.model, lat: D.lat, lon: D.lon }); }
      catch (e) { r = await SM.api('forecast', { model: 'best_match', lat: D.lat, lon: D.lon }); }
      if (id !== req.fc) return;
      D.fc = r;
      if (D.tab === 'forecast') drawForecast();
    } catch (e) {
      SM.$('#fcNow').innerHTML = `<p class="hint">Forecast unavailable: ${SM.esc(e.message)}</p>`;
    } finally { SM.loading('fc'); }
  }

  function drawForecast() {
    const f = D.fc;
    if (!f) return;
    const h = f.hourly, d = f.daily, U = SM.units;
    const now = Date.now() / 1000;
    let i0 = h.time.findIndex(t => t > now - 1800);
    if (i0 < 0) i0 = 0;
    const g = (k, i) => (h[k] ? h[k][i] : null);
    const code = g('weather_code', i0), day = g('is_day', i0) !== 0;
    const sr = d.sunrise && d.sunrise[0], ss = d.sunset && d.sunset[0];
    const fmtSun = t => (typeof t === 'number' ? locHM(t).replace(':00', ':' + SM.pad(locDate(t).getUTCMinutes())) : (t ? String(t).slice(11, 16) : '—'));
    SM.$('#fcNow').innerHTML = `
      <div class="ico">${SM.weatherIcon(code, day)}</div>
      <div>
        <div class="big">${U.fmt('temp', g('temperature_2m', i0))}<small>${U.label('temp')}</small></div>
        <div class="desc">${SM.esc(SM.weatherText(code))}</div>
        <div class="feels">Feels like ${U.fmt('temp', g('apparent_temperature', i0), true)} · ${SM.esc(f.timezone || '')}</div>
      </div>
      <div class="facts">
        <div>Wind<b>${arrow(g('wind_direction_10m', i0) || 0)} ${U.fmt('wind', g('wind_speed_10m', i0), true)}</b></div>
        <div>Gusts<b>${U.fmt('wind', g('wind_gusts_10m', i0), true)}</b></div>
        <div>Humidity<b>${SM.fmt(g('relative_humidity_2m', i0))} %</b></div>
        <div>Pressure<b>${U.fmt('pressure', g('pressure_msl', i0), true)}</b></div>
        <div>Dew point<b>${U.fmt('temp', g('dew_point_2m', i0), true)}</b></div>
        <div>CAPE<b>${SM.fmt(g('cape', i0))} J/kg</b></div>
        <div>Rain chance<b>${g('precipitation_probability', i0) == null ? '—' : g('precipitation_probability', i0) + ' %'}</b></div>
        <div>Sunrise<b>${fmtSun(sr)}</b></div>
        <div>Sunset<b>${fmtSun(ss)}</b></div>
      </div>`;

    // 7-day cards
    const days = SM.$('#fcDays');
    days.innerHTML = '';
    (d.time || []).forEach((t, k) => {
      const dt = locDate(typeof t === 'number' ? t : Date.parse(t) / 1000);
      const wc = d.weather_code[k];
      const el = SM.el('div', { class: 'fc-day' + (k === D.fcDay ? ' on' : '') }, `
        <div class="d">${k === 0 ? 'Today' : DAYS[dt.getUTCDay()] + ' ' + dt.getUTCDate()}</div>
        <div class="ico">${SM.weatherIcon(wc, true)}</div>
        <div class="t">${U.fmt('temp', d.temperature_2m_max[k])}° <span>${U.fmt('temp', d.temperature_2m_min[k])}°</span></div>
        <div class="p">${d.precipitation_sum[k] ? U.fmt('precip', d.precipitation_sum[k]) + (U.cfg.precip === 'in' ? ' in' : ' mm') : '&nbsp;'}${d.precipitation_probability_max && d.precipitation_probability_max[k] != null ? ' · ' + d.precipitation_probability_max[k] + '%' : ''}</div>
        <div class="g">${d.wind_gusts_10m_max ? U.fmt('wind', d.wind_gusts_10m_max[k], true) : ''}</div>
        ${wc >= 95 ? '<div class="ts">⚡ STORMS</div>' : ''}`);
      el.addEventListener('click', () => {
        D.fcDay = k;
        SM.$$('.fc-day', days).forEach((x, j) => x.classList.toggle('on', j === k));
        const target = SM.$(`.fc-h[data-day="${k}"]`);
        if (target) target.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
      });
      days.appendChild(el);
    });

    // hourly strip: next 72 h
    const strip = SM.$('#fcHours');
    strip.innerHTML = '';
    const dayOf = t => { const x = locDate(t); return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()); };
    const day0 = dayOf(h.time[i0]);
    for (let i = i0; i < Math.min(h.time.length, i0 + 72); i++) {
      const t = h.time[i];
      const dayIdx = Math.round((dayOf(t) - day0) / 86400000);
      const isMidnight = locDate(t).getUTCHours() === 0;
      const pr = g('precipitation', i), cape = g('cape', i);
      const storm = (g('weather_code', i) >= 95) || (cape >= 800 && pr >= 0.5);
      strip.appendChild(SM.el('div', { class: 'fc-h' + (g('is_day', i) === 0 ? ' night' : '') + (isMidnight ? ' day0' : ''), 'data-day': isMidnight || i === i0 ? dayIdx : '' }, `
        <div class="hh">${isMidnight ? DAYS[locDate(t).getUTCDay()] : locHM(t)}</div>
        <div class="ico">${SM.weatherIcon(g('weather_code', i), g('is_day', i) !== 0)}</div>
        <div class="tt">${U.fmt('temp', g('temperature_2m', i))}°</div>
        <div class="pp">${pr >= 0.1 ? U.fmt('precip', pr) : ''}</div>
        <div class="ww">${arrow(g('wind_direction_10m', i) || 0)}${U.fmt('wind', g('wind_speed_10m', i))}</div>
        <div class="cc">${storm ? '⚡' + (cape >= 100 ? Math.round(cape) : '') : ''}</div>`));
    }

    // meteogram
    const idx = [];
    for (let i = i0; i < Math.min(h.time.length, i0 + 120); i++) idx.push(i);
    const labels = idx.map(i => { const x = locDate(h.time[i]); return x.getUTCHours() === 0 ? DAYS[x.getUTCDay()] + ' ' + x.getUTCDate() : SM.pad(x.getUTCHours()) + 'h'; });
    chart('fcChart', {
      type: 'bar',
      data: { labels, datasets: [
        { type: 'line', label: `Temperature ${U.label('temp')}`, data: idx.map(i => U.conv('temp', g('temperature_2m', i))), borderColor: '#f97316', backgroundColor: 'rgba(249,115,22,.08)', fill: true, pointRadius: 0, tension: .35, yAxisID: 'y', borderWidth: 2.2 },
        { type: 'line', label: `Dew point ${U.label('temp')}`, data: idx.map(i => U.conv('temp', g('dew_point_2m', i))), borderColor: '#34d399', pointRadius: 0, tension: .35, yAxisID: 'y', borderDash: [4, 3], borderWidth: 1.5 },
        { type: 'line', label: `Gusts ${U.label('wind')}`, data: idx.map(i => U.conv('wind', g('wind_gusts_10m', i))), borderColor: 'rgba(203,213,225,.7)', pointRadius: 0, tension: .35, yAxisID: 'y2', borderWidth: 1.2 },
        { type: 'bar', label: `Precipitation ${U.cfg.precip === 'in' ? 'in' : 'mm'}`, data: idx.map(i => U.conv('precip', g('precipitation', i))), backgroundColor: 'rgba(94,168,255,.75)', yAxisID: 'y1', barPercentage: 1, categoryPercentage: .9 },
      ] },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: { title: { display: true, text: `${SM.esc(f.place ? f.place.label : '')} · ${SM.meta.models[f.model] ? SM.meta.models[f.model].name : f.model}` } },
        scales: {
          x: { ticks: { maxTicksLimit: 16, autoSkip: true } },
          y: { position: 'left', title: { display: true, text: U.label('temp') } },
          y1: { position: 'right', min: 0, suggestedMax: U.conv('precip', 4), grid: { drawOnChartArea: false }, title: { display: true, text: 'precip' } },
          y2: { display: false, min: 0 },
        },
      },
    });
  }

  D.open = async function (lat, lon, opts = {}) {
    D.lat = +lat.toFixed(3); D.lon = +lon.toFixed(3);
    SM.$('#drawer').hidden = false;
    const place = SM.nearestCity(D.lat, D.lon);
    SM.$('#dwTitle').textContent = place.label;
    SM.$('#dwSub').textContent = `${D.lat.toFixed(2)}°N ${D.lon.toFixed(2)}°E`;
    if (marker) marker.setLatLng([D.lat, D.lon]); else marker = L.circleMarker([D.lat, D.lon], { radius: 7, color: '#22d3ee', weight: 2, fillOpacity: 0.15, pane: 'cellPane' }).addTo(SM.map);
    if (opts.hour != null) SM.state.hour = opts.hour;
    D.fc = null; D.fcDay = 0;
    if (opts.tab) selectTab(opts.tab);
    loadForecast();
    await D.loadSounding();
    if (D.tab === 'models') loadModels();
    if (D.tab === 'ensemble') loadEnsemble();
  };

  D.loadSounding = async function () {
    if (D.lat == null) return;
    const id = ++req.snd;
    const model = SM.state.model;
    try {
      SM.loading('snd', 'Computing sounding analysis…');
      const d = await SM.api('sounding', { model, lat: D.lat, lon: D.lon, hour: SM.state.hour });
      if (id !== req.snd) return;
      D.data = d;
      SM.$('#dwSub').textContent = `${D.lat.toFixed(2)}°N ${D.lon.toFixed(2)}°E · ${Math.round(d.elevation || 0)} m · ${d.country || ''} · ${SM.meta.models[model].name}`;
      if (D.tab === 'sounding') drawSounding();
      if (D.tab === 'series') drawSeries();
    } catch (e) {
      SM.toast('Sounding: ' + e.message, true);
    } finally { SM.loading('snd'); }
  };

  D.close = function () {
    SM.$('#drawer').hidden = true;
    if (marker) { SM.map.removeLayer(marker); marker = null; }
    D.lat = null;
  };

  D.isOpen = () => !SM.$('#drawer').hidden;

  D.init = function () {
    SM.$('#dwClose').addEventListener('click', D.close);
    SM.$$('#dwTabs button').forEach(b => b.addEventListener('click', () => selectTab(b.dataset.tab)));
    SM.$$('#parcelSeg button').forEach(b => b.addEventListener('click', () => {
      D.parcel = b.dataset.parcel;
      SM.$$('#parcelSeg button').forEach(x => x.classList.toggle('active', x === b));
      drawSounding();
    }));
    SM.$$('#mgVar button').forEach(b => b.addEventListener('click', () => {
      D.mgVar = b.dataset.v;
      SM.$$('#mgVar button').forEach(x => x.classList.toggle('active', x === b));
      drawModels();
    }));
    SM.$$('#ensVar button').forEach(b => b.addEventListener('click', () => {
      D.ensVar = b.dataset.v;
      SM.$$('#ensVar button').forEach(x => x.classList.toggle('active', x === b));
      drawEnsemble();
    }));
    window.addEventListener('resize', SM.debounce(() => { if (D.isOpen() && D.tab === 'sounding') drawSounding(); }, 200));
    SM.on('hour', () => { if (D.isOpen()) D.loadSounding(); });
    SM.on('model', () => { if (D.isOpen()) { D.loadSounding(); loadForecast(); } });
    SM.on('units', () => { if (D.isOpen() && D.tab === 'forecast') drawForecast(); });
  };

  function selectTab(tab) {
    D.tab = tab;
    SM.$$('#dwTabs button').forEach(x => x.classList.toggle('active', x.dataset.tab === tab));
    SM.$$('#drawer .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === D.tab));
    if (D.tab === 'forecast') { if (D.fc) drawForecast(); else loadForecast(); }
    if (D.tab === 'sounding') drawSounding();
    if (D.tab === 'series') drawSeries();
    if (D.tab === 'models') { mgPicks(); if (!D.mg || D.mg.lat !== D.lat || D.mg.lon !== D.lon) loadModels(); else drawModels(); }
    if (D.tab === 'ensemble') { ensButtons(); if (!D.ens || D.ens.lat !== D.lat || D.ens.lon !== D.lon) loadEnsemble(); else drawEnsemble(); }
  }
})();
