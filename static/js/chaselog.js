/* StormMap — chase log: GPS track recording, field reports, GPX / GeoJSON / ESWD-style CSV export */
'use strict';

(function () {
  const KEY = 'sm-chaselog';
  const TYPES = {
    wallcloud: ['Wall cloud', '🌀'], funnel: ['Funnel cloud', '🌪'], tornado: ['Tornado', '🌪'],
    hail: ['Large hail', '🧊'], wind: ['Damaging wind', '💨'], rain: ['Heavy rain / flooding', '🌊'],
    lightning: ['Lightning damage', '⚡'], note: ['Note / photo spot', '📝'],
  };
  let log = { track: [], reports: [], recording: false };
  try { log = Object.assign(log, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* ignore */ }
  const G = SM.chaselog = { log, TYPES };

  const save = SM.debounce(() => {
    try { localStorage.setItem(KEY, JSON.stringify(log)); }
    catch (e) { log.track = log.track.slice(-5000); try { localStorage.setItem(KEY, JSON.stringify(log)); } catch (e2) { /* full */ } }
  }, 1000);

  /** Called by chase mode on every position update. */
  G.onPosition = function (lat, lon, src) {
    if (!log.recording || !/GPS/.test(src || '')) return;
    const last = log.track[log.track.length - 1];
    const now = Date.now() / 1000;
    if (last && now - last[2] < 15 && SM.geo.dist(last[0], last[1], lat, lon) < 0.1) return;
    log.track.push([+lat.toFixed(6), +lon.toFixed(6), Math.round(now)]);
    if (log.track.length > 20000) log.track.shift();
    save(); draw(); render();
  };

  function trackKm() {
    let d = 0;
    for (let i = 1; i < log.track.length; i++) d += SM.geo.dist(log.track[i - 1][0], log.track[i - 1][1], log.track[i][0], log.track[i][1]);
    return d;
  }

  G.addReport = function (type) {
    const pos = (SM.chase && SM.chase.pos) || [SM.map.getCenter().lat, SM.map.getCenter().lng];
    let value = null, unit = null;
    if (type === 'hail') { value = parseFloat(prompt('Largest hailstone diameter (cm)?', '3')); unit = 'cm'; if (!(value > 0)) return; }
    if (type === 'wind') { value = parseFloat(prompt('Estimated gust (km/h)? Leave empty if unknown.', '')) || null; unit = value ? 'km/h' : null; }
    const note = prompt('Notes (optional): direction, damage, photo number…', '') || '';
    const nearest = SM.tracker.tracks.map(t => [SM.geo.dist(pos[0], pos[1], t.cur.lat, t.cur.lon), t]).sort((a, b) => a[0] - b[0])[0];
    log.reports.push({
      type, t: Math.round(Date.now() / 1000), lat: +pos[0].toFixed(5), lon: +pos[1].toFixed(5),
      place: SM.nearestCity(pos[0], pos[1]).label, value, unit, note,
      cell: nearest && nearest[0] < 60 ? `C${nearest[1].id} (${nearest[1].cur.maxDbz} dBZ)` : null,
      posSource: SM.chase && SM.chase.pos ? (SM.chase.src || 'position') : 'map centre',
    });
    save(); draw(); render();
    SM.toast(`${TYPES[type][0]} logged at ${SM.nearestCity(pos[0], pos[1]).label}`);
  };

  /* ---------- map display ---------- */
  function draw() {
    if (!G.group) return;
    G.group.clearLayers();
    if (log.track.length > 1) L.polyline(log.track.map(p => [p[0], p[1]]), { pane: 'routePane', color: '#a78bfa', weight: 2.5, opacity: 0.85 }).addTo(G.group);
    for (const r of log.reports) {
      L.marker([r.lat, r.lon], { pane: 'routePane', icon: L.divIcon({ className: '', iconSize: [22, 22], html: `<div class="rep-icon">${TYPES[r.type][1]}</div>` }) })
        .bindTooltip(`${TYPES[r.type][0]}${r.value ? ' ' + r.value + ' ' + r.unit : ''} · ${SM.localHM(r.t)}`, { direction: 'top' }).addTo(G.group);
    }
  }

  function render() {
    const box = SM.$('#logBox');
    if (!box) return;
    const pts = log.track.length;
    box.innerHTML = `
      <div class="log-rec">
        <button class="btn ${log.recording ? 'on' : ''}" id="recBtn">${log.recording ? '■ Stop recording' : '● Record GPS track'}</button>
        <span>${pts} pts · ${trackKm().toFixed(1)} km${log.recording && !(SM.chase && SM.chase.watch != null) ? ' · <b style="color:var(--warn)">start GPS to record</b>' : ''}</span>
      </div>
      <div class="rep-btns">${Object.entries(TYPES).map(([k, [lab, ico]]) => `<button class="chip" data-rep="${k}">${ico} ${lab}</button>`).join('')}</div>
      <div class="rep-list">${log.reports.slice().reverse().slice(0, 30).map((r, i) => `
        <div class="rep"><span>${TYPES[r.type][1]} <b>${TYPES[r.type][0]}</b>${r.value ? ' ' + r.value + ' ' + r.unit : ''}</span>
        <span class="rep-meta">${new Date(r.t * 1000).toISOString().slice(5, 16).replace('T', ' ')}Z · ${SM.esc(r.place)}${r.cell ? ' · ' + r.cell : ''}</span>
        ${r.note ? `<span class="rep-note">${SM.esc(r.note)}</span>` : ''}
        <button class="icon-btn rep-del" data-del="${log.reports.length - 1 - i}" title="Delete">✕</button></div>`).join('') || '<p class="hint">No reports yet. Reports use your GPS position (or the map centre).</p>'}</div>
      <div class="log-export">
        <button class="btn" data-exp="gpx">Export GPX</button>
        <button class="btn" data-exp="geojson">GeoJSON</button>
        <button class="btn" data-exp="csv">ESWD CSV</button>
        <button class="btn" id="logClear">Clear log</button>
      </div>
      <p class="hint">Submit significant reports (tornado, hail ≥ 2 cm, damaging wind) to the European Severe Weather Database: <a href="https://eswd.eu" target="_blank" rel="noopener">eswd.eu</a>.</p>`;
    SM.$('#recBtn').onclick = () => { log.recording = !log.recording; save(); render(); if (log.recording && !(SM.chase && SM.chase.watch != null)) SM.toast('Recording armed — press "Track my GPS" to start collecting points'); };
    box.querySelectorAll('[data-rep]').forEach(b => b.onclick = () => G.addReport(b.dataset.rep));
    box.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { log.reports.splice(+b.dataset.del, 1); save(); draw(); render(); });
    box.querySelectorAll('[data-exp]').forEach(b => b.onclick = () => G.export(b.dataset.exp));
    SM.$('#logClear').onclick = () => { if (confirm('Delete the recorded track and all reports?')) { log.track = []; log.reports = []; save(); draw(); render(); } };
  }

  function download(name, mime, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const iso = t => new Date(t * 1000).toISOString();
  const xml = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  G.export = function (fmt) {
    const stamp = new Date().toISOString().slice(0, 10);
    if (fmt === 'gpx') {
      const wpts = log.reports.map(r => `  <wpt lat="${r.lat}" lon="${r.lon}"><time>${iso(r.t)}</time><name>${xml(TYPES[r.type][0])}${r.value ? ' ' + r.value + ' ' + r.unit : ''}</name><desc>${xml(r.note || '')}</desc></wpt>`).join('\n');
      const trk = log.track.map(p => `      <trkpt lat="${p[0]}" lon="${p[1]}"><time>${iso(p[2])}</time></trkpt>`).join('\n');
      download(`chase-${stamp}.gpx`, 'application/gpx+xml', `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="StormMap" xmlns="http://www.topografix.com/GPX/1/1">
${wpts}
  <trk><name>Chase ${stamp}</name><trkseg>
${trk}
  </trkseg></trk>
</gpx>`);
    } else if (fmt === 'geojson') {
      const features = log.reports.map(r => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [r.lon, r.lat] }, properties: Object.assign({ event: TYPES[r.type][0], time: iso(r.t) }, r) }));
      if (log.track.length > 1) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: log.track.map(p => [p[1], p[0]]) }, properties: { name: 'GPS track', start: iso(log.track[0][2]), end: iso(log.track[log.track.length - 1][2]) } });
      download(`chase-${stamp}.geojson`, 'application/geo+json', JSON.stringify({ type: 'FeatureCollection', features }, null, 1));
    } else {
      const esc = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
      const eswd = { tornado: 'TORNADO', funnel: 'FUNNEL CLOUD', hail: 'LARGE HAIL', wind: 'DAMAGING WIND', rain: 'HEAVY RAIN', lightning: 'LIGHTNING', wallcloud: 'OTHER (wall cloud)', note: 'OTHER' };
      const rows = [['eswd_type', 'time_utc', 'latitude', 'longitude', 'place', 'hail_max_diameter_cm', 'wind_speed_kmh', 'storm_cell', 'position_source', 'notes']]
        .concat(log.reports.map(r => [eswd[r.type], iso(r.t).slice(0, 16).replace('T', ' '), r.lat, r.lon, r.place,
          r.type === 'hail' ? r.value : '', r.type === 'wind' ? r.value || '' : '', r.cell || '', r.posSource, r.note]));
      download(`chase-reports-${stamp}.csv`, 'text/csv', rows.map(r => r.map(esc).join(',')).join('\n'));
    }
  };

  G.init = function () {
    G.group = L.layerGroup().addTo(SM.map);
    draw(); render();
  };
})();
