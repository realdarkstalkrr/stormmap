/* StormMap — chaser alerts: lightning proximity, approaching cells, new high-potential storms, warnings */
'use strict';

(function () {
  const DEFAULTS = { on: true, ltgKm: 15, cells: true, potential: true, warnings: true, airraid: true, sound: true };
  let cfg = Object.assign({}, DEFAULTS);
  try { cfg = Object.assign(cfg, JSON.parse(localStorage.getItem('sm-alerts') || '{}')); } catch (e) { /* ignore */ }

  const A = SM.alerts = { cfg, feed: [], last: {} };
  const save = () => { try { localStorage.setItem('sm-alerts', JSON.stringify(cfg)); } catch (e) { /* ignore */ } };

  function beep(level) {
    if (!cfg.sound) return;
    try {
      const ac = A.ac || (A.ac = new (window.AudioContext || window.webkitAudioContext)());
      const tones = level === 'danger' ? [880, 660, 880] : [660, 880];
      tones.forEach((f, i) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.frequency.value = f; o.type = 'sine';
        g.gain.setValueAtTime(0.0001, ac.currentTime + i * 0.18);
        g.gain.exponentialRampToValueAtTime(0.15, ac.currentTime + i * 0.18 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + i * 0.18 + 0.16);
        o.connect(g).connect(ac.destination);
        o.start(ac.currentTime + i * 0.18); o.stop(ac.currentTime + i * 0.18 + 0.17);
      });
    } catch (e) { /* audio unavailable */ }
  }

  /** Raise an alert once per `key` per `cooldownMin`. level: info | warn | danger */
  A.raise = function (key, level, title, body, cooldownMin = 15) {
    const now = Date.now();
    if (A.last[key] && now - A.last[key] < cooldownMin * 60000) return;
    A.last[key] = now;
    A.feed.unshift({ t: now, level, title, body });
    A.feed = A.feed.slice(0, 40);
    SM.toast(`${title} — ${body}`, level === 'danger', 9000);
    beep(level);
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      try { new Notification('StormMap: ' + title, { body, tag: key }); } catch (e) { /* ignore */ }
    }
    A.renderFeed();
  };

  function checkLightning(pos) {
    const cut = Date.now() - 5 * 60000;
    let n = 0, nearest = Infinity, nb = 0;
    const s = SM.lightning.strikes;
    for (let i = s.length - 1; i >= 0 && s[i].t >= cut; i--) {
      const d = SM.geo.dist(pos[0], pos[1], s[i].lat, s[i].lon);
      if (d <= cfg.ltgKm) { n++; if (d < nearest) { nearest = d; nb = SM.geo.bearing(pos[0], pos[1], s[i].lat, s[i].lon); } }
    }
    A.ltgNear = n ? { n, nearest, bearing: nb } : null;
    if (n) {
      A.raise('ltg', nearest < 10 ? 'danger' : 'warn', `Lightning ${Math.round(nearest)} km ${SM.geo.compass(nb)}`,
        `${n} strike(s) within ${cfg.ltgKm} km in 5 min. 30/30 rule: stay in your vehicle; wait 30 min after the last strike before going outside.`, 10);
    }
  }

  function check() {
    if (!cfg.on) return;
    const pos = SM.chase && SM.chase.pos;
    if (pos && cfg.ltgKm > 0) checkLightning(pos);
    for (const tr of SM.tracker.tracks) {
      if (pos && cfg.cells) {
        const hit = SM.chase.threatTo(tr);
        if (hit) A.raise('cell-' + tr.id, hit === 'OVERHEAD' ? 'danger' : 'warn', `C${tr.id} ${hit === 'OVERHEAD' ? 'is overhead' : 'approaching you'}`,
          `${tr.cur.maxDbz} dBZ${tr.rank ? ', ' + tr.rank.verdict.toLowerCase() : ''} — ${hit.toLowerCase()}. ${tr.cur.maxDbz >= 55 ? 'Large hail possible: do not drive into the core.' : ''}`, 20);
      }
      if (cfg.potential && tr.rank && tr.rank.verdict === 'HIGH POTENTIAL' && tr.rank.chase.ok) {
        A.raise('pot-' + tr.id, 'info', `C${tr.id}: high chase potential`, `${tr.place.label} · score ${tr.rank.score} · ${tr.rank.reasons.filter(r => r[0] === '+').slice(0, 2).map(r => r[1]).join('; ')}`, 180);
      }
    }
    if (pos && cfg.airraid && SM.air) {
      const s = SM.air.statusAt(pos[0], pos[1]);
      if (s && s.full) A.raise('air-' + s.key, 'danger', `AIR-RAID ALERT: ${s.name}`, 'Stop the chase and go to the nearest shelter. Do not film or post positions of air-defence activity or impacts.', 30);
      else if (s) A.raise('airp-' + s.key + s.partial.join(), 'warn', `Partial air-raid alert: ${s.name}`, s.partial.join(', '), 30);
    }
    if (pos && cfg.warnings && SM.warn) {
      const w = SM.warn.at(pos[0], pos[1]);
      if (w) A.raise('sw-' + w.id, w.severity === 'moderate' ? 'warn' : 'danger', `You are inside storm warning ${w.id}`, (SM.i18n && SM.i18n.lang === 'uk' ? w.title_uk : w.title_en) || w.severity, 60);
    }
    if (cfg.warnings && SM.state.warnings && pos) {
      const cc = SM.nearestCity(pos[0], pos[1]).country;
      for (const w of SM.state.warnings.warnings) {
        if (w.country === cc && w.level >= 3) A.raise('warn-' + (w.headline || w.event) + w.onset, 'warn', `${w.color.toUpperCase()} warning in ${cc}`, `${w.event}: ${w.areas.slice(0, 4).join(', ')}`, 360);
      }
    }
  }

  A.renderFeed = function () {
    const box = SM.$('#alertFeed');
    if (!box) return;
    box.innerHTML = A.feed.length ? A.feed.slice(0, 12).map(a => `<div class="al al-${a.level}"><div><b>${SM.esc(a.title)}</b><span>${SM.localHM(a.t / 1000)}</span></div><p>${SM.esc(a.body)}</p></div>`).join('')
      : '<p class="hint">No alerts yet.</p>';
  };

  function renderSettings() {
    const box = SM.$('#alertSettings');
    box.innerHTML = `
      <label class="toggle"><input type="checkbox" data-k="on" ${cfg.on ? 'checked' : ''}><span></span>Alerts enabled</label>
      <label class="range-row">Lightning radius <input type="range" data-k="ltgKm" min="0" max="40" step="5" value="${cfg.ltgKm}"><b>${cfg.ltgKm ? cfg.ltgKm + ' km' : 'off'}</b></label>
      <label class="toggle"><input type="checkbox" data-k="cells" ${cfg.cells ? 'checked' : ''}><span></span>Cell will pass over me</label>
      <label class="toggle"><input type="checkbox" data-k="potential" ${cfg.potential ? 'checked' : ''}><span></span>New high-potential storm</label>
      <label class="toggle"><input type="checkbox" data-k="warnings" ${cfg.warnings ? 'checked' : ''}><span></span>Storm warnings at my position</label>
      <label class="toggle"><input type="checkbox" data-k="airraid" ${cfg.airraid ? 'checked' : ''}><span></span>Air-raid alert in my oblast</label>
      <label class="toggle"><input type="checkbox" data-k="sound" ${cfg.sound ? 'checked' : ''}><span></span>Sound</label>
      ${'Notification' in window && Notification.permission !== 'granted' ? '<button class="btn" id="notifBtn">Enable desktop notifications</button>' : ''}`;
    box.querySelectorAll('[data-k]').forEach(el => el.addEventListener(el.type === 'range' ? 'input' : 'change', () => {
      cfg[el.dataset.k] = el.type === 'checkbox' ? el.checked : +el.value;
      if (el.type === 'range') el.nextElementSibling.textContent = cfg.ltgKm ? cfg.ltgKm + ' km' : 'off';
      save();
    }));
    const nb = SM.$('#notifBtn');
    if (nb) nb.addEventListener('click', async () => { try { await Notification.requestPermission(); } catch (e) { /* ignore */ } renderSettings(); });
  }

  A.init = function () {
    renderSettings();
    A.renderFeed();
    setInterval(check, 20000);
    SM.on('cells', check);
    SM.on('airalerts', check);
    SM.on('stormwarnings', check);
  };
})();
