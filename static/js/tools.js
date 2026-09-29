/* StormMap — measure tool and automated chase briefing */
'use strict';

(function () {
  const T = SM.tools = { measuring: false, pts: [] };

  /* ---------------- Measure distance / bearing ---------------- */
  function drawMeasure() {
    T.group.clearLayers();
    if (!T.pts.length) return;
    L.polyline(T.pts, { pane: 'routePane', color: '#fbbf24', weight: 2, dashArray: '6 4' }).addTo(T.group);
    let total = 0;
    T.pts.forEach((p, i) => {
      L.circleMarker(p, { pane: 'routePane', radius: 4, color: '#fbbf24', weight: 2, fillColor: '#040507', fillOpacity: 1 }).addTo(T.group);
      if (i) {
        const a = T.pts[i - 1];
        const d = SM.geo.dist(a[0], a[1], p[0], p[1]);
        total += d;
        const brg = SM.geo.bearing(a[0], a[1], p[0], p[1]);
        L.marker(p, { pane: 'routePane', icon: L.divIcon({ className: '', html: '', iconSize: [0, 0] }), interactive: false })
          .bindTooltip(`${d.toFixed(1)} km · ${Math.round(brg)}° ${SM.geo.compass(brg)}${i > 1 ? ` · Σ ${total.toFixed(1)} km` : ''}`, { permanent: true, direction: 'right', offset: [8, 0], className: 'cell-label' })
          .addTo(T.group);
      }
    });
  }

  T.toggleMeasure = function (on = !T.measuring) {
    T.measuring = on;
    T.btn.classList.toggle('on', on);
    SM.map.getContainer().style.cursor = on ? 'crosshair' : '';
    if (on) { T.pts = []; drawMeasure(); SM.toast('Measure: click points on the map; press Esc or the ruler again to finish'); }
  };

  T.click = function (latlng) {
    if (!T.measuring) return false;
    T.pts.push([latlng.lat, latlng.lng]);
    drawMeasure();
    return true;
  };

  /* ---------------- Chase briefing ---------------- */
  const fmt = (v, nd = 0) => (v == null || v !== v ? '—' : Number(v).toFixed(nd));

  function modeText(t) {
    if ((t.shr6 || 0) >= 20 && (t.scp || 0) >= 2) return 'discrete supercells';
    if ((t.shr6 || 0) >= 12.5) return 'organised multicells / supercells, possibly upscale growth into lines';
    return 'pulse storms and disorganised multicells';
  }

  function hazards(t) {
    const h = [];
    if ((t.ship || 0) >= 1 || ((t.cape || 0) >= 2000 && (t.shr6 || 0) >= 15)) h.push('large hail (SHIP ' + fmt(t.ship, 1) + ')');
    if ((t.stp || 0) >= 1 && (t.lcl || 9999) < 1300) h.push('tornadoes (STP ' + fmt(t.stp, 1) + ', LCL ' + fmt(t.lcl) + ' m)');
    else if ((t.srh1 || 0) >= 150) h.push('brief tornadoes if storms stay surface-based');
    if ((t.shr6 || 0) >= 20 || (t.cape || 0) >= 2500) h.push('damaging gusts');
    if ((t.shr6 || 0) < 10 && (t.cape || 0) >= 1000) h.push('slow-moving storms with flash flooding');
    return h.length ? h.join(', ') : 'general thunderstorms (lightning, heavy rain)';
  }

  T.briefing = function () {
    const S = SM.state, o = S.outlook;
    if (!o) return 'Outlook not loaded yet.';
    const day = o.days[S.olDay || 0];
    const model = SM.meta.models[o.model] ? SM.meta.models[o.model].name : o.model;
    const lines = [];
    lines.push(`CHASE BRIEFING — ${day.date} (${model}, generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')}Z)`);
    lines.push('');
    const top = day.countries.filter(c => c.level >= 1).slice(0, 5).map(c => `${c.name} ${SM.THREAT_NAMES[c.level]}`);
    lines.push(`RISK: ${top.length ? top.join(' · ') : 'no significant convection expected'}`);
    if (S.timeline) {
      const hrs = day.hours ? S.timeline.threat.slice(day.hours[0], day.hours[1] + 1) : [];
      const first = hrs.findIndex(x => x >= 2), peak = hrs.indexOf(Math.max(...hrs));
      if (first >= 0) lines.push(`TIMING: organised storms possible from ~${SM.utcHM(S.timeline.times[day.hours[0] + first])}Z, regional peak ~${SM.utcHM(S.timeline.times[day.hours[0] + peak])}Z`);
    }
    const t = day.targets[0];
    if (t) {
      lines.push('');
      lines.push(`TARGET: ${t.place} (${t.lat.toFixed(2)}, ${t.lon.toFixed(2)}) around ${SM.utcHM(t.time)}Z — ${t.label}`);
      lines.push(`  CAPE ${fmt(t.cape)} J/kg · 0–6 km shear ${fmt(t.shr6)} m/s · SRH1 ${fmt(t.srh1)} · SRH3 ${fmt(t.srh3)} m²/s² · LCL ${fmt(t.lcl)} m`);
      lines.push(`  STP ${fmt(t.stp, 1)} · SCP ${fmt(t.scp, 1)} · SHIP ${fmt(t.ship, 1)}`);
      lines.push(`  Expected mode: ${modeText(t)}`);
      lines.push(`  Main hazards: ${hazards(t)}`);
      const sun = SM.sun.times(new Date(t.time * 1000), t.lat, t.lon);
      if (sun.sunset) lines.push(`  Sunset ${SM.utcHM(sun.sunset / 1000)}Z · civil dusk ${SM.utcHM(sun.dusk / 1000)}Z at the target`);
      if (SM.zones.cls) {
        const z = SM.zones.at(t.lat, t.lon);
        if (z) lines.push(`  ⛔ Target lies in a no-go area (${SM.zones.label(z)}) — choose the next target.`);
      }
      const alt = day.targets.slice(1, 4).map(x => `${x.place} (${x.label}, ${SM.utcHM(x.time)}Z)`);
      if (alt.length) lines.push(`BACKUP TARGETS: ${alt.join(' · ')}`);
    }
    const tracks = SM.tracker.tracks.filter(x => x.rank).sort((a, b) => b.rank.score - a.rank.score);
    if (tracks.length) {
      lines.push('');
      lines.push(`NOW (radar ${SM.tracker.frameTime ? SM.utcHM(SM.tracker.frameTime) + 'Z' : '—'}): ${tracks.length} cells tracked`);
      for (const x of tracks.slice(0, 3)) lines.push(`  C${x.id} ${x.rank.verdict} (${x.rank.score}) — ${x.place.label}, ${x.cur.maxDbz} dBZ, ${x.v ? SM.geo.compass(x.dir) + ' ' + Math.round(x.spd * 3.6) + ' km/h' : 'motion unknown'}${x.rank.chase.ok ? '' : ' — NOT CHASEABLE'}`);
    }
    if (S.warnings) {
      const w = S.warnings.warnings.filter(x => x.level >= 3);
      if (w.length) lines.push(`WARNINGS: ${w.length} orange/red (${[...new Set(w.map(x => x.country))].join(', ')})`);
    }
    if (SM.zones.data) lines.push(`SAFETY: no-go zones from ${SM.zones.data.meta.source}; front buffer ${SM.zones.data.front_km} km. Never enter occupied or front-line areas.`);
    lines.push('Automated guidance — verify with official forecasts and observations.');
    return lines.join('\n');
  };

  T.showBriefing = function () {
    const box = SM.$('#briefing');
    box.hidden = false;
    box.querySelector('pre').textContent = T.briefing();
  };

  T.init = function () {
    T.group = L.layerGroup().addTo(SM.map);
    const Ctl = L.Control.extend({
      options: { position: 'topright' },
      onAdd() {
        const b = L.DomUtil.create('button', 'measure-btn');
        b.title = 'Measure distance & bearing';
        b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 17 17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/></svg>';
        L.DomEvent.disableClickPropagation(b);
        b.addEventListener('click', () => T.toggleMeasure());
        T.btn = b;
        return b;
      },
    });
    new Ctl().addTo(SM.map);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && T.measuring) T.toggleMeasure(false); });
    SM.$('#briefBtn').addEventListener('click', T.showBriefing);
    SM.$('#briefCopy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(SM.$('#briefing pre').textContent); SM.toast('Briefing copied'); }
      catch (e) { SM.toast('Copy failed — select the text manually', true); }
    });
  };
})();
