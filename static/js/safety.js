/* StormMap — war-zone safety layers: air-raid alerts (alerts.in.ua) and mine-contamination areas */
'use strict';

(function () {
  const A = SM.air = { data: null, oblasts: null, layer: null, enabled: true };
  const H = SM.mines = { data: null, layer: null, enabled: true };

  /* ---------- geometry helpers ---------- */
  function inRing(lon, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi + 1e-15) + xi) inside = !inside;
    }
    return inside;
  }
  function inGeometry(lat, lon, g) {
    if (!g) return false;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    return polys.some(p => inRing(lon, lat, p[0]) && !p.slice(1).some(h => inRing(lon, lat, h)));
  }
  SM.inGeometry = inGeometry;

  /* ---------- air-raid alerts ---------- */
  A.oblastAt = function (lat, lon) {
    const o = A.oblasts;
    if (!o) return null;
    if (o.geojson) {
      for (const f of o.geojson.features) if (inGeometry(lat, lon, f.geometry)) return f.properties.key;
      return null;
    }
    // fallback without boundaries: nearest oblast centre within 110 km (approximate)
    let best = null, bd = 110;
    for (const c of o.centres) { const d = SM.geo.dist(lat, lon, c.lat, c.lon); if (d < bd) { bd = d; best = c.key; } }
    return best;
  };
  A.statusAt = function (lat, lon) {
    const k = A.oblastAt(lat, lon);
    if (!k || !A.data || !A.data.oblasts[k]) return null;
    return Object.assign({ key: k, name: A.name(k) }, A.data.oblasts[k]);
  };
  A.name = function (k) {
    const c = A.oblasts && A.oblasts.centres.find(x => x.key === k);
    return c ? (SM.i18n && SM.i18n.lang === 'uk' ? c.uk : c.en) : k;
  };
  /** Oblasts under alert that a polyline [[lat,lon],…] passes through. */
  A.alongRoute = function (coords) {
    const hit = new Map();
    const step = Math.max(1, Math.floor(coords.length / 150));
    for (let i = 0; i < coords.length; i += step) {
      const s = A.statusAt(coords[i][0], coords[i][1]);
      if (s) hit.set(s.key, s);
    }
    return [...hit.values()];
  };

  function style(key) {
    const s = A.data && A.data.oblasts[key];
    if (!s) return { color: '#3a3a3a', weight: 0.6, opacity: 0.5, fill: false };
    if (s.full) return { color: '#ff2a2a', weight: 2, opacity: 0.95, fillColor: '#ff2a2a', fillOpacity: 0.16, dashArray: null };
    return { color: '#ff8a1a', weight: 1.6, opacity: 0.9, fillColor: '#ff8a1a', fillOpacity: 0.07, dashArray: '5 4' };
  }

  function drawAlerts() {
    if (A.layer) SM.map.removeLayer(A.layer);
    A.layer = null;
    if (!A.enabled || !A.oblasts || !A.data) return;
    if (A.oblasts.geojson) {
      A.layer = L.geoJSON(A.oblasts.geojson, { pane: 'zonePane', interactive: false, style: f => style(f.properties.key) });
    } else {
      A.layer = L.layerGroup();
      for (const c of A.oblasts.centres) {
        const s = A.data.oblasts[c.key];
        if (!s) continue;
        L.circleMarker([c.lat, c.lon], { pane: 'zonePane', radius: 16, color: s.full ? '#ff2a2a' : '#ff8a1a', weight: 2, fillOpacity: 0.2, interactive: false }).addTo(A.layer);
      }
    }
    A.layer.addTo(SM.map);
  }

  function renderAlerts() {
    const box = SM.$('#airList');
    const d = A.data;
    if (!box || !d) return;
    const n = Object.values(d.oblasts || {}).filter(s => s.full).length, p = Object.values(d.oblasts || {}).filter(s => !s.full).length;
    SM.status('stAir', d.status === 'ok' || d.status === 'demo' ? (n ? 'err' : 'ok') : null,
      d.status === 'disabled' ? 'Air-raid alerts off (no alerts.in.ua token)' : `Air-raid alerts: ${n} oblast(s), ${p} partial`);
    if (d.status === 'disabled') { box.innerHTML = '<p class="hint">Live air-raid alerts need a free alerts.in.ua token (ALERTS_IN_UA_TOKEN).</p>'; return; }
    if (d.status === 'error') { box.innerHTML = `<p class="hint">Air-raid alerts unavailable: ${SM.esc(d.note || '')}</p>`; return; }
    const rows = Object.entries(d.oblasts).sort((a, b) => (b[1].full - a[1].full));
    box.innerHTML = rows.length ? rows.map(([k, s]) => `
      <div class="air-row ${s.full ? 'full' : 'partial'}"><b>${SM.esc(A.name(k))}</b>
      <span>${s.full ? 'Whole oblast' : 'Partial: ' + SM.esc(s.partial.join(', '))}</span></div>`).join('')
      : '<p class="hint">No active air-raid alerts.</p>';
    box.insertAdjacentHTML('beforeend', `<div class="air-meta">${SM.esc(d.source)} · updated ${SM.localHM(d.updated)}${d.status === 'demo' ? ' · DEMO DATA' : ''}</div>`);
  }

  A.load = async function () {
    try {
      if (!A.oblasts) A.oblasts = await SM.api('oblasts');
      A.data = await SM.api('airalerts');
      drawAlerts(); renderAlerts();
      SM.emit('airalerts');
    } catch (e) { SM.status('stAir', 'err', 'Air-raid alerts: ' + e.message); }
  };
  A.setEnabled = on => { A.enabled = on; drawAlerts(); };

  /* ---------- mine / UXO contamination ---------- */
  H.at = function (lat, lon) {
    if (!H.data || !H.data.loaded) return false;
    return H.data.geojson.features.some(f => inGeometry(lat, lon, f.geometry));
  };
  H.alongRoute = function (coords) {
    if (!H.data || !H.data.loaded) return 0;
    let n = 0;
    const step = Math.max(1, Math.floor(coords.length / 300));
    for (let i = 0; i < coords.length; i += step) if (H.at(coords[i][0], coords[i][1])) n++;
    return n;
  };
  H.load = async function () {
    try {
      H.data = await SM.api('hazards');
      if (H.layer) SM.map.removeLayer(H.layer);
      if (H.data.loaded && H.enabled) {
        H.layer = L.geoJSON(H.data.geojson, {
          pane: 'zonePane', interactive: false,
          style: () => ({ color: '#b45309', weight: 1, opacity: 0.9, fillColor: '#b45309', fillOpacity: 0.18, dashArray: '2 3' }),
        }).addTo(SM.map);
      }
      const box = SM.$('#mineInfo');
      if (box) box.innerHTML = H.data.loaded
        ? `<div class="zone-meta"><div><span>Mine-contamination map</span><b>${SM.esc(H.data.source)} · ${H.data.count} areas</b></div></div>`
        : `<p class="hint">${SM.esc(H.data.note)}</p>`;
    } catch (e) { /* optional layer */ }
  };
  H.setEnabled = on => { H.enabled = on; H.load(); };

  /** Safety summary for a route geometry (HTML, empty if nothing to report). */
  SM.routeSafetyHTML = function (coords) {
    let html = '';
    const air = A.alongRoute(coords);
    if (air.length) html += `<div class="danger-banner">🚨 Route crosses ${air.map(s => SM.esc(s.name) + (s.full ? '' : ' (partial)')).join(', ')} under an ACTIVE AIR-RAID ALERT. Do not travel during the alert — shelter and wait for the all-clear.</div>`;
    const mines = H.alongRoute(coords);
    if (mines) html += '<div class="danger-banner">⚠ Route passes through potentially mine-contaminated areas. Stay on hard-surface roads; never pull onto shoulders, fields, tree lines or tracks.</div>';
    return html;
  };

  /** Banners for the chaser position. */
  SM.positionSafetyHTML = function (lat, lon) {
    let html = '';
    const s = A.statusAt(lat, lon);
    if (s && s.full) html += `<div class="danger-banner big">🚨 AIR-RAID ALERT in ${SM.esc(s.name)}. Stop the chase and go to the nearest shelter.</div>`;
    else if (s) html += `<div class="danger-banner">⚠ Partial air-raid alert in ${SM.esc(s.name)}: ${SM.esc(s.partial.join(', '))}.</div>`;
    if (H.at(lat, lon)) html += '<div class="danger-banner">⚠ You are in a potentially mine-contaminated area. Stay on the paved road surface.</div>';
    return html;
  };

  SM.safetyInit = function () {
    A.load(); H.load();
    setInterval(A.load, 30000);
    SM.$('#lyrAir').addEventListener('change', e => A.setEnabled(e.target.checked));
    SM.$('#lyrMines').addEventListener('change', e => H.setEnabled(e.target.checked));
  };
})();
